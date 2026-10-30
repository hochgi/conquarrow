import type { GameState } from '@conquarrow/contracts';
import type { ReactElement } from 'react';
import {
  pauseButtonLabel,
  pauseHint,
  turnControlsLocked,
  type PauseKind,
} from './botPause';
import { styleFor } from './colors';
import { matchLocked } from './fx/celebration';
import type { VictoryFx } from './fx/victory';
import type { InputPhase } from './input/modes';
import { routeHint } from './route';

export interface HudProps {
  readonly state: GameState;
  readonly victory: VictoryFx;
  readonly phase: InputPhase;
  readonly movableCount: number;
  readonly vsBot: boolean;
  readonly byokActive: boolean;
  readonly byokStatus: string | undefined;
  readonly botBusy: boolean;
  readonly pauseOffered: boolean;
  readonly pauseKind: PauseKind;
  readonly manualPause: boolean;
  readonly aiChair: boolean;
  readonly onTogglePause: () => void;
  readonly seatSummary: string;
  readonly moveCount: number;
  /** One-line playtest summary when the match is over. */
  readonly matchSummary: string | undefined;
  /** Heads in hand for the player to move — bumps when it changes. */
  readonly heads: number;
  /** Arrows of territory held by the player to move — bumps when it changes. */
  readonly land: number;
  readonly soundOn: boolean;
  readonly onToggleSound: () => void;
  readonly onEndTurn: () => void;
  readonly onNextStack: () => void;
  readonly onDownloadLog: () => void;
  readonly onNewMatch: () => void;
  readonly illegal: string | undefined;
  readonly tutorial?: TutorialHud;
}

export interface TutorialHud {
  readonly title: string;
  readonly practice: boolean;
  readonly coach: string | undefined;
  readonly onRestart: () => void;
  readonly onSkipLesson: () => void;
}

const phaseHint = (
  phase: InputPhase,
  movableCount: number,
  botBusy: boolean,
  vsBot: boolean,
  byokActive: boolean,
  kind: PauseKind,
): string => {
  const held = pauseHint(kind);
  if (held !== undefined) return held;
  if (botBusy) return byokActive ? 'LLM seat is thinking…' : 'AI seat is moving…';
  switch (phase.kind) {
    case 'idle':
      if (movableCount === 0) {
        return 'No steps left — passing…';
      }
      return vsBot
        ? 'Your turn — gold-outlined stacks can still move'
        : 'Gold-outlined stacks can still move';
    case 'blocked':
      return 'This stack has nowhere to go. Another gold stack is auto-selected when one finishes';
    case 'route':
      return routeHint(phase) ?? '';
  }
};

/**
 * Every seat on the starvation clock, in `state.players` order (P36).
 *
 * The old single-holder line could only name one; destitution is per seat now,
 * and the order is read off `players` rather than the map so the label is
 * deterministic.
 */
const starvationNote = (state: GameState): string | null => {
  const onClock = state.players.filter(
    (player) => (state.starvationStreaks.get(player) ?? 0) > 0,
  );
  if (onClock.length === 0) return null;
  const parts = onClock.map(
    (player) =>
      `${styleFor(player).label} ${String(state.starvationStreaks.get(player) ?? 0)}/${String(state.dominationN)}`,
  );
  return ` · starvation ${parts.join(', ')}`;
};

/**
 * The HUD's buttons (P77): every slot always mounted, so nothing above or
 * around them can move one. Rendered directly under the `h1`.
 */
const ActionRow = ({
  controlsLocked,
  pauseOffered,
  manualPause,
  soundOn,
  onNextStack,
  onEndTurn,
  onTogglePause,
  onDownloadLog,
  onNewMatch,
  onToggleSound,
  tutorial,
}: Pick<
  HudProps,
  | 'pauseOffered'
  | 'manualPause'
  | 'soundOn'
  | 'onNextStack'
  | 'onEndTurn'
  | 'onTogglePause'
  | 'onDownloadLog'
  | 'onNewMatch'
  | 'onToggleSound'
  | 'tutorial'
> & { readonly controlsLocked: boolean }): ReactElement => (
  <div className="actions">
    <button
      type="button"
      onClick={onNextStack}
      disabled={controlsLocked}
    >
      Next stack
    </button>
    <button type="button" onClick={onEndTurn} disabled={controlsLocked}>
      End turn
    </button>
    {/* Always mounted (P77): when Pause is not offered its slot is a hidden,
        disabled placeholder that keeps its width, so Download log and Lobby
        never shift when it comes and goes. */}
    {pauseOffered ? (
      <button
        type="button"
        onClick={onTogglePause}
        aria-pressed={manualPause}
        title="Hold bot seats until Resume. All-bot matches also pause when this tab is in the background."
      >
        {pauseButtonLabel(manualPause)}
      </button>
    ) : (
      <button type="button" disabled aria-hidden="true" tabIndex={-1} style={{ visibility: 'hidden' }}>
        {pauseButtonLabel(manualPause)}
      </button>
    )}
    <button type="button" onClick={onDownloadLog}>
      Download log
    </button>
    <button type="button" onClick={onNewMatch}>
      Lobby
    </button>
    {/* Sound reinforces the five events that decide matches; it never carries
        information the board does not already show, which is why off is a fine
        default and why it is a toggle rather than a settings screen. */}
    <button
      type="button"
      onClick={onToggleSound}
      aria-pressed={soundOn}
      title="Audio cues for closures, captures, cuts, combat and production"
    >
      Sound: {soundOn ? 'on' : 'off'}
    </button>
    {/* The tutorial's two buttons stay last (P77). */}
    {tutorial === undefined ? null : (
      <>
        <button type="button" onClick={tutorial.onRestart}>
          Restart lesson
        </button>
        <button type="button" onClick={tutorial.onSkipLesson}>
          Skip lesson
        </button>
      </>
    )}
  </div>
);

export const Hud = ({
  state,
  victory,
  phase,
  movableCount,
  vsBot,
  byokActive,
  byokStatus,
  botBusy,
  pauseOffered,
  pauseKind: kind,
  manualPause,
  aiChair,
  onTogglePause,
  seatSummary,
  moveCount,
  matchSummary,
  heads,
  land,
  soundOn,
  onToggleSound,
  onEndTurn,
  onNextStack,
  onDownloadLog,
  onNewMatch,
  illegal,
  tutorial,
}: HudProps): ReactElement => {
  const active = styleFor(state.activePlayer);
  // Read off `winner`, never off the celebration (P38 invariant 12). While the
  // deciding move's overlays play out, `victory` deliberately reads *playing* — so
  // `controlsLocked(victory)` would unlock Next stack and End turn for the length of the
  // winning animation, on a board where `apply` refuses every move. `App.tsx`'s
  // `inputLocked` has always read `winner`; this is the same source of truth.
  const locked = matchLocked(state);
  const controlsLocked = turnControlsLocked({
    matchOver: locked,
    botBusy,
    aiChair,
  });
  return (
    <aside className="hud">
      <h1>Conquarrow</h1>
      {/* The action row comes before every variable-length line (P77), so no
          status text above the buttons can move them. */}
      <ActionRow
        controlsLocked={controlsLocked}
        pauseOffered={pauseOffered}
        manualPause={manualPause}
        soundOn={soundOn}
        onNextStack={onNextStack}
        onEndTurn={onEndTurn}
        onTogglePause={onTogglePause}
        onDownloadLog={onDownloadLog}
        onNewMatch={onNewMatch}
        onToggleSound={onToggleSound}
        {...(tutorial === undefined ? {} : { tutorial })}
      />
      {tutorial !== undefined ? (
        <p className="banner">
          Learn: <strong>{tutorial.title}</strong>
          {tutorial.practice ? ' · practice board' : null}
        </p>
      ) : victory.kind === 'over' ? (
        <p className="banner win">{victory.banner}</p>
      ) : (
        <p className="banner" style={{ borderColor: active.fill }}>
          Turn: <strong style={{ color: active.fill }}>{active.label}</strong>
          {vsBot
            ? kind !== 'running'
              ? ' · paused'
              : botBusy
                ? byokActive
                  ? ' · llm'
                  : ' · ai'
                : ' · you'
            : null}
          {starvationNote(state)}
        </p>
      )}
      <p className="hint">
        {victory.kind === 'over'
          ? victory.hint
          : phaseHint(phase, movableCount, botBusy, vsBot, byokActive, kind)}
      </p>
      {tutorial?.coach !== undefined ? <p className="hint byok-status">{tutorial.coach}</p> : null}
      {byokStatus !== undefined ? <p className="hint byok-status">{byokStatus}</p> : null}
      {illegal !== undefined ? <p className="hint lobby-byok-warn">{illegal}</p> : null}
      {/* Keyed on the value: React remounts the span, so the bump animation
          replays on every change without a single timer. The delay in CSS lands
          the emphasis with the capture fill, not before it. */}
      <p className="meta">
        Heads:{' '}
        <span key={`heads-${String(heads)}`} className="hud-bump">
          {heads}
        </span>
        {' · '}Land:{' '}
        <span key={`land-${String(land)}`} className="hud-bump">
          {land}
        </span>
      </p>
      <p className="meta">Seats: {seatSummary}</p>
      <p className="meta">Moves logged: {moveCount}</p>
      {matchSummary !== undefined ? (
        <p className="meta match-summary">Summary: {matchSummary}</p>
      ) : null}

      <p className="help">
        Drag to pan · pinch or wheel to zoom · gold outline = movable this turn
        (one is selected for you as a turn starts and after each Send; Next stack
        walks through them all, then none) · click one of your stacks to select it
        — a click on your own stack always selects, never moves · thick cream
        outline = selected, and the strip under the board names it · lit arrows =
        one run away, click one to draft a straight leg (one turn at the end is
        free) and click again from the new tip · the brightest chords = the route
        drafted so far, click a walked arrow to go back · dashed = reachable, but
        needs more than one run · a dashed gold outline on your own stack = a merge,
        drafted with the strip&apos;s Merge into button · route first, count second:
        the strip says how many heads walk the last leg, the rest staying where that
        leg began as a sentry (an attack always leaves one behind, so that click is
        armed for you) · nothing moves until Send · every refused click says why in
        the strip · refused
        (not-allowed) grain = would convert with no trail home · bold
        tile edge = occupied · trail chords stay visible under enemy stacks
        (overlap is legal until a cut) · solid fill = territory, thin fill = open
        trail · turn passes when nothing can step · pan stays live while an LLM
        seat thinks
      </p>
      <p className="fx-legend">
        <b>What the board is telling you.</b> A pulse round a loop = you closed it ·
        a fill spreading out from the closure = that ground is now yours · a dashed
        rim = ground you <em>just</em> took · colour retracting = ground someone
        lost · a line snapping apart = a trail was cut · one local clash with −
        numbers = combat · a run out plus a rim that stays = a split · a run in = a
        merge · a ring rising with + = heads produced · dashed chords = open trail,
        which can be cut; solid fill = territory, which cannot.
      </p>
      <p className="help">
        Ringed dots are spawners — three arcs with a dark rim, one per bordering arrow.
        <strong> Hover for force, shares and holders.</strong> A share only pays as
        territory. Shine on a tile means that share births a head on the next full
        round (half-shine = the round after). The centre runs four times faster than
        the rim and is packed far denser.
      </p>
      {vsBot ? (
        <p className="help">
          Non-human seats auto-play. Pause holds them until Resume. An all-bot match
          also pauses when this tab is in the background. BYOK seats use your keys in
          this tab; illegal LLM replies fall back to the heuristic. Download the match
          log when done.
        </p>
      ) : null}
    </aside>
  );
};
