import type { ArrowId } from '@conquarrow/contracts';
import type { ReactElement } from 'react';
import { leftoverNote, type CountControl } from './route';

/**
 * The docked count control for a drafted route (P35).
 *
 * It replaces P34's tip-anchored panel, and the whole change is *where it lives*:
 * a strip **under** the board — its own row of the app's grid, a sibling of the
 * board's container rather than a child of it, so it takes its own space instead
 * of covering the board's. The old panel hid 4 of the 12 clickable arrows at a
 * wide width, and on a 375 px screen anything anchored on the tip covers part of
 * the very offer it is asking about. Moving the rectangle would move that
 * problem; going under the board retires it.
 *
 * Hence the props carry **no coordinates** — there is nothing here to be
 * positioned from, and that is an invariant rather than a convenience. The
 * spatial link is carried by the tip's halo (P31), not by the control touching
 * the arrow.
 *
 * It asks the one question a named run has: how many heads walk it, the rest
 * staying where the run began as a sentry (§5). Changing the count repaints the
 * rays live, which is how a player learns that distance is bought with heads
 * (§3); no numeral says how far, because the ray's painted length is the display
 * and nothing should be able to disagree with it.
 *
 * **The strip is always mounted; only its content comes and goes.** `control` is
 * `undefined` whenever there is nothing to ask — an empty draft, a locked seat, a
 * finished match — and then the controls row holds no count and no Send, but
 * keeps its height. That matters more than it sounds: if the
 * row appeared with the first click of every route, the board would shrink by the
 * strip's height at the exact moment the player is aiming at it, and every arrow
 * would slide under their finger mid-gesture. The row is reserved by the strip's
 * own fixed grid rows, so the reserved height and the live height are the same
 * height by construction rather than by a hard-coded guess.
 *
 * **P77 gives the strip three fixed one-line rows**: the selection line (which
 * stack is selected, and where it sits in the Next stack lap), the controls (the
 * count, one Merge button per merge target, Cancel and Send), and the message
 * line (why the last click was refused, or whether the turn passes by itself).
 * Every row is always laid out, so no text can change the board's size.
 */
export interface RouteDockProps {
  /** The question, or `undefined` when there is none to ask. */
  readonly control?: CountControl | undefined;
  /** Row 1: `selectionLine` — names the selected stack, or says none is. */
  readonly selection: string;
  /** Row 3: the last refusal's sentence, or `turnStatus`. */
  readonly message: string;
  /** Merge targets in `compareArrows` order — one button each. */
  readonly merges: readonly ArrowId[];
  readonly onCount: (count: number) => void;
  readonly onMerge: (arrow: ArrowId) => void;
  readonly onSend: () => void;
  readonly onCancel: () => void;
}

/**
 * The next offerable count below / above the current one, if there is one.
 *
 * The stepper walks the *offered* list rather than `count ± 1`: the counts that
 * walk a run are not contiguous from 1 — a three step run floors at four — so
 * arithmetic on the number would step onto a count the engine refuses.
 */
const neighbour = (
  counts: readonly number[],
  count: number,
  direction: -1 | 1,
): number | undefined => {
  const under = counts.filter((c) => c < count);
  const over = counts.filter((c) => c > count);
  return direction === -1 ? under[under.length - 1] : over[0];
};

/** The count stepper for the last leg, captioned, with where the rest stand (§5). */
const CountStepper = ({
  control,
  onCount,
}: {
  readonly control: CountControl;
  readonly onCount: (count: number) => void;
}): ReactElement => {
  const { count, ceiling, counts, start } = control;
  const fewer = neighbour(counts, count, -1);
  const more = neighbour(counts, count, 1);
  return (
    <>
      <span className="route-dock-caption">Heads on the last leg</span>
      <div className="route-dock-count">
        <button
          type="button"
          aria-label="Send one fewer head on this run"
          disabled={fewer === undefined}
          onClick={() => {
            if (fewer !== undefined) onCount(fewer);
          }}
        >
          −
        </button>
        <span className="route-dock-heads">
          {count}
          <small>/{ceiling}</small>
        </span>
        <button
          type="button"
          aria-label="Send one more head on this run"
          disabled={more === undefined}
          onClick={() => {
            if (more !== undefined) onCount(more);
          }}
        >
          +
        </button>
      </div>
      <span className="route-dock-note">{leftoverNote({ count, ceiling, start })}</span>
    </>
  );
};

export const RouteDock = ({
  control,
  selection,
  message,
  merges,
  onCount,
  onMerge,
  onSend,
  onCancel,
}: RouteDockProps): ReactElement => (
  <div className="route-dock">
    <p className="route-dock-line">{selection}</p>
    <div className="route-dock-controls">
      {control === undefined ? null : <CountStepper control={control} onCount={onCount} />}
      {control === undefined ? null : (
        <div className="route-dock-actions">
          <button type="button" className="secondary" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            disabled={control.draftLength === 0}
            onClick={onSend}
          >
            Send
          </button>
        </div>
      )}
      {/* After Cancel / Send, so a long merge list scrolls rather than pushing Send
          out of the row. */}
      {merges.length === 0 ? null : (
        <div className="route-dock-merges">
        {merges.map((arrow) => (
          <button
            key={String(arrow)}
            type="button"
            className="route-dock-merge"
            onClick={() => {
              onMerge(arrow);
            }}
          >
            {`Merge into ${String(arrow)}`}
          </button>
        ))}
        </div>
      )}
    </div>
    <p className="route-dock-message" role="status">
      {message}
    </p>
  </div>
);
