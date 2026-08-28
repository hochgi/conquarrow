import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent, ReactElement, WheelEvent } from 'react';
import {
  DEFAULT_MATCH_CONFIG,
  GOOGLE_ID_TOKEN_SESSION_KEY,
  endTurn,
  type ArrowId,
  type GameState,
  type MatchConfig,
  type Move,
  type PagesLobbyMode,
  type PlayerId,
} from '@conquarrow/contracts';
import { makeLayout, makeMatch, makeTiling } from '@conquarrow/geometry-tiling';
import { makeRules } from '@conquarrow/rules-core';
import { styleFor } from './colors';
import { hasLegalStep, onlinePassMove, passIfExhausted } from './autoEndTurn';
import { Board } from './Board';
import { cullArrows, cullVertices } from './cull';
import { COARSE_HIT_PADDING_PX, hitArrow, hitSpawnerVertex } from './hit';
import { Hud } from './Hud';
import type { TutorialHud } from './Hud';
import type { InputMode, InputSnapshot } from './input/modes';
import { createInputMode } from './input/modes';
import { Lobby } from './Lobby';
import { TutorialOverlay } from './TutorialOverlay';
import { hydrateState } from './online-hydrate';
import { parsePagesHash } from './online-hash';
import { isCallerToMove } from './online-pages';
import { usePagesHost } from './online-runtime';
import { displaySeatKind, kindsForHost, logFromOnlineBoard } from './online-shell-ui';
import type { ByokRunStats, MatchLog, SeatDriverLog } from './matchLog';
import {
  appendMovesWithSummary,
  createMatchLog,
  downloadMatchLog,
  matchSummaryLine,
  saveMatchLog,
  withByokStats,
  withWinner,
} from './matchLog';
import { playLlmBotTurn } from './byokBot';
import { isByokReady } from './byokConfig';
import { clearTargetLocks } from './targets';
import {
  aiSeatIds,
  byokConfigForSeat,
  coerceOnlineSeatPlan,
  firstHumanSeat,
  hasAiSeat,
  hasByokSeat,
  loadSeatPlan,
  saveSeatPlan,
  seatPlanReady,
  seatPlayerId,
  summarizeDrivers,
  type SeatConfig,
  type SeatPlan,
} from './seatPlan';
import {
  applyMovesSequentially,
  BOT_PLAYBACK_GAP_MS,
  localAiChairKey,
} from './botPlayback';
import {
  botsHeld,
  idlePaused,
  isAllBot,
  pauseKind,
  pauseOffered,
} from './botPause';
import { playBotTurn } from './opponent';
import { presentRefusal, presentSteps, REFUSAL_TEXT, type FxOverlay } from './fx/present';
import {
  emptyQueue,
  enqueue,
  isResolving,
  pruneQueue,
  queueSettleMs,
  type FxItem,
} from './fx/queue';
import { celebrationWaitMs, victoryAt } from './fx/celebration';
import { loadSoundEnabled, playOverlayCues, saveSoundEnabled } from './fx/sound';
import { replaySteps } from './fx/steps';
import { ConvertTip } from './ConvertTip';
import { RouteDock } from './RouteDock';
import { convertTooltip, refusedConvertExits } from './refusedConvert';
import { countControl, routePaint } from './route';
import { selectionPaint, type PointerKind } from './selectionChrome';
import { spawnerInfoAt } from './spawnerInfo';
import { SpawnerTip } from './SpawnerTip';
import type { Viewport } from './viewport';
import { ZOOM, centerOn, createViewport, panBy, resize, toScreen, zoomAt } from './viewport';
import { LESSONS, lessonById } from './tutorial/catalogue';
import { firstRunCardVisible, practiceBoard } from './tutorial/chrome';
import { decorateInputMode, restrictionFor } from './tutorial/restrict';
import type { TutoredSnapshot } from './tutorial/restrict';
import { lessonTargets, narrateCardBox, shouldPanToExpect } from './tutorial/stage';
import { TutorialSession } from './tutorial/session';
import { createProgressStore } from './tutorial/storage';
import type { Lesson } from './tutorial/types';
import { openingOf } from './tutorial/validate';

const geometry = makeTiling();
const layout = makeLayout();
const rules = makeRules(geometry);

const TUTORIAL_PROGRESS_KEY = 'conquarrow:tutorial-progress';

const tutorialBacking = {
  read: (): string | undefined => {
    if (typeof localStorage === 'undefined') return undefined;
    return localStorage.getItem(TUTORIAL_PROGRESS_KEY) ?? undefined;
  },
  write: (value: string): void => {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(TUTORIAL_PROGRESS_KEY, value);
  },
};

const pointerKindOf = (pointerType: string): PointerKind =>
  pointerType === 'touch' || pointerType === 'pen' ? 'coarse' : 'fine';

const hitPadding = (pointerType: string): { readonly paddingPx: number } | undefined =>
  pointerKindOf(pointerType) === 'coarse' ? { paddingPx: COARSE_HIT_PADDING_PX } : undefined;

/** Layout-space centroid of an arrow tile — same space as `viewport.cx/cy`. */
const arrowCentroid = (arrow: ArrowId): { x: number; y: number } => {
  const poly = layout.polygon(arrow);
  let sx = 0;
  let sy = 0;
  for (const p of poly) {
    sx += p.x;
    sy += p.y;
  }
  const n = poly.length === 0 ? 1 : poly.length;
  return { x: sx / n, y: sy / n };
};

/**
 * Apply a whole trip, one step at a time.
 *
 * A reach destination several steps away is several `step` moves — the engine has one
 * move kind and this adapter does not get to invent a compound one, which is also what
 * keeps a replay honest (P10). If a step is refused the trip stops there and the heads
 * stay where they got to: the reach preview was computed by simulating this same engine,
 * so that should not happen, and swallowing it silently would hide it if it did.
 */
const applyMoves = (
  state: GameState,
  moves: readonly Move[],
): { readonly state: GameState; readonly applied: readonly Move[] } => {
  let at = state;
  const applied: Move[] = [];
  for (const move of moves) {
    if (at.winner !== undefined) break;
    try {
      at = rules.apply(at, move);
      applied.push(move);
    } catch {
      break;
    }
  }
  const passed = passIfExhausted(rules, at);
  return { state: passed.state, applied: [...applied, ...passed.moves] };
};

const idleSnap = (): InputSnapshot => ({
  phase: { kind: 'idle' },
  highlights: { targets: new Set() },
});

const adapterSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });

const byokTurnMessage = (seatKey: string, stats: ByokRunStats): string | undefined => {
  if (stats.llmFallbacks > 0 && stats.lastError !== undefined) {
    return `${seatKey} LLM fallback ×${String(stats.llmFallbacks)} (hits ${String(stats.llmHits)}): ${stats.lastError}`;
  }
  if (stats.llmHits > 0) {
    return `${seatKey} LLM ok · ${String(stats.llmHits)} picks this turn`;
  }
  return undefined;
};

type LocalAiPlan = {
  readonly moves: readonly Move[];
  readonly byok: { readonly delta: ByokRunStats; readonly seat: PlayerId } | undefined;
};

const planLocalAiTurn = async (seat: SeatConfig, start: GameState): Promise<LocalAiPlan> => {
  if (seat.kind === 'byok') {
    const turn = await playLlmBotTurn(
      geometry,
      rules,
      start,
      start.activePlayer,
      byokConfigForSeat(seat),
    );
    return {
      moves: turn.moves,
      byok: {
        delta: {
          llmHits: turn.llmHits,
          llmFallbacks: turn.llmFallbacks,
          lastError: turn.lastError,
        },
        seat: start.activePlayer,
      },
    };
  }
  const { moves } = playBotTurn(geometry, rules, start, start.activePlayer);
  return { moves, byok: undefined };
};

/** The hover read-out, or nothing when the vertex turns out to carry no spawner. */
const SpawnerTipFor = ({
  state,
  hover,
  viewport,
}: {
  state: GameState;
  hover: { readonly vertex: import('@conquarrow/contracts').VertexId; readonly x: number; readonly y: number };
  viewport: Viewport;
}): ReactElement | null => {
  const info = spawnerInfoAt(geometry, state, hover.vertex);
  if (info === undefined) return null;
  return (
    <SpawnerTip
      info={info}
      x={hover.x}
      y={hover.y}
      stageWidth={viewport.width}
      stageHeight={viewport.height}
    />
  );
};

export const App = (): ReactElement => {
  const { host, gen, refresh } = usePagesHost();
  const hostRef = useRef(host);
  hostRef.current = host;
  const onlinePlayRef = useRef(false);
  const [lobbyMode, setLobbyMode] = useState<PagesLobbyMode>('local');
  const [seatPlan, setSeatPlan] = useState<SeatPlan>(() => loadSeatPlan());
  const [tutorialStore] = useState(() => createProgressStore(tutorialBacking));
  const [learnEpoch, setLearnEpoch] = useState(0);
  const [tutorial, setTutorial] = useState<{ lesson: Lesson; session: TutorialSession } | undefined>(
    undefined,
  );
  const tutorialRef = useRef(tutorial);
  tutorialRef.current = tutorial;
  const [tutorialGen, setTutorialGen] = useState(0);
  const demoKeyRef = useRef<string | undefined>(undefined);
  const [mode] = useState<InputMode>(() => createInputMode(geometry));
  const inputRef = useRef<InputMode>(mode);
  const liveInput = (): InputMode => inputRef.current;
  const bumpTutorial = (): void => {
    setTutorialGen((n) => n + 1);
  };
  const [state, setState] = useState<GameState | undefined>(undefined);
  const [log, setLog] = useState<MatchLog | undefined>(undefined);
  const [snap, setSnap] = useState<InputSnapshot>(idleSnap);
  const [viewport, setViewport] = useState<Viewport>(() => createViewport(800, 600));
  const [hover, setHover] = useState<
    { readonly vertex: import('@conquarrow/contracts').VertexId; readonly x: number; readonly y: number } | undefined
  >(undefined);
  /** Arrow under the cursor — convert-refusal tooltip (P28) when the grain out is refused. */
  const [hoverArrow, setHoverArrow] = useState<
    { readonly arrow: ArrowId; readonly x: number; readonly y: number } | undefined
  >(undefined);
  /** Last board pointer: touch/pen is coarse, otherwise fine (P31). */
  const [pointerKind, setPointerKind] = useState<PointerKind>('fine');
  /** Reach destination under the cursor — drives the pulsed path preview. */
  const [botBusy, setBotBusy] = useState(false);
  const [manualPause, setManualPause] = useState(false);
  const [tabFocused, setTabFocused] = useState(true);
  const [byokStatus, setByokStatus] = useState<string | undefined>(undefined);
  /** Live gameplay effects. Additive over `state`, so losing one cannot mislead. */
  const [fx, setFx] = useState<readonly FxItem[]>(emptyQueue);
  /**
   * The deciding move's instant, and how far the celebration clock has been read
   * since (P38).
   *
   * `at` is stamped once, the first frame `winner` is seen, on the same `Date.now()`
   * clock the queue stamps overlays with — so the two are comparable. `now` only
   * ever advances on an event (the stamp itself, then the timer that fires when the
   * move's overlays are due to have finished), which keeps rendering a pure function
   * of state rather than of the wall clock.
   */
  const [decided, setDecided] = useState<{ readonly at: number; readonly now: number }>();
  /** Monotonic id source for overlays — a counter, never a clock. */
  const fxSeq = useRef(0);
  const [soundOn, setSoundOn] = useState<boolean>(() => loadSoundEnabled());
  const soundRef = useRef(soundOn);
  soundRef.current = soundOn;
  /** One short line naming why the last click did nothing. */
  const [refusalNote, setRefusalNote] = useState<string | undefined>(undefined);
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  /** Active pointers for pinch-zoom (phone has no wheel). */
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<
    { dist: number; midX: number; midY: number; moved: boolean } | null
  >(null);
  const shellRef = useRef<HTMLDivElement>(null);
  /** Non-human seats for the live match. */
  const aiSeatsRef = useRef<ReadonlySet<string>>(new Set());
  const seatConfigsRef = useRef<ReadonlyMap<string, SeatConfig>>(new Map());
  const botEpoch = useRef(0);
  const stateRef = useRef<GameState | undefined>(undefined);
  const passEpoch = useRef(0);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    const sync = (): void => {
      setTabFocused(document.visibilityState === 'visible' && document.hasFocus());
    };
    sync();
    window.addEventListener('focus', sync);
    window.addEventListener('blur', sync);
    document.addEventListener('visibilitychange', sync);
    return () => {
      window.removeEventListener('focus', sync);
      window.removeEventListener('blur', sync);
      document.removeEventListener('visibilitychange', sync);
    };
  }, []);

  useEffect(() => {
    host?.setSeatPlan(kindsForHost(seatPlan, lobbyMode === 'online'));
  }, [host, seatPlan, lobbyMode]);

  useEffect(() => {
    if (host === undefined) return;
    setLobbyMode(host.mode());
  }, [host, gen]);

  useEffect(() => {
    const current = hostRef.current;
    if (current === undefined) return;
    if (parsePagesHash(window.location.hash).kind !== 'game') return;
    const board = current.board();
    if (board === undefined) return;
    const game = hydrateState(board.state);
    if (game === undefined) return;
    onlinePlayRef.current = true;
    aiSeatsRef.current = new Set();
    seatConfigsRef.current = new Map();
    stateRef.current = game;
    setState(game);
    setLog((prev) => prev ?? logFromOnlineBoard(game, board.seats));
    setSnap(mode.reset());
  }, [gen, mode]);

  useEffect(() => {
    const current = host;
    if (current === undefined || state !== undefined) return;
    if (sessionStorage.getItem(GOOGLE_ID_TOKEN_SESSION_KEY) === null) return;
    void current.refreshLibrary().then(refresh);
  }, [host, state, refresh]);

  useEffect(() => {
    if (host === undefined || state !== undefined) return;
    if (host.adapter().inviteToken() === undefined) return;
    if (host.board() !== undefined) return;
    const id = window.setInterval(() => {
      void host.refreshLobby().then(refresh);
    }, 2000);
    return () => {
      window.clearInterval(id);
    };
  }, [host, state, refresh, gen]);

  useEffect(() => {
    const el = shellRef.current;
    if (el === null) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry === undefined) return;
      const { width, height } = entry.contentRect;
      const w = Math.max(320, width);
      const h = Math.max(240, height);
      setViewport((v) => {
        // Phone stage is short — start a bit zoomed out so homes fit.
        const scale =
          h < 520 && v.scale === ZOOM.default ? Math.min(v.scale, 34) : v.scale;
        return { ...resize(v, w, h), scale };
      });
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, [state]);

  const record = useCallback(
    (
      moves: readonly Move[],
      nextState: GameState,
      beforeState?: GameState,
      byokDelta?: ByokRunStats,
      byokSeat?: PlayerId,
    ): void => {
      if (moves.length === 0) return;
      setLog((prev) => {
        if (prev === undefined) return prev;
        const base =
          beforeState !== undefined
            ? appendMovesWithSummary(prev, moves, beforeState, nextState)
            : { ...prev, moves: [...prev.moves, ...moves] };
        let updated = withWinner(base, nextState.winner);
        if (byokDelta !== undefined) updated = withByokStats(updated, byokDelta, byokSeat);
        saveMatchLog(updated);
        return updated;
      });
    },
    [],
  );

  /**
   * Resolve what a committed batch changed, and queue the effects for it.
   *
   * The state transition has already happened by the time this runs — every
   * overlay decorates a board that is already correct — so this is allowed to
   * fail, be capped, or be interrupted without affecting play.
   */
  const pushFx = useCallback(
    (before: GameState | undefined, moves: readonly Move[], next: GameState): void => {
      if (before === undefined || moves.length === 0) return;
      const steps = replaySteps(rules, before, moves, next);
      const overlays = presentSteps(steps, { geometry, seq: fxSeq.current });
      if (overlays.length === 0) return;
      fxSeq.current += overlays.length + 1;
      const now = Date.now();
      setFx((prev) => enqueue(prev, overlays, now));
      if (soundRef.current) playOverlayCues(overlays);
    },
    [],
  );

  /** Localized feedback for a click that could not do anything (Event 11). */
  const pushRefusal = useCallback((overlay: FxOverlay, note: string): void => {
    fxSeq.current += 1;
    setFx((prev) => enqueue(prev, [overlay], Date.now()));
    setRefusalNote(note);
  }, []);

  /** Apply + log outside React updater functions (Strict Mode double-invokes those). */
  const commitApplied = useCallback(
    (
      moves: readonly Move[],
      next: GameState,
      byokDelta?: ByokRunStats,
      byokSeat?: PlayerId,
    ): void => {
      const before = stateRef.current;
      pushFx(before, moves, next);
      stateRef.current = next;
      record(moves, next, before, byokDelta, byokSeat);
      setState(next);
      setSnap(mode.reset());
      setRefusalNote(undefined);
      const play = tutorialRef.current;
      if (play !== undefined && before !== undefined) {
        play.session.onCommitted(before, next, moves);
        setTutorialGen((n) => n + 1);
      }
    },
    [mode, record, pushFx],
  );

  // Retire finished effects. One timer for the whole queue, armed for the longest
  // remaining lifetime — the board is already correct, so a late prune is only a
  // few extra shapes, never a wrong position.
  useEffect(() => {
    if (fx.length === 0) return;
    const wait = queueSettleMs(fx, Date.now()) + 40;
    const handle = window.setTimeout(() => {
      setFx((prev) => pruneQueue(prev, Date.now()));
    }, wait);
    return () => {
      window.clearTimeout(handle);
    };
  }, [fx]);

  const softLockKey = useRef<string | null>(null);
  useEffect(() => {
    if (state === undefined) return;
    if (onlinePlayRef.current) return;
    if (tutorialRef.current !== undefined) return;
    if (state.winner !== undefined) {
      softLockKey.current = null;
      return;
    }
    if (aiSeatsRef.current.has(String(state.activePlayer))) {
      // AI owns exhaustion via playBotTurn / chooseMove — avoid racing auto-pass.
      return;
    }
    if (hasLegalStep(rules, state)) {
      softLockKey.current = null;
      return;
    }
    const { state: next, moves } = passIfExhausted(rules, state);
    if (Object.is(next, state) || moves.length === 0) return;
    if (!hasLegalStep(rules, next) && next.winner === undefined) {
      // P36: the single starvation streak became per seat. Read it through
      // `players` so the key never depends on the map's own insertion order.
      const streaks = next.players
        .map((player) => String(next.starvationStreaks.get(player) ?? 0))
        .join(',');
      const key = `${String(next.activePlayer)}:${String(next.groups.size)}:${streaks}`;
      if (softLockKey.current === key) return;
      softLockKey.current = key;
    } else {
      softLockKey.current = null;
    }
    const epoch = ++passEpoch.current;
    const handle = window.setTimeout(() => {
      if (epoch !== passEpoch.current) return;
      if (stateRef.current !== state) return;
      commitApplied(moves, next);
    }, 0);
    return () => {
      window.clearTimeout(handle);
      passEpoch.current += 1;
    };
  }, [state, snap.phase.kind, commitApplied]);

  useEffect(() => {
    const play = tutorial;
    if (play === undefined) {
      inputRef.current = mode;
      return;
    }
    const restriction = restrictionFor(play.session.step());
    inputRef.current = restriction === undefined ? mode : decorateInputMode(mode, restriction);
  }, [tutorial, tutorialGen, mode]);

  const expectPanKey =
    tutorial !== undefined && tutorial.session.step().kind === 'expect'
      ? `${tutorial.lesson.id}:${String(tutorial.session.stepIndex())}`
      : '';

  useEffect(() => {
    if (expectPanKey === '') return;
    const play = tutorialRef.current;
    if (play === undefined) return;
    const step = play.session.step();
    if (step.kind !== 'expect') return;
    const from = step.action.from;
    setViewport((v) => {
      const at = arrowCentroid(from);
      const fromScreen = toScreen(v, at.x, at.y);
      if (!shouldPanToExpect({ step, draftLength: 0, fromScreen, viewport: v })) return v;
      return centerOn(v, at.x, at.y);
    });
  }, [expectPanKey]);

  const demoStepKey =
    tutorial !== undefined && tutorial.session.step().kind === 'demo'
      ? `${tutorial.lesson.id}:${String(tutorial.session.stepIndex())}`
      : '';

  useEffect(() => {
    if (demoStepKey === '') return;
    const play = tutorialRef.current;
    if (play === undefined) return;
    if (play.session.halted()) return;
    const pending = play.session.demoPending();
    if (pending === undefined || pending.length === 0) return;
    if (demoKeyRef.current === demoStepKey) return;
    demoKeyRef.current = demoStepKey;
    const run = { cancelled: false, finished: false };
    void (async () => {
      for (const move of pending) {
        await adapterSleep(BOT_PLAYBACK_GAP_MS);
        if (run.cancelled) return;
        const before = stateRef.current;
        if (before === undefined) return;
        try {
          const after = rules.apply(before, move);
          commitApplied([move], after);
        } catch (cause) {
          play.session.onDemoHalted(move, cause);
          setTutorialGen((n) => n + 1);
          return;
        }
      }
      if (run.cancelled) return;
      play.session.next();
      run.finished = true;
      setTutorialGen((n) => n + 1);
    })();
    return () => {
      run.cancelled = true;
      if (!run.finished) demoKeyRef.current = undefined;
    };
  }, [demoStepKey, commitApplied]);

  useEffect(() => {
    const play = tutorial;
    if (play === undefined || state === undefined) return;
    if (play.session.halted()) return;
    // Only auto-pass B while the learner is on the board. Passing during
    // narrate would consume B's demo (L5 stages B to move).
    const kind = play.session.step().kind;
    if (kind !== 'expect' && kind !== 'objective') return;
    const human = state.players[0];
    if (human === undefined || state.activePlayer === human) return;
    const handle = window.setTimeout(() => {
      if (stateRef.current !== state) return;
      try {
        commitApplied([endTurn()], rules.apply(state, endTurn()));
      } catch {
        /* B cannot pass */
      }
    }, 0);
    return () => {
      window.clearTimeout(handle);
    };
  }, [tutorial, tutorialGen, state, commitApplied]);

  useEffect(() => {
    if (state === undefined || !onlinePlayRef.current) return;
    const move = onlinePassMove(rules, state);
    if (move === undefined) return;
    const epoch = ++passEpoch.current;
    const handle = window.setTimeout(() => {
      if (epoch !== passEpoch.current) return;
      if (stateRef.current !== state) return;
      const h = hostRef.current;
      if (h === undefined) return;
      const seats = h.board()?.seats ?? h.adapter().inviteSeats();
      if (
        !isCallerToMove(
          seats,
          h.adapter().userHash(),
          state.players.map((id) => String(id)),
          String(state.activePlayer),
        )
      ) {
        return;
      }
      const before = h.board();
      void h.submitMove(move).then(() => {
        if (epoch !== passEpoch.current) return;
        if (h.board() === before) return;
        refresh();
      });
    }, 0);
    return () => {
      window.clearTimeout(handle);
      passEpoch.current += 1;
    };
  }, [state, refresh]);

  // Local AI chair — occupancy must not restart playback (P30).
  const idleHold = idlePaused({
    allBot: isAllBot(log?.seats.map((row) => row.kind) ?? []),
    tabFocused,
    online: onlinePlayRef.current,
  });
  const held = botsHeld({ manual: manualPause, idle: idleHold });
  const botChair = held
    ? null
    : localAiChairKey(state, {
        online: onlinePlayRef.current,
        isAiSeat: (id) => aiSeatsRef.current.has(id),
      });

  // Any AI seat: heuristic or BYOK when it is their chair.
  useEffect(() => {
    if (botChair === null) {
      setBotBusy(false);
      return;
    }
    const start = stateRef.current;
    if (start === undefined) return;
    if (String(start.activePlayer) !== botChair) return;
    const seatConfig = seatConfigsRef.current.get(botChair);
    if (seatConfig === undefined || seatConfig.kind === 'human') {
      setBotBusy(false);
      return;
    }
    setBotBusy(true);
    const epoch = ++botEpoch.current;
    const cancelled = (): boolean => epoch !== botEpoch.current;
    const run = async (): Promise<void> => {
      try {
        await adapterSleep(30);
        if (cancelled()) return;
        const plan = await planLocalAiTurn(seatConfig, start);
        if (cancelled()) return;
        if (plan.moves.length === 0) return;
        if (plan.byok !== undefined) {
          const status = byokTurnMessage(botChair, plan.byok.delta);
          if (status !== undefined) setByokStatus(status);
        }
        await applyMovesSequentially(rules, start, plan.moves, {
          gapMs: BOT_PLAYBACK_GAP_MS,
          sleep: adapterSleep,
          cancelled,
          onApplied: (move, after, index) => {
            if (plan.byok !== undefined && index === plan.moves.length - 1) {
              commitApplied([move], after, plan.byok.delta, plan.byok.seat);
              return;
            }
            commitApplied([move], after);
          },
        });
      } catch (err: unknown) {
        if (!cancelled() && seatConfig.kind === 'byok') {
          const detail = err instanceof Error ? err.message : 'unknown error';
          setByokStatus(`${botChair} playback failed: ${detail}`);
        }
      } finally {
        if (!cancelled()) setBotBusy(false);
      }
    };
    void run();
    return () => {
      botEpoch.current += 1;
    };
  }, [botChair, commitApplied]);

  const arrows = useMemo(
    () => (state === undefined ? [] : cullArrows(geometry, viewport)),
    [state, viewport],
  );
  const vertices = useMemo(
    () =>
      state === undefined
        ? new Set<import('@conquarrow/contracts').VertexId>()
        : cullVertices(geometry, viewport),
    [state, viewport],
  );
  const spawnerVertices = useMemo(() => {
    const set = new Set<import('@conquarrow/contracts').VertexId>();
    if (state === undefined) return set;
    for (const vertex of vertices) if (state.spawners.has(vertex)) set.add(vertex);
    return set;
  }, [state, vertices]);

  const movable = useMemo(() => {
    const set = new Set<import('@conquarrow/contracts').ArrowId>();
    if (state === undefined) return set;
    if (aiSeatsRef.current.has(String(state.activePlayer))) {
      return set;
    }
    for (const m of rules.legalMoves(state)) {
      if (m.kind === 'step') set.add(m.from);
    }
    return set;
  }, [state]);

  const boardHighlights = useMemo(() => {
    const from = snap.phase.kind === 'idle' ? undefined : snap.phase.from;
    if (from === undefined || state === undefined) return snap.highlights;
    // P28's refused wash still names the source's own grain outs, in the route
    // phase exactly as before: they are not reach and not a click target.
    const refused = refusedConvertExits(state, geometry, rules, from);
    return refused.size === 0 ? snap.highlights : { ...snap.highlights, refused };
  }, [snap, state]);

  const chrome = useMemo(() => {
    const hover = hoverArrow?.arrow;
    return hover === undefined
      ? selectionPaint({ phase: snap.phase, highlights: boardHighlights, pointer: pointerKind })
      : selectionPaint({
          phase: snap.phase,
          highlights: boardHighlights,
          pointer: pointerKind,
          hoverArrow: hover,
        });
  }, [snap.phase, boardHighlights, pointerKind, hoverArrow?.arrow]);

  /**
   * The three route tiers plus the tip (P34).
   *
   * A pure lookup into the offer the phase already carries, so hovering costs no
   * `rules.apply` call — the offer was built once, when the draft last changed.
   */
  const route = useMemo(() => {
    const hover = hoverArrow?.arrow;
    return hover === undefined
      ? routePaint({ phase: snap.phase, pointer: pointerKind })
      : routePaint({ phase: snap.phase, pointer: pointerKind, hoverArrow: hover });
  }, [snap.phase, pointerKind, hoverArrow?.arrow]);

  /**
   * Stamp the instant the match was decided, once, and clear it for a new one.
   *
   * The celebration needs to know *when* the win landed, and `GameState` cannot say:
   * `winner` is a fact about the board, not about the frame. This is the only clock
   * read in the celebration path, and it happens here rather than anywhere deeper —
   * the same rule the fx queue keeps.
   */
  useEffect(() => {
    if (state?.winner === undefined) {
      if (decided !== undefined) setDecided(undefined);
      return;
    }
    if (decided !== undefined) return;
    const at = Date.now();
    setDecided({ at, now: at });
  }, [state, decided]);

  // Wake once, when the deciding move's overlays are due to have finished, so the
  // celebration paints then rather than on whatever render happens next. The wait
  // comes from the queue itself (`celebrationWaitMs`), never from a constant: the
  // headline winning move settles at 1200ms, and MAJOR_SEQUENCE_MS is 700.
  useEffect(() => {
    if (decided === undefined) return;
    const wait = celebrationWaitMs({ decidedAt: decided.at, now: decided.now, queue: fx });
    if (wait <= 0) return;
    const handle = window.setTimeout(() => {
      setDecided({ at: decided.at, now: Date.now() });
    }, wait);
    return () => {
      window.clearTimeout(handle);
    };
  }, [decided, fx]);

  /**
   * The board's victory reading — *playing* until the winning move has finished
   * playing out, and only then the dim-everything-but-the-winner treatment (P38).
   *
   * The winning move is the most spectacular in the game: a closure that fills
   * ground, converts a stack and vanishes a seat. Painting the celebration on the
   * frame it commits put that treatment *over* the thing that won the match.
   *
   * This never gates input — `inputLocked` reads `winner`, and so does the HUD's
   * button lock (invariant 12), both of which are true from the deciding move on.
   */
  const victory = useMemo(
    () =>
      victoryAt(state, geometry, {
        decidedAt: decided?.at,
        now: decided?.now ?? 0,
        queue: fx,
      }),
    [state, decided, fx],
  );

  /**
   * The read-out that makes capture → production legible (Event 1F).
   *
   * Heads in hand and land held, for the player to move. The HUD emphasises each
   * value when it changes, on a delay tuned to land with the capture fill — so the
   * number visibly moves *because* ground changed hands, rather than at some
   * unrelated moment.
   */
  const activeTotals = useMemo(() => {
    if (state === undefined) return { heads: 0, land: 0 };
    let heads = 0;
    for (const group of state.groups.values()) {
      if (group.owner === state.activePlayer) heads += group.heads;
    }
    let land = 0;
    for (const owner of state.territory.values()) {
      if (owner === state.activePlayer) land += 1;
    }
    return { heads, land };
  }, [state]);

  const commitSnap = useCallback(
    (next: InputSnapshot) => {
      setSnap(next);
      if (next.refusal !== undefined) {
        const { arrow, reason } = next.refusal;
        // P28 already knows a grain-out that would flip your own heads; naming
        // *that* beats the generic "too far" the reach test would give.
        const wouldConvert = boardHighlights.refused?.has(arrow) === true;
        const finalReason = wouldConvert ? 'would-convert' : reason;
        pushRefusal(
          presentRefusal(arrow, finalReason, fxSeq.current),
          REFUSAL_TEXT[finalReason],
        );
      } else {
        // Any action that *did* something answers the last refusal — leaving the
        // note up would have it explain a click two clicks ago.
        setRefusalNote(undefined);
      }
      if (next.pending === undefined) return;
      if (onlinePlayRef.current) {
        const pending = next.pending;
        void (async () => {
          const h = hostRef.current;
          if (h === undefined) return;
          const before = stateRef.current;
          const applied: Move[] = [];
          for (const move of pending) {
            await h.submitMove(move);
            if (h.illegal() !== undefined) break;
            applied.push(move);
          }
          const game = hydrateState(h.board()?.state);
          if (game === undefined) {
            refresh();
            return;
          }
          pushFx(before, applied, game);
          stateRef.current = game;
          if (applied.length > 0) record(applied, game, before);
          setState(game);
          setSnap(mode.reset());
          refresh();
        })();
        return;
      }
      const s = stateRef.current;
      if (s === undefined) return;
      const { state: applied, applied: moves } = applyMoves(s, next.pending);
      commitApplied(moves, applied);

      // Auto-pick the next stack that can still step — after a trip *or* a skip.
      if (applied.winner !== undefined) return;
      if (tutorialRef.current !== undefined) return;
      if (aiSeatsRef.current.has(String(applied.activePlayer))) return;
      if (!hasLegalStep(rules, applied)) return;
      if (!moves.some((m) => m.kind === 'step' || m.kind === 'skip')) return;

      let lastFrom: ArrowId | undefined;
      for (const m of moves) {
        if (m.kind === 'step' || m.kind === 'skip') lastFrom = m.from;
      }
      const froms: ArrowId[] = [];
      const seen = new Set<string>();
      for (const m of rules.legalMoves(applied)) {
        if (m.kind !== 'step') continue;
        const key = String(m.from);
        if (seen.has(key)) continue;
        seen.add(key);
        froms.push(m.from);
      }
      froms.sort((a, b) => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0));
      const pick =
        froms.find((arrow) => arrow !== lastFrom) ?? froms[0];
      if (pick === undefined) return;
      setSnap(mode.onArrowClick(pick, applied, rules));
      // Skip / exhaust already picked the next stack — don't make the player hunt
      // it. But only pan when it is actually off screen: a camera that jumps after
      // every trip destroys the spatial orientation the capture effect depends on,
      // and the effect is playing at exactly that moment.
      const focus = arrowCentroid(pick);
      setViewport((v) => {
        const at = toScreen(v, focus.x, focus.y);
        const margin = Math.min(v.width, v.height) * 0.16;
        const visible =
          at.x > margin &&
          at.x < v.width - margin &&
          at.y > margin &&
          at.y < v.height - margin;
        return visible ? v : centerOn(v, focus.x, focus.y);
      });
    },
    [commitApplied, mode, record, refresh, pushFx, pushRefusal, boardHighlights.refused],
  );

  const setCarry = useCallback(
    (n: number) => {
      setSnap(liveInput().setCarry(n));
    },
    [mode],
  );

  // Escape discards an open draft. Nothing was applied, so there is nothing to
  // undo — which is the whole reason in-turn undo is out of P34's scope. It goes
  // through `commitSnap` so it is the *same* cancel as the button and the
  // background click: a cancel answers the last refusal and clears its note,
  // which a bare `setSnap` would leave on screen explaining an older click.
  // Declared after `commitSnap` because the dependency array reads it at render.
  useEffect(() => {
    if (snap.phase.kind !== 'route') return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') commitSnap(liveInput().cancel());
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [snap.phase.kind, mode, commitSnap]);

  const returnToLobby = (): void => {
    onlinePlayRef.current = false;
    if (parsePagesHash(window.location.hash).kind === 'game') {
      window.location.hash = '';
    }
    setState(undefined);
    stateRef.current = undefined;
    setLog(undefined);
    aiSeatsRef.current = new Set();
    seatConfigsRef.current = new Map();
    setBotBusy(false);
    setManualPause(false);
    setByokStatus(undefined);
    setFx(emptyQueue());
    setRefusalNote(undefined);
    clearTargetLocks();
    setSnap(mode.reset());
    setTutorial(undefined);
    demoKeyRef.current = undefined;
    softLockKey.current = null;
  };

  const lookAt = (arrow: ArrowId): void => {
    const at = arrowCentroid(arrow);
    setViewport((v) => centerOn(v, at.x, at.y));
  };

  const lookAtLesson = (lesson: Lesson, opening: GameState): void => {
    const narrate0 = lesson.steps[0];
    const named =
      narrate0?.kind === 'narrate' && narrate0.focus !== undefined ? narrate0.focus[0] : undefined;
    const human = opening.players[0];
    let home: ArrowId | undefined;
    if (human !== undefined) {
      for (const [arrow, group] of opening.groups) {
        if (group.owner === human) {
          home = arrow;
          break;
        }
      }
    }
    const look = named ?? home;
    if (look !== undefined) lookAt(look);
  };

  const startLesson = (id: Lesson['id']): void => {
    const lesson = lessonById(id) ?? LESSONS[0];
    if (lesson === undefined) return;
    onlinePlayRef.current = false;
    const opening = openingOf(lesson);
    const session = TutorialSession.start(lesson);
    const human = opening.players[0];
    if (human === undefined) return;
    const seatLogs: SeatDriverLog[] = opening.players.map((player) => ({
      player,
      kind: 'human',
    }));
    aiSeatsRef.current = new Set();
    seatConfigsRef.current = new Map();
    clearTargetLocks();
    const nextLog = createMatchLog({
      config: lesson.config,
      vsBot: false,
      botMode: 'human-hotseat',
      seats: seatLogs,
      humanSeat: human,
      botSeat: undefined,
    });
    saveMatchLog(nextLog);
    setLog(nextLog);
    setManualPause(false);
    setByokStatus(undefined);
    setFx(emptyQueue());
    setRefusalNote(undefined);
    stateRef.current = opening;
    setState(opening);
    setSnap(mode.reset());
    setTutorial({ lesson, session });
    demoKeyRef.current = undefined;
    setTutorialGen((n) => n + 1);
    softLockKey.current = null;
    lookAtLesson(lesson, opening);
  };

  const restartLesson = (): void => {
    const play = tutorialRef.current;
    if (play === undefined) return;
    play.session.restart();
    const opening = openingOf(play.lesson);
    stateRef.current = opening;
    setState(opening);
    setSnap(mode.reset());
    setFx(emptyQueue());
    setRefusalNote(undefined);
    demoKeyRef.current = undefined;
    bumpTutorial();
    lookAtLesson(play.lesson, opening);
  };

  const skipLesson = (): void => {
    const play = tutorialRef.current;
    if (play === undefined) return;
    const index = LESSONS.findIndex((entry) => entry.id === play.lesson.id);
    const next = index >= 0 ? LESSONS[index + 1] : undefined;
    if (next === undefined) {
      returnToLobby();
      return;
    }
    startLesson(next.id);
  };

  const advanceTutorial = (): void => {
    const play = tutorialRef.current;
    if (play === undefined) return;
    play.session.next();
    if (play.session.completed()) {
      tutorialStore.markComplete(play.session.id);
      skipLesson();
      return;
    }
    bumpTutorial();
  };

  const startMatch = (plan: SeatPlan): void => {
    if (!seatPlanReady(plan)) return;
    onlinePlayRef.current = false;
    setTutorial(undefined);
    demoKeyRef.current = undefined;
    const config: MatchConfig = {
      ...DEFAULT_MATCH_CONFIG,
      playerCount: plan.playerCount,
    };
    const opening = makeMatch(config);
    const configs = new Map<string, SeatConfig>();
    const aiKeys = new Set<string>();
    const seatLogs: SeatDriverLog[] = [];
    for (let i = 0; i < plan.seats.length; i += 1) {
      const seat = plan.seats[i];
      const player = opening.players[i] ?? seatPlayerId(i);
      if (seat === undefined) continue;
      configs.set(String(player), seat);
      if (seat.kind !== 'human') aiKeys.add(String(player));
      seatLogs.push({
        player,
        kind: seat.kind,
        ...(seat.kind === 'byok' ? { model: seat.byok.model.trim() } : {}),
      });
    }
    aiSeatsRef.current = aiKeys;
    seatConfigsRef.current = configs;
    clearTargetLocks();
    const human = firstHumanSeat(plan) ?? opening.players[0];
    if (human === undefined) return;
    const bots = aiSeatIds(plan);
    const botMode = summarizeDrivers(plan);
    const nextLog = createMatchLog({
      config,
      vsBot: hasAiSeat(plan),
      botMode,
      seats: seatLogs,
      humanSeat: human,
      botSeat: bots[0],
    });
    saveMatchLog(nextLog);
    setLog(nextLog);
    setManualPause(false);
    setByokStatus(hasByokSeat(plan) ? 'BYOK seat(s) armed' : undefined);
    stateRef.current = opening;
    setState(opening);
    setSnap(mode.reset());
    softLockKey.current = null;
  };

  if (state === undefined || log === undefined) {
    const signedIn =
      typeof sessionStorage !== 'undefined' &&
      sessionStorage.getItem(GOOGLE_ID_TOKEN_SESSION_KEY) !== null;
    return (
      <Lobby
        plan={seatPlan}
        onPlan={(next) => {
          setSeatPlan(next);
          saveSeatPlan(next);
        }}
        onStart={() => {
          if (host?.mode() === 'online' && host.onlineModeOffered()) {
            void host.start().then(refresh);
            return;
          }
          void host?.start();
          startMatch(seatPlan);
        }}
        onLearn={() => {
          startLesson('L0');
        }}
        learnCardVisible={learnEpoch >= 0 && firstRunCardVisible(tutorialStore)}
        onDismissLearnCard={() => {
          tutorialStore.dismissCard();
          setLearnEpoch((n) => n + 1);
        }}
        {...(host === undefined
          ? {}
          : {
              online: {
                offered: host.onlineModeOffered(),
                mode: lobbyMode,
                onMode: (next: PagesLobbyMode) => {
                  let nextPlan = seatPlan;
                  if (lobbyMode === 'local' && next === 'online') {
                    nextPlan = coerceOnlineSeatPlan(seatPlan);
                    setSeatPlan(nextPlan);
                    saveSeatPlan(nextPlan);
                  }
                  setLobbyMode(next);
                  host.selectMode(next);
                  host.setSeatPlan(kindsForHost(nextPlan, next === 'online'));
                  refresh();
                },
                signedIn,
                onSignIn: () => {
                  host.promptSignIn();
                },
                onSignOut: () => {
                  host.signOut();
                  refresh();
                },
                createOffered: host.createOffered(),
                createInvitePending: host.createInvitePending(),
                onCreate: () => {
                  const creating = host.createInvite();
                  refresh();
                  void creating.finally(refresh);
                },
                acceptOffered: host.acceptOffered(),
                onAccept: () => {
                  void host.acceptInvite().then(refresh);
                },
                copiedUrl: host.copiedInviteUrl(),
                startOffered: host.startOffered(),
                inviteGone: host.inviteGone(),
                goneReason: host.adapter().inviteGoneReason(),
                lobbyFull: host.adapter().lobbyFull(),
                games: host.adapter().myGames()?.games ?? [],
                onOpenGame: (groupHash, gameNumber) => {
                  void host.openMyGame(groupHash, gameNumber).then(refresh);
                },
                seatKinds: host.seatKindOptions(),
                seatEditsOffered: host.seatEditsOffered(),
                inviteSeats: host.adapter().inviteSeats(),
                userHash: host.adapter().userHash(),
              },
            })}
      />
    );
  }

  const activeIsAi = aiSeatsRef.current.has(String(state.activePlayer));
  const activeSeat = seatConfigsRef.current.get(String(state.activePlayer));
  const byokActive = activeSeat?.kind === 'byok' && isByokReady(byokConfigForSeat(activeSeat));

  const inputLocked =
    botBusy ||
    activeIsAi ||
    state.winner !== undefined ||
    (tutorial !== undefined && !tutorial.session.boardInputOpen());
  /**
   * The docked count control's model, or `undefined` when there is nothing to ask.
   *
   * Absent with an empty draft (no run has been named yet), while a seat is
   * thinking and once the match is over — the three cases the spec names. It
   * carries no coordinate, so it cannot be positioned from the tip.
   */
  const dock = countControl({
    phase: snap.phase,
    inputLocked,
    matchOver: state.winner !== undefined,
  });
  /** The board is mid-resolution: a seat is thinking, or a major effect is playing. */
  const resolving = botBusy || activeIsAi || isResolving(fx, Date.now());

  const notePointer = (pointerType: string): void => {
    const next = pointerKindOf(pointerType);
    setPointerKind((prev) => (prev === next ? prev : next));
  };

  const onPointerDown = (e: PointerEvent<SVGSVGElement>): void => {
    notePointer(e.pointerType);
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    pointers.current.set(e.pointerId, { x, y });
    e.currentTarget.setPointerCapture(e.pointerId);

    if (pointers.current.size >= 2) {
      const pts = [...pointers.current.values()];
      const a = pts[0];
      const b = pts[1];
      if (a !== undefined && b !== undefined) {
        pinch.current = {
          dist: Math.hypot(b.x - a.x, b.y - a.y),
          midX: (a.x + b.x) / 2,
          midY: (a.y + b.y) / 2,
          moved: false,
        };
      }
      drag.current = null;
      return;
    }
    // Pan/zoom stay live during LLM waits — only arrow clicks / HUD actions are locked.
    drag.current = { x: e.clientX, y: e.clientY, moved: false };
  };

  const onPointerMove = (e: PointerEvent<SVGSVGElement>): void => {
    notePointer(e.pointerType);
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (pointers.current.has(e.pointerId)) {
      pointers.current.set(e.pointerId, { x, y });
    }

    if (pointers.current.size >= 2 && pinch.current !== null) {
      const pts = [...pointers.current.values()];
      const a = pts[0];
      const b = pts[1];
      if (a === undefined || b === undefined) return;
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      const prev = pinch.current;
      if (prev.dist > 4 && dist > 4) {
        const factor = dist / prev.dist;
        if (Math.abs(factor - 1) > 0.001 || Math.hypot(midX - prev.midX, midY - prev.midY) > 1) {
          pinch.current = { dist, midX, midY, moved: true };
          setHover(undefined);
          setHoverArrow(undefined);
          setViewport((v) => {
            const zoomed = zoomAt(v, prev.midX, prev.midY, factor);
            return panBy(zoomed, midX - prev.midX, midY - prev.midY);
          });
        }
      } else {
        pinch.current = { dist, midX, midY, moved: prev.moved };
      }
      return;
    }

    if (drag.current === null) {
      // Inspect tips are a fine-pointer read-out. On touch they pin after the
      // first move event and cover the rail (P44 mobile playtest: the share
      // label "NEXT" reads as the lesson button).
      if (pointerKindOf(e.pointerType) === 'coarse') return;
      const vertex = hitSpawnerVertex(layout, viewport, x, y, spawnerVertices, 16);
      setHover(vertex === undefined ? undefined : { vertex, x, y });
      const over = hitArrow(layout, viewport, x, y, arrows, hitPadding(e.pointerType));
      // Hover is a *lookup*: `routePaint` reads the preview out of the offer the
      // phase already carries, so a fine-pointer sweep costs no measurement (P34).
      setHoverArrow(over === undefined ? undefined : { arrow: over, x, y });
      return;
    }
    setHover(undefined);
    setHoverArrow(undefined);
    const dx = e.clientX - drag.current.x;
    const dy = e.clientY - drag.current.y;
    if (Math.hypot(dx, dy) > 3) drag.current.moved = true;
    if (!drag.current.moved) return;
    setViewport((v) => panBy(v, dx, dy));
    drag.current = { x: e.clientX, y: e.clientY, moved: true };
  };

  const onPointerUp = (e: PointerEvent<SVGSVGElement>): void => {
    notePointer(e.pointerType);
    pointers.current.delete(e.pointerId);
    const pinched = pinch.current?.moved === true;
    if (pointers.current.size < 2) pinch.current = null;

    const wasDrag = drag.current?.moved === true;
    const hadPointer = drag.current !== null;
    drag.current = null;
    if (pointerKindOf(e.pointerType) === 'coarse') {
      setHover(undefined);
      setHoverArrow(undefined);
    }
    if (pinched || !hadPointer || wasDrag || inputLocked) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const arrow = hitArrow(layout, viewport, sx, sy, arrows, hitPadding(e.pointerType));
    if (arrow === undefined) {
      commitSnap(liveInput().onBackgroundClick());
      return;
    }
    // Drop capture so the tip control owns the next events (and the ghost tap from
    // this finger-up cannot bounce back into the board).
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    pointers.current.clear();
    commitSnap(liveInput().onArrowClick(arrow, state, rules));
  };

  const onPointerLeave = (): void => {
    drag.current = null;
    pointers.current.clear();
    pinch.current = null;
    setHover(undefined);
    setHoverArrow(undefined);
  };

  const onWheel = (e: WheelEvent<SVGSVGElement>): void => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    setViewport((v) => zoomAt(v, e.clientX - rect.left, e.clientY - rect.top, factor));
  };

  const selectedFrom = snap.phase.kind === 'idle' ? undefined : snap.phase.from;
  const convertCopy =
    hoverArrow === undefined
      ? undefined
      : convertTooltip(state, geometry, rules, selectedFrom, hoverArrow.arrow);
  const tutorialStep = tutorial?.session.step();
  const snapCoach = tutorial === undefined ? undefined : (snap as TutoredSnapshot).coach;
  const tutorialCoach =
    snapCoach ?? (tutorialStep?.kind === 'expect' ? tutorialStep.coach : undefined);
  const restriction = tutorialStep === undefined ? undefined : restrictionFor(tutorialStep);
  const railTargets = restriction === undefined ? undefined : lessonTargets(restriction);
  const tutorialFocus =
    tutorialStep?.kind === 'narrate' &&
    tutorialStep.focus !== undefined &&
    tutorialStep.focus.length > 0
      ? new Set(tutorialStep.focus)
      : railTargets !== undefined && railTargets.size > 0
        ? railTargets
        : undefined;
  const focusArrow =
    tutorialStep?.kind === 'narrate' && tutorialStep.focus !== undefined
      ? tutorialStep.focus[0]
      : undefined;
  const narrateBox = ((): ReturnType<typeof narrateCardBox> | undefined => {
    if (focusArrow === undefined) return undefined;
    const at = arrowCentroid(focusArrow);
    return narrateCardBox(viewport, toScreen(viewport, at.x, at.y));
  })();
  const tutorialHud: TutorialHud | undefined =
    tutorial === undefined
      ? undefined
      : {
          title: tutorial.lesson.title,
          practice: practiceBoard(tutorial.lesson.config),
          coach: tutorialCoach,
          onRestart: restartLesson,
          onSkipLesson: skipLesson,
        };

  return (
    <div className="app">
      <Hud
        state={state}
        victory={victory}
        phase={snap.phase}
        movableCount={movable.size}
        vsBot={tutorial !== undefined ? false : log.vsBot}
        byokActive={byokActive}
        byokStatus={byokStatus ?? log.byokStats?.lastError}
        botBusy={botBusy}
        pauseOffered={pauseOffered({
          vsBot: tutorial !== undefined ? false : log.vsBot,
          online: onlinePlayRef.current,
          matchOver: state.winner !== undefined,
          tutorial: tutorial !== undefined,
        })}
        pauseKind={pauseKind({ manual: manualPause, idle: idleHold })}
        manualPause={manualPause}
        aiChair={activeIsAi}
        onTogglePause={() => {
          setManualPause((prev) => !prev);
        }}
        seatSummary={log.seats.map((s) => `${String(s.player)}=${displaySeatKind(s.kind)}`).join(' · ')}
        moveCount={log.moves.length}
        matchSummary={matchSummaryLine(victory.kind === 'over', log.summary)}
        heads={activeTotals.heads}
        land={activeTotals.land}
        refusalNote={refusalNote}
        soundOn={soundOn}
        onToggleSound={() => {
          const next = !soundOn;
          setSoundOn(next);
          saveSoundEnabled(next);
        }}
        onEndTurn={() => {
          if (inputLocked) return;
          commitSnap(liveInput().requestEndTurn());
        }}
        onSkip={() => {
          if (inputLocked) return;
          commitSnap(liveInput().requestSkip(state, rules));
        }}
        onDownloadLog={() => {
          downloadMatchLog(withWinner(log, state.winner));
        }}
        onNewMatch={returnToLobby}
        illegal={host?.illegal()}
        {...(tutorialHud === undefined ? {} : { tutorial: tutorialHud })}
      />
      <div className="stage" ref={shellRef}>
        {/* Whose turn it is, and whether the board is still resolving — an edge
            ring rather than a modal.

            Two nodes, because they are two facts with two animations. The outer
            ring is keyed on the active seat, so its handover sweep plays exactly
            once per change of hands; the inner one only exists while the board is
            resolving. One node carrying both classes would restart the handover
            sweep every time an effect finished. */}
        {tutorial === undefined ? (
          <div
            key={`turn-${String(state.activePlayer)}`}
            className="turn-ring handover"
            style={{ ['--turn-tint' as string]: styleFor(state.activePlayer).fill }}
            aria-hidden
          />
        ) : null}
        {resolving ? (
          <div
            className="turn-ring resolving"
            style={{ ['--turn-tint' as string]: styleFor(state.activePlayer).fill }}
            aria-hidden
          />
        ) : null}
        <Board
          geometry={geometry}
          layout={layout}
          state={state}
          viewport={viewport}
          arrows={arrows}
          vertices={vertices}
          highlights={boardHighlights}
          chrome={chrome}
          route={route}
          movable={movable}
          effects={fx}
          victory={victory}
          {...(hover === undefined ? {} : { hoveredSpawner: hover.vertex })}
          {...(tutorialFocus === undefined ? {} : { focus: tutorialFocus })}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerLeave}
          onWheel={onWheel}
        />
        {tutorial === undefined ? null : (
          <>
            {tutorial.session.halted() ||
            tutorial.session.step().kind === 'narrate' ||
            tutorial.session.step().kind === 'end' ? (
              <div className="tutorial-dim" aria-hidden />
            ) : null}
            <TutorialOverlay
              step={tutorial.session.step()}
              halted={tutorial.session.halted()}
              haltDetail={tutorial.session.halted() ? tutorial.session.haltDetail() : undefined}
              onNext={advanceTutorial}
              {...(tutorialCoach === undefined ? {} : { coach: tutorialCoach })}
              {...(narrateBox === undefined ? {} : { cardBox: narrateBox })}
            />
          </>
        )}
        {convertCopy !== undefined && hoverArrow !== undefined ? (
          <ConvertTip
            text={convertCopy}
            x={hoverArrow.x}
            y={hoverArrow.y}
            stageWidth={viewport.width}
            stageHeight={viewport.height}
          />
        ) : hover !== undefined ? (
          <SpawnerTipFor state={state} hover={hover} viewport={viewport} />
        ) : null}
      </div>
      {/* The count control for the drafted run, **outside** the board — see
          `RouteDock`. Rendered here, as a sibling of the board's container, so no
          stage pixel can reach it and nothing it draws can cover the offer it is
          asking about.

          Rendered *unconditionally*, with `control` undefined when there is
          nothing to ask: the strip then paints nothing but keeps its row, so the
          board does not shrink by the strip's height on the first click of every
          route — which would slide every arrow under the player's finger
          mid-gesture, on the one packet whose premise is that the model reads
          badly on a phone. */}
      <RouteDock
        control={dock}
        onCount={setCarry}
        onSend={() => {
          commitSnap(liveInput().send());
        }}
        onCancel={() => {
          commitSnap(liveInput().cancel());
        }}
      />
    </div>
  );
};
