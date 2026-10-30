/**
 * Rails over the input mode (P43).
 *
 * A rail narrows choice; it never changes legality. The decorator filters
 * highlights and attaches coach lines; every refusal the engine produces still
 * surfaces exactly as outside lessons. Two layers, visible in code:
 * `refusal` belongs to the engine, `coach` belongs to the teacher.
 *
 * The inner mode exposes no snapshot getter, so the decorator mirrors every
 * snapshot it delegates — a coached click answers with the board as the learner
 * sees it plus the teacher's line, never a fabricated phase.
 */

import type { ArrowId, Move } from '@conquarrow/contracts';
import type { InputMode, InputSnapshot } from '../input/modes';
import { draftExits } from '../route';
import type { LessonStep } from './types';

export interface RailRestriction {
  /** Arrows the learner may select; omitted = unrestricted. */
  readonly selectable?: ReadonlySet<ArrowId>;
  /** Arrows the learner may click as targets; omitted = unrestricted. */
  readonly clickable?: ReadonlySet<ArrowId>;
  /** Carry values permitted on `setCarry`; omitted = whatever the offer lists. */
  readonly carryAllow?: readonly number[];
  /** The coach line for an off-rail interaction at `arrow` (carry rails pass no arrow). */
  readonly coach: (arrow?: ArrowId) => string;
}

export interface TutoredSnapshot extends InputSnapshot {
  /** The teacher's line. Never a substitute for `refusal`. */
  readonly coach?: string;
}

const withCoach = (snap: InputSnapshot, coach: string | undefined): TutoredSnapshot => {
  if (coach === undefined) return snap;
  return { ...snap, coach };
};

/** Same predicate as `railAutoSends`, read off the restriction the decorator already holds. */
const restrictionAutoSends = (restriction: RailRestriction): boolean =>
  restriction.clickable !== undefined &&
  restriction.clickable.size === 1 &&
  (restriction.carryAllow === undefined || restriction.carryAllow.length === 1);

const draftMatchesRail = (
  draft: readonly Move[],
  clickable: ReadonlySet<ArrowId> | undefined,
): boolean => {
  if (clickable === undefined) return false;
  const exits = draftExits(draft);
  if (exits.length !== clickable.size) return false;
  for (const exit of exits) {
    if (!clickable.has(exit)) return false;
  }
  return true;
};

const onRail = (arrows: ReadonlySet<ArrowId>, allowed: ReadonlySet<ArrowId>): Set<ArrowId> =>
  new Set([...arrows].filter((arrow) => allowed.has(arrow)));

/** Targets and merge targets alike: the rail narrows what the strip offers too (P77). */
const filterToRail = (snap: InputSnapshot, restriction: RailRestriction): InputSnapshot => {
  const allowed = restriction.clickable;
  if (allowed === undefined) return snap;
  const { targets, merges, ...rest } = snap.highlights;
  const kept = onRail(merges ?? new Set(), allowed);
  const highlights = {
    ...rest,
    targets: onRail(targets, allowed),
    ...(kept.size === 0 ? {} : { merges: kept }),
  };
  return { ...snap, highlights };
};

/** Rail for an expect step; `undefined` on every other kind (free play / no board). */
export const restrictionFor = (step: LessonStep): RailRestriction | undefined => {
  if (step.kind !== 'expect') return undefined;
  return {
    selectable: new Set([step.action.from]),
    clickable: new Set(step.action.exits),
    ...(step.action.carryAllow === undefined ? {} : { carryAllow: step.action.carryAllow }),
    coach: () => step.coach,
  };
};

/** Wrap an input mode with an active rail, or return it unchanged when none. */
export const decorateInputMode = (inner: InputMode, restriction: RailRestriction): InputMode => {
  let last: InputSnapshot = inner.reset();

  const delegate = (produce: () => InputSnapshot): InputSnapshot => {
    last = produce();
    return filterTargets(last);
  };

  const filterTargets = (snap: InputSnapshot): InputSnapshot => filterToRail(snap, restriction);

  const isOwnGroup = (state: Parameters<InputMode['onArrowClick']>[1], arrow: ArrowId): boolean =>
    state.groups.get(arrow)?.owner === state.activePlayer;

  const maybeAutoSend = (snap: InputSnapshot): InputSnapshot => {
    if (snap.pending !== undefined) return snap;
    if (snap.phase.kind !== 'route') return snap;
    if (!restrictionAutoSends(restriction)) return snap;
    if (!draftMatchesRail(snap.phase.draft, restriction.clickable)) return snap;
    // The teacher speaks only when the engine refused the send: a landed rail is
    // not an off-rail interaction, and before P77 retired apply-on-click the
    // inner mode sent it itself, with no coach.
    return delegate(() => {
      const sent = inner.send();
      return sent.refusal === undefined ? sent : withCoach(sent, restriction.coach());
    });
  };

  const afterClick = (produce: () => InputSnapshot): InputSnapshot => maybeAutoSend(delegate(produce));

  const clickWhileIdle = (
    arrow: ArrowId,
    state: Parameters<InputMode['onArrowClick']>[1],
    rules: Parameters<InputMode['onArrowClick']>[2],
  ): InputSnapshot => {
    const selectable = restriction.selectable;
    if (isOwnGroup(state, arrow)) {
      if (selectable !== undefined && !selectable.has(arrow)) {
        return withCoach(last, restriction.coach(arrow));
      }
      return afterClick(() => inner.onArrowClick(arrow, state, rules));
    }
    return afterClick(() => withCoach(inner.onArrowClick(arrow, state, rules), restriction.coach(arrow)));
  };

  return {
    get id() {
      return inner.id;
    },
    get label() {
      return inner.label;
    },
    reset: (): InputSnapshot => delegate(() => inner.reset()),

    onBackgroundClick: (): InputSnapshot => delegate(() => inner.onBackgroundClick()),

    onArrowClick(arrow, state, rules): InputSnapshot {
      const { phase } = last;
      // Route phase: pops and re-selecting the source stay; everything else must be on-rail.
      if (phase.kind === 'route') {
        const draftedOrSource =
          arrow === phase.from ||
          phase.draft.some((move) => move.kind === 'step' && move.exit === arrow);
        if (draftedOrSource) return afterClick(() => inner.onArrowClick(arrow, state, rules));

        const engineOffersIt = phase.offer.clickable.has(arrow);
        const onRail = restriction.clickable?.has(arrow) ?? true;
        if (!engineOffersIt && !isOwnGroup(state, arrow)) {
          // The engine would refuse anyway: engine speaks, teacher beneath.
          return afterClick(() =>
            withCoach(inner.onArrowClick(arrow, state, rules), restriction.coach(arrow)),
          );
        }
        if (engineOffersIt && !onRail) {
          // Legal and reachable, but not what this step teaches: coach only.
          return withCoach(last, restriction.coach(arrow));
        }
        // An on-rail exit may already hold an own head (L2: the stay-behind on
        // home). That is a landing, not a stack switch — so it is drafted as the
        // merge it is (P77: a tile click on an own stack would select it), and
        // the rail's auto-send commits it.
        if (onRail) {
          return afterClick(() =>
            isOwnGroup(state, arrow) ? inner.mergeInto(arrow) : inner.onArrowClick(arrow, state, rules),
          );
        }
        if (isOwnGroup(state, arrow)) {
          const selectable = restriction.selectable;
          if (selectable !== undefined && !selectable.has(arrow)) {
            return withCoach(last, restriction.coach(arrow));
          }
        }
        return afterClick(() => inner.onArrowClick(arrow, state, rules));
      }
      return clickWhileIdle(arrow, state, rules);
    },

    setCarry(count: number): InputSnapshot {
      const allowed = restriction.carryAllow;
      if (allowed !== undefined && !allowed.includes(count)) {
        return withCoach(last, restriction.coach());
      }
      return delegate(() => inner.setCarry(count));
    },

    // An explicit select (Next stack) obeys the same selectable guard as a click.
    select(arrow, state, rules): InputSnapshot {
      const selectable = restriction.selectable;
      if (selectable !== undefined && !selectable.has(arrow)) {
        return withCoach(last, restriction.coach(arrow));
      }
      return afterClick(() => inner.select(arrow, state, rules));
    },

    mergeInto(arrow): InputSnapshot {
      if (restriction.clickable !== undefined && !restriction.clickable.has(arrow)) {
        return withCoach(last, restriction.coach(arrow));
      }
      return afterClick(() => inner.mergeInto(arrow));
    },

    send: (): InputSnapshot => delegate(() => inner.send()),
    cancel: (): InputSnapshot => delegate(() => inner.cancel()),

    requestEndTurn(): InputSnapshot {
      return delegate(() => inner.requestEndTurn());
    },
  };
};
