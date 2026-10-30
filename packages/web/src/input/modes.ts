/**
 * Hot-seat input — draft a route from straight runs, then send it (P34).
 *
 * Selecting a stack opens the `route` phase: the three **rays** light up, a click
 * appends a straight **run** to a drafted route, and the tip moves there. Nothing
 * touches the board until Send, so every arrow of the trail was named by a click
 * rather than picked by `outArrows` iteration order — which is the whole point,
 * because the trail *is* the move (§5–§7).
 *
 * The measurement lives in `route.ts`; this module is the state machine. It holds
 * the live board it was last clicked against, because `setCarry` and `send` are
 * called without one.
 */

import { endTurn } from '@conquarrow/contracts';
import type { ArrowId, GameState, GeometryPort, Move, RulesPort } from '@conquarrow/contracts';
import type { RefusalReason } from '../fx/present';
import { refusedConvertExits } from '../refusedConvert';
import {
  buildRouteOffer,
  draftExits,
  isTerminalStep,
  lastRunLength,
  runMoves,
  type LastRun,
  type RouteOffer,
  type RouteOption,
} from '../route';

/**
 * Drafting a route (P34, reordered by P35): the source, the run-by-run draft, and
 * the tip it grows from. `portion` is retired by this phase — a destination click
 * no longer opens a modal, because there is no destination to disambiguate.
 *
 * P35 moved the count *after* the click: a run is drafted at the largest count
 * that walks it, and `setCarry` then rewrites that run. So nothing here is a
 * forward-looking budget — `carry` is the count of the run already drawn, and
 * `runLengths` says where the runs begin and end.
 *
 * Nothing here is applied to the board. `draft` is a list of `step` moves waiting
 * for Send. P77 retired the apply-on-click: no click sends, however little it
 * leaves to decide.
 */
export interface RoutePhase {
  readonly kind: 'route';
  /** The original source arrow. Clicking it re-selects it with an empty draft (P77). */
  readonly from: ArrowId;
  /** Last arrow the draft walks, or `from` when the draft is empty. */
  readonly tip: ArrowId;
  /**
   * The count on the **last drafted run** (P35).
   *
   * No longer a value carried forward across runs: the count is asked *after*
   * the click, so it addresses the run behind it. With an empty draft it is the
   * tip's head count, so nothing reads a stale number.
   */
  readonly carry: number;
  /** Heads standing on the tip after the draft — read off the state, not the carry. */
  readonly tipHeads: number;
  readonly draft: readonly Move[];
  /**
   * One entry per run, in order, summing to `draft.length` (P35).
   *
   * This is what lets the count control rewrite exactly one run: drop the
   * trailing `runLengths[last]` moves, re-emit them at the new count, rebuild. A
   * run is defined by the click that made it, and a flat `Move[]` does not record
   * where a click ended.
   *
   * A single trailing length would not do: popping back to a boundary *before*
   * the last run has to restore the earlier run as the editable one, and a scalar
   * does not record that history. `lastRunLength` is therefore derived from this
   * list, never stored. A pop into the middle of a run truncates that run — the
   * surviving part becomes the last entry.
   */
  readonly runLengths: readonly number[];
  /** Built once per selection, extend, pop and count change — never per hover. */
  readonly offer: RouteOffer;
}

export type InputPhase =
  | { readonly kind: 'idle' }
  | { readonly kind: 'blocked'; readonly from: ArrowId }
  | RoutePhase;

export interface InputHighlights {
  readonly selected?: ArrowId;
  /** The clickable set — unique-route arrows from the tip. */
  readonly targets: ReadonlySet<ArrowId>;
  /**
   * Grain-adjacent self-convert exits of the selected stack (P28). Painted as a
   * refused wash — not reach, not a click target.
   *
   * P77: measured at the **tip** on the scratch state the draft leaves, and set
   * by the mode itself rather than patched in by the app.
   */
  readonly refused?: ReadonlySet<ArrowId>;
  /**
   * Merge targets (P77): own stacks, other than the tip, that the current offer
   * can reach. Never in `targets` — a click on one selects it; the strip's
   * **Merge into** button drafts it through {@link InputMode.mergeInto}.
   */
  readonly merges?: ReadonlySet<ArrowId>;
}

export interface InputSnapshot {
  readonly phase: InputPhase;
  readonly highlights: InputHighlights;
  /** Moves waiting for the host to apply, in order. A route is several steps. */
  readonly pending?: readonly Move[];
  /**
   * A click that could not do anything, and where (Event 11).
   *
   * One-shot: it rides on the snapshot the refused click produced and is never
   * carried into the next one, so the same refusal cannot re-fire on a later
   * no-op. Silence used to be the whole answer here — a player learned the
   * constraint by guessing.
   */
  readonly refusal?: { readonly arrow: ArrowId; readonly reason: RefusalReason };
}

export interface InputMode {
  readonly id: string;
  readonly label: string;
  reset(): InputSnapshot;
  onArrowClick(arrow: ArrowId, state: GameState, rules: RulesPort): InputSnapshot;
  onBackgroundClick(): InputSnapshot;
  /**
   * Select `arrow` explicitly (P77): open the route phase on it with an empty
   * draft, or the blocked phase with a `no-exit` refusal. Never a destination,
   * never a deselect. What `Next stack`, the turn anchor and the post-commit
   * advance call — never `onArrowClick`.
   */
  select(arrow: ArrowId, state: GameState, rules: RulesPort): InputSnapshot;
  /**
   * Draft the merge onto the own stack on `arrow` (P77) — exactly what the old
   * merge click drafted. An arrow outside `highlights.merges` leaves the draft
   * unchanged and is refused `out-of-reach`.
   */
  mergeInto(arrow: ArrowId): InputSnapshot;
  /**
   * Set the count on the **last drafted run** (P35), re-emitting exactly its
   * moves.
   *
   * This is the inversion P35 makes: the count addresses the run *behind* the
   * tip, not the run ahead of it. P34 set the carry at the tip before the click,
   * forward only — so the player budgeted heads for a trip they had not yet
   * described, and the offer shrank to match the guess.
   *
   * Every earlier run stays byte-identical; a count the offer does not list is
   * ignored. Lowering it leaves the difference standing where the run began, as
   * a sentry (§5), and repaints the offer from the new tip — fewer heads arrived
   * there, so less is reachable onward.
   */
  setCarry(count: number): InputSnapshot;
  /** Emit the draft as `pending`, in draft order, and return to idle. */
  send(): InputSnapshot;
  /** Discard the draft and return to idle — Cancel, background click, Escape. */
  cancel(): InputSnapshot;
  requestEndTurn(): InputSnapshot;
}

const emptyHighlights = (): InputHighlights => ({ targets: new Set() });

const idle = (): InputSnapshot => ({
  phase: { kind: 'idle' },
  highlights: emptyHighlights(),
});

const isOwn = (arrow: ArrowId, state: GameState): boolean =>
  state.groups.get(arrow)?.owner === state.activePlayer;

const isEnemy = (arrow: ArrowId, state: GameState): boolean => {
  const owner = state.groups.get(arrow)?.owner;
  return owner !== undefined && owner !== state.activePlayer;
};

const headsOn = (state: GameState, arrow: ArrowId): number =>
  state.groups.get(arrow)?.heads ?? 0;

/** The board a click was last made against — `setCarry` / `send` carry no state. */
interface Board {
  readonly state: GameState;
  readonly rules: RulesPort;
}

/** The scratch state after a draft, its terminality, and where its last run began. */
interface Walked {
  readonly state: GameState;
  readonly terminal: boolean;
  /**
   * The board as it stood **before** the last run, and the arrow that run left
   * from — what its counts are measured on, and what caps them.
   *
   * Absent when the walk never reached the boundary it was given: an empty draft,
   * or a reading that asked for no run at all ({@link draftState}).
   */
  readonly run?: { readonly state: GameState; readonly start: ArrowId };
}

/**
 * Walk the draft on a scratch state, noting the boundary of its last run.
 *
 * Terminality is measured *here*, hop by hop, because the state after the draft
 * cannot tell: combat has already destroyed the heads that would give it away
 * (`route.ts`'s `RouteInputs.terminal`).
 *
 * The run boundary is picked up in the same pass rather than by a second walk:
 * the count control needs the board as it stood *before* the last run, and
 * re-walking the prefix to find it is the kind of second derivation this feature
 * exists to avoid.
 */
const walkDraft = (board: Board, draft: readonly Move[], boundary: number): Walked => {
  let state = board.state;
  let terminal = false;
  let run: Walked['run'];
  let index = 0;
  for (const move of draft) {
    if (move.kind !== 'step') continue;
    if (index === boundary) run = { state, start: move.from };
    const before = state;
    state = board.rules.apply(before, move);
    terminal = isTerminalStep(before, state, move);
    index += 1;
  }
  return run === undefined ? { state, terminal } : { state, terminal, run };
};

/**
 * One entry per run, truncated to the first `keep` moves (P35).
 *
 * A pop into the **middle** of a run keeps the runs before it whole and shortens
 * the run it lands in, which then becomes the editable one. A scalar trailing
 * length could not say that, which is why the boundaries are a list.
 */
const truncateRuns = (runLengths: readonly number[], keep: number): readonly number[] => {
  const out: number[] = [];
  let total = 0;
  for (const run of runLengths) {
    if (total >= keep) break;
    out.push(Math.min(run, keep - total));
    total += run;
  }
  return out;
};

/** The count on the last step of a draft — the count of its last run. */
const lastCount = (draft: readonly Move[]): number | undefined => {
  for (let i = draft.length - 1; i >= 0; i -= 1) {
    const move = draft[i];
    if (move?.kind === 'step') return move.count;
  }
  return undefined;
};

abstract class BaseMode implements InputMode {
  abstract readonly id: string;
  abstract readonly label: string;

  protected snap: InputSnapshot = idle();
  /** The board the last click was made against. Undefined until the first one. */
  private board: Board | undefined;

  constructor(protected readonly geometry: GeometryPort) {}

  reset(): InputSnapshot {
    this.snap = idle();
    return this.snap;
  }

  onBackgroundClick(): InputSnapshot {
    return this.reset();
  }

  /**
   * Enter (or repaint) the route phase for a draft and its run boundaries.
   *
   * The carry is **read off the draft** — the count on its last step — rather
   * than passed in and clamped, because P35 redefines it as the count of the run
   * behind the tip rather than a value carried forward across runs. With an empty
   * draft it is the tip's head count, so nothing reads a stale number.
   *
   * The **offer** is measured at the heads standing on the tip, which is the
   * carry wherever the draft can continue at all: a run's whole count arrives.
   * Where the two differ the last step was terminal — a merge raises the tip's
   * count, combat lowers it — and a terminal tip offers nothing either way.
   */
  protected enterRoute(
    from: ArrowId,
    draft: readonly Move[],
    runLengths: readonly number[],
  ): InputSnapshot {
    const board = this.board;
    if (board === undefined) return this.snap;
    const runLength = lastRunLength(runLengths);
    const walked = walkDraft(board, draft, draft.length - runLength);
    const exits = draftExits(draft);
    const tip = exits[exits.length - 1] ?? from;
    const tipHeads = headsOn(walked.state, tip);
    const carry = lastCount(draft) ?? tipHeads;
    const offer = buildRouteOffer({
      geometry: this.geometry,
      rules: board.rules,
      state: walked.state,
      from,
      tip,
      draft,
      carry: tipHeads,
      tipHeads,
      terminal: walked.terminal,
      ...(walked.run === undefined
        ? {}
        : {
            lastRun: {
              state: walked.run.state,
              start: walked.run.start,
              steps: exits.slice(exits.length - runLength),
            } satisfies LastRun,
          }),
    });
    this.snap = {
      phase: { kind: 'route', from, tip, carry, tipHeads, draft, runLengths, offer },
      highlights: this.routeHighlights(board, from, offer, walked.state),
    };
    return this.snap;
  }

  /**
   * Split the offer into what a click drafts and what the strip merges (P77),
   * and name the tip's refused grain neighbours.
   *
   * An own stack on the **live** board is never a click target — a click on it
   * selects it — so the offer's own stacks become merge targets instead. The tip
   * itself is never on the offer (it is walked), so no filter is needed for it.
   *
   * `refused` is measured at the **tip** on the scratch state the draft leaves:
   * the source's grain neighbours stop mattering once the draft has moved on.
   */
  private routeHighlights(
    board: Board,
    from: ArrowId,
    offer: RouteOffer,
    scratch: GameState,
  ): InputHighlights {
    const targets = new Set<ArrowId>();
    const merges = new Set<ArrowId>();
    for (const arrow of offer.clickable.keys()) {
      (isOwn(arrow, board.state) ? merges : targets).add(arrow);
    }
    const refused = refusedConvertExits(scratch, this.geometry, board.rules, offer.tip);
    return {
      selected: from,
      targets,
      ...(merges.size === 0 ? {} : { merges }),
      ...(refused.size === 0 ? {} : { refused }),
    };
  }

  /**
   * Select `from` with an empty draft, or report it stuck when nothing is
   * clickable (P77: the explicit select — never a destination, never a toggle).
   */
  select(from: ArrowId, state: GameState, rules: RulesPort): InputSnapshot {
    this.board = { state, rules };
    const opened = this.enterRoute(from, [], []);
    if (opened.phase.kind === 'route' && opened.phase.offer.clickable.size > 0) return opened;
    this.snap = {
      phase: { kind: 'blocked', from },
      highlights: { selected: from, targets: new Set() },
    };
    return { ...this.snap, refusal: { arrow: from, reason: 'no-exit' } };
  }

  /**
   * Append a run (and its optional final turn) to the draft, and move the tip.
   *
   * The run is drafted at `option.count` — the largest count that walks it, as the
   * offer measured it — not at the carry of the run before it. That is the
   * inversion: full strength first, and the count asked afterwards.
   *
   * Nothing is applied, however little the click left to decide (P77): every
   * move is drafted, then sent.
   */
  private extend(phase: RoutePhase, option: RouteOption): InputSnapshot {
    const moves = runMoves(phase.tip, option.steps, option.count);
    return this.enterRoute(
      phase.from,
      [...phase.draft, ...moves],
      [...phase.runLengths, moves.length],
    );
  }

  /**
   * Truncate the draft to the prefix ending at `arrow`.
   *
   * The surviving moves keep the counts they were drafted with, so the run the pop
   * lands in becomes the editable one at the count it already carries — a pop is
   * an undo, not a re-count. A pop *inside* a run truncates it (P35
   * {@link truncateRuns}).
   */
  private popTo(phase: RoutePhase, arrow: ArrowId): InputSnapshot {
    if (arrow === phase.from) return this.enterRoute(phase.from, [], []);
    const index = draftExits(phase.draft).indexOf(arrow);
    if (index < 0) return this.snap;
    const keep = index + 1;
    return this.enterRoute(
      phase.from,
      phase.draft.slice(0, keep),
      truncateRuns(phase.runLengths, keep),
    );
  }

  /**
   * Rewrite the **last run** at `count`, leaving every earlier run byte-identical.
   *
   * P35's inversion: the count addresses the run behind the tip, not the run ahead
   * of it. Exactly the trailing `lastRunLength` moves are re-emitted, from the
   * arrow that run started at, so the boundaries do not move.
   *
   * A count the offer does not list is ignored — the offer is the measurement, and
   * a control that could set an unwalkable number would be offering a refusal.
   */
  setCarry(count: number): InputSnapshot {
    const { phase } = this.snap;
    if (phase.kind !== 'route') return this.snap;
    if (!phase.offer.carries.includes(count)) return this.snap;
    const runLength = lastRunLength(phase.runLengths);
    if (runLength === 0) return this.snap;
    const boundary = phase.draft.length - runLength;
    const exits = draftExits(phase.draft);
    const start = exits[boundary - 1] ?? phase.from;
    const draft = [
      ...phase.draft.slice(0, boundary),
      ...runMoves(start, exits.slice(boundary), count),
    ];
    return this.enterRoute(phase.from, draft, phase.runLengths);
  }

  send(): InputSnapshot {
    const { phase } = this.snap;
    if (phase.kind !== 'route' || phase.draft.length === 0) return this.snap;
    this.snap = {
      phase: { kind: 'idle' },
      highlights: emptyHighlights(),
      pending: [...phase.draft],
    };
    return this.snap;
  }

  cancel(): InputSnapshot {
    return this.reset();
  }

  /**
   * Draft the merge onto `arrow` — the strip's **Merge into** button (P77).
   *
   * Exactly the run the old merge click drafted: the offer's option for that
   * arrow. Anything outside `highlights.merges` leaves the draft as it was.
   */
  mergeInto(arrow: ArrowId): InputSnapshot {
    const { phase } = this.snap;
    const option = phase.kind === 'route' ? phase.offer.clickable.get(arrow) : undefined;
    if (phase.kind !== 'route' || option === undefined || this.snap.highlights.merges?.has(arrow) !== true) {
      return this.refuse(arrow, 'out-of-reach');
    }
    return this.extend(phase, option);
  }

  requestEndTurn(): InputSnapshot {
    this.snap = { phase: { kind: 'idle' }, highlights: emptyHighlights(), pending: [endTurn()] };
    return this.snap;
  }

  /**
   * The clicks a route draft answers, once the own-stack branch has passed:
   * pop, extend, or say why not (P77 *The click, decided*).
   */
  protected onRouteClick(phase: RoutePhase, arrow: ArrowId): InputSnapshot {
    if (arrow === phase.from || draftExits(phase.draft).includes(arrow)) {
      return this.popTo(phase, arrow);
    }
    const option = phase.offer.clickable.get(arrow);
    if (option !== undefined) return this.extend(phase, option);
    if (this.snap.highlights.refused?.has(arrow) === true) return this.refuse(arrow, 'would-convert');
    if (phase.offer.reachWash.has(arrow)) return this.refuse(arrow, 'not-one-run');
    // P34 once sorted the stay-behind case out of this; P35 retired it, because
    // the offer arms that attack itself — if a count could take the arrow, the
    // click would have extended.
    return this.refuse(arrow, 'out-of-reach');
  }

  /** The snapshot to return for a click that did nothing, plus why. */
  protected refuse(arrow: ArrowId, reason: RefusalReason): InputSnapshot {
    return { ...this.snap, refusal: { arrow, reason } };
  }

  /**
   * One click, decided (P77). The own-stack branch comes **first**: a click on
   * your own stack selects it, whatever the phase, draft or offer — so it can
   * never be read as a destination. Merges go through {@link mergeInto}.
   */
  onArrowClick(arrow: ArrowId, state: GameState, rules: RulesPort): InputSnapshot {
    this.board = { state, rules };
    if (isOwn(arrow, state)) return this.select(arrow, state, rules);
    const { phase } = this.snap;
    if (phase.kind === 'route') return this.onRouteClick(phase, arrow);
    if (phase.kind === 'blocked') return this.refuse(arrow, 'no-exit');
    // Nothing happened, so say what stopped it *at the tile that was clicked*.
    return this.refuse(arrow, isEnemy(arrow, state) ? 'not-yours' : 'nothing-selected');
  }
}

/** Route drafting: pick a stack, click along the rays, send (SPEC §5). */
export class GalconInput extends BaseMode {
  readonly id = 'galcon';
  readonly label = 'Galcon';
}

/** Sole hot-seat input mode. */
export const createInputMode = (geometry: GeometryPort): InputMode => new GalconInput(geometry);
