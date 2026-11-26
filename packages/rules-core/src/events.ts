/**
 * Resolved gameplay events — a *reading* of one `apply`, for the presentation layer.
 *
 * The rules engine stays the only thing that decides anything. This module diffs the
 * state it produced (`before` → `after`, plus the `Move` that caused it) and names
 * what changed, so a renderer can say `showEvent(trailCut)` instead of trying to
 * infer a cut from arbitrary state differences at paint time.
 *
 * Two lines that are easy to cross and must not be:
 *
 *   - **Nothing here re-decides a rule.** There is no closure test, no even-odd
 *     fill, no chord test, no combat table. Every field is read out of the diff.
 *     The step's `exit` is used *only* to anchor an effect in space — never to
 *     decide whether something happened.
 *   - **Nothing here is authoritative.** If an event is dropped, mis-ordered, or
 *     never rendered, the board is still correct, because the board renders
 *     `after` and the events only decorate it.
 *
 * Pure and deterministic: no clock, no randomness, and every arrow set leaves here
 * sorted by id, because a `Set` iteration order feeding a staggered animation is
 * exactly the kind of ordering bug ADR 0001 warns about.
 */

import type {
  AppliedStep,
  ArrowId,
  GameEvent,
  GameState,
  GeometryPort,
  LogEvent,
  Move,
  PlayerId,
} from '@conquarrow/contracts';

const byId = (left: ArrowId, right: ArrowId): number => {
  const a = String(left);
  const b = String(right);
  return a < b ? -1 : a > b ? 1 : 0;
};

const byPlayer = (left: PlayerId, right: PlayerId): number => {
  const a = String(left);
  const b = String(right);
  return a < b ? -1 : a > b ? 1 : 0;
};

const sortedArrows = (arrows: Iterable<ArrowId>): readonly ArrowId[] =>
  [...arrows].toSorted(byId);

/** Players named by either state, in id order. */
const allPlayers = (before: GameState, after: GameState): readonly PlayerId[] => {
  const set = new Set<PlayerId>(before.players);
  for (const p of after.players) set.add(p);
  for (const p of before.trails.keys()) set.add(p);
  for (const p of after.trails.keys()) set.add(p);
  for (const owner of before.territory.values()) set.add(owner);
  for (const owner of after.territory.values()) set.add(owner);
  return [...set].toSorted(byPlayer);
};

/** Arrows this player holds as territory in `after` but did not in `before`. */
const territoryGained = (
  before: GameState,
  after: GameState,
  player: PlayerId,
): readonly ArrowId[] => {
  const gained: ArrowId[] = [];
  for (const [arrow, owner] of after.territory) {
    if (owner === player && before.territory.get(arrow) !== player) gained.push(arrow);
  }
  return sortedArrows(gained);
};

/** Arrows this player held and no longer does, with whoever holds them now. */
const territoryLost = (
  before: GameState,
  after: GameState,
  player: PlayerId,
): { readonly arrows: readonly ArrowId[]; readonly to: PlayerId | undefined } => {
  const lost: ArrowId[] = [];
  const takers = new Set<PlayerId>();
  for (const [arrow, owner] of before.territory) {
    if (owner !== player) continue;
    const now = after.territory.get(arrow);
    if (now === player) continue;
    lost.push(arrow);
    if (now !== undefined) takers.add(now);
  }
  const sole = takers.size === 1 ? [...takers][0] : undefined;
  return { arrows: sortedArrows(lost), to: sole };
};

const trailDropped = (
  before: GameState,
  after: GameState,
  player: PlayerId,
): readonly ArrowId[] => {
  const held = before.trails.get(player);
  if (held === undefined) return [];
  const now = after.trails.get(player);
  const dropped: ArrowId[] = [];
  for (const arrow of held) if (now?.has(arrow) !== true) dropped.push(arrow);
  return sortedArrows(dropped);
};

const trailAdded = (
  before: GameState,
  after: GameState,
  player: PlayerId,
): readonly ArrowId[] => {
  const now = after.trails.get(player);
  if (now === undefined) return [];
  const held = before.trails.get(player);
  const added: ArrowId[] = [];
  for (const arrow of now) if (held?.has(arrow) !== true) added.push(arrow);
  return sortedArrows(added);
};

/**
 * A group this player owns, a trail arrow in their set, or a territory arrow
 * they own. Diff-only — not a call into the §9 loss table.
 */
const hadPieces = (game: GameState, player: PlayerId): boolean => {
  for (const group of game.groups.values()) if (group.owner === player) return true;
  if ((game.trails.get(player)?.size ?? 0) > 0) return true;
  for (const owner of game.territory.values()) if (owner === player) return true;
  return false;
};

const vanishedPlayers = (before: GameState, after: GameState): readonly PlayerId[] =>
  before.players.filter((player) => hadPieces(before, player) && !hadPieces(after, player));

/** Same ceiling as `MAX_FX_CELLS` in present.ts — remnant is an event payload. */
const REMNANT_CAP = 120;

/**
 * Dropped trail ∪ vacated (unowned) territory ∪ disappeared groups, minus any
 * arrow `after` still holds as territory or as a group. Sorted by id, capped.
 */
const remnantArrows = (
  before: GameState,
  after: GameState,
  player: PlayerId,
): readonly ArrowId[] => {
  const seen = new Set<string>();
  const out: ArrowId[] = [];
  const consider = (arrow: ArrowId): void => {
    if (seen.has(String(arrow))) return;
    if (after.territory.has(arrow)) return;
    if (after.groups.has(arrow)) return;
    seen.add(String(arrow));
    out.push(arrow);
  };
  for (const arrow of before.trails.get(player) ?? []) {
    if (after.trails.get(player)?.has(arrow) !== true) consider(arrow);
  }
  for (const [arrow, owner] of before.territory) {
    if (owner === player && after.territory.get(arrow) === undefined) consider(arrow);
  }
  for (const [arrow, group] of before.groups) {
    if (group.owner === player && after.groups.get(arrow) === undefined) consider(arrow);
  }
  return out.toSorted(byId).slice(0, REMNANT_CAP);
};

const seatVanishEvents = (before: GameState, after: GameState): readonly GameEvent[] => {
  const out: GameEvent[] = [];
  for (const player of vanishedPlayers(before, after)) {
    out.push({ kind: 'seatVanished', player, arrows: remnantArrows(before, after, player) });
  }
  return out;
};

/** The arrow an effect should radiate from: where the move landed. */
const anchorOf = (move: Move): ArrowId | undefined =>
  move.kind === 'step' ? move.exit : undefined;

// ── what the move itself did to the stacks it named ───────────────────────────

/** Split / sentry / merge / combat / plain advance, all read off `from` and `exit`. */
const stackEvents = (step: AppliedStep): readonly GameEvent[] => {
  const { before, after, move } = step;
  if (move.kind !== 'step') return [];
  const source = before.groups.get(move.from);
  if (source === undefined) return [];
  const player = source.owner;
  const out: GameEvent[] = [];

  const stayed = source.heads - move.count;
  if (stayed > 0) {
    out.push({
      kind: 'stackSplit',
      player,
      from: move.from,
      to: move.exit,
      moved: move.count,
      stayed,
    });
    out.push({ kind: 'sentryLeft', player, arrow: move.from, heads: stayed });
  }

  const target = before.groups.get(move.exit);
  const landed = after.groups.get(move.exit);
  if (target === undefined) {
    out.push({ kind: 'moved', player, from: move.from, to: move.exit, heads: move.count });
  } else if (target.owner === player) {
    out.push({
      kind: 'stackMerged',
      player,
      from: move.from,
      to: move.exit,
      arriving: move.count,
      existing: target.heads,
      total: landed?.heads ?? move.count + target.heads,
    });
  } else {
    const attackerLeft = landed?.owner === player ? landed.heads : 0;
    const defenderLeft = landed?.owner === target.owner ? landed.heads : 0;
    out.push({
      kind: 'combat',
      arrow: move.exit,
      attacker: player,
      defender: target.owner,
      attackerSent: move.count,
      defenderBefore: target.heads,
      attackerLost: move.count - attackerLeft,
      defenderLost: target.heads - defenderLeft,
      holder: landed?.owner,
    });
  }
  return out;
};

// ── what the move did to ground and trails ───────────────────────────────────

const captureEventsFor = (
  player: PlayerId,
  gained: readonly ArrowId[],
  dropped: readonly ArrowId[],
  before: GameState,
  anchor: ArrowId | undefined,
): readonly GameEvent[] => {
  if (gained.length === 0) return [];
  const claimedSet = new Set(gained.map(String));
  const boundary = dropped.filter((arrow) => claimedSet.has(String(arrow)));
  const takers = new Set<PlayerId>();
  for (const arrow of gained) {
    const prev = before.territory.get(arrow);
    if (prev !== undefined) takers.add(prev);
  }
  return [
    {
      kind: 'enclosureClosed',
      player,
      closingArrow: anchor,
      boundary,
      claimed: gained,
    },
    {
      kind: 'territoryCaptured',
      player,
      arrows: gained,
      fromArrow: anchor,
      takenFrom: [...takers].toSorted(byPlayer),
    },
  ];
};

const lossEventsFor = (
  player: PlayerId,
  lost: { readonly arrows: readonly ArrowId[]; readonly to: PlayerId | undefined },
  vanished: boolean,
  after: GameState,
  anchor: ArrowId | undefined,
): readonly GameEvent[] => {
  const arrows = vanished
    ? lost.arrows.filter((arrow) => after.territory.has(arrow))
    : lost.arrows;
  if (arrows.length === 0) return [];
  return [
    {
      kind: 'territoryLost',
      player,
      to: lost.to,
      arrows,
      atArrow: anchor,
    },
  ];
};

/**
 * Closure, capture, loss and cuts.
 *
 * The one judgement in this module: a trail arrow the mover lost *while gaining it
 * as territory* is the loop being promoted to ground, not a cut. Every other trail
 * arrow a *living* player dropped is destruction, and the mover is the one who
 * caused it — which is true whether the victim is an opponent or the mover themself.
 *
 * A seat that left this step is not a cut victim, and leftover land that became
 * unowned is a remnant, not a retraction to nobody.
 */
const groundEvents = (step: AppliedStep, mover: PlayerId): readonly GameEvent[] => {
  const { before, after, move } = step;
  const anchor = anchorOf(move);
  const vanished = new Set(vanishedPlayers(before, after));
  const cuts: GameEvent[] = [];
  const captures: GameEvent[] = [];
  const losses: GameEvent[] = [];

  for (const player of allPlayers(before, after)) {
    const gained = territoryGained(before, after, player);
    const dropped = trailDropped(before, after, player);
    const claimedSet = new Set(gained.map(String));
    const severed = dropped.filter((arrow) => !claimedSet.has(String(arrow)));
    const left = vanished.has(player);

    captures.push(...captureEventsFor(player, gained, dropped, before, anchor));

    if (severed.length > 0 && !left) {
      cuts.push({
        kind: 'trailCut',
        victim: player,
        attacker: mover,
        cutArrow: anchor,
        arrows: severed,
      });
    }

    losses.push(...lossEventsFor(player, territoryLost(before, after, player), left, after, anchor));
  }

  // Causal order: the impact, then what it destroyed, then what it claimed.
  return [...cuts, ...captures, ...losses];
};

// ── what changed without any move naming it ──────────────────────────────────

/**
 * Conversions (§6.3) and spawner births (§7): the group changes on arrows the move
 * did not name. Both are "this happened *because of* what you just did", and both
 * are invisible without a cue, since neither has a source arrow to move from.
 */
const offMoveEvents = (step: AppliedStep): readonly GameEvent[] => {
  const { before, after, move } = step;
  const named = new Set<string>();
  if (move.kind === 'step') {
    named.add(String(move.from));
    named.add(String(move.exit));
  }
  const arrows = new Set<ArrowId>([...before.groups.keys(), ...after.groups.keys()]);
  const conversions: GameEvent[] = [];
  const births: GameEvent[] = [];

  for (const arrow of sortedArrows(arrows)) {
    if (named.has(String(arrow))) continue;
    const was = before.groups.get(arrow);
    const now = after.groups.get(arrow);
    if (now === undefined) continue;
    if (was === undefined) {
      births.push({ kind: 'unitsProduced', player: now.owner, arrow, amount: now.heads });
      continue;
    }
    if (was.owner !== now.owner) {
      conversions.push({
        kind: 'unitsConverted',
        arrow,
        from: was.owner,
        to: now.owner,
        heads: now.heads,
      });
      continue;
    }
    if (now.heads > was.heads) {
      births.push({
        kind: 'unitsProduced',
        player: now.owner,
        arrow,
        amount: now.heads - was.heads,
      });
    }
  }
  return [...conversions, ...births];
};

/**
 * Name everything one applied move changed, in causal order.
 *
 * The order is the deliverable as much as the contents: a consumer that renders
 * this list front-to-back with increasing delays shows the player *the cause
 * before the consequence*, which is the whole ask.
 */
export const resolveEvents = (step: AppliedStep): readonly GameEvent[] => {
  const { before, after } = step;
  const mover = before.activePlayer;
  const out: GameEvent[] = [];

  out.push(...stackEvents(step));

  const laid = trailAdded(before, after, mover);
  if (laid.length > 0) out.push({ kind: 'trailLaid', player: mover, arrows: laid });

  out.push(...groundEvents(step, mover));
  out.push(...offMoveEvents(step));
  out.push(...seatVanishEvents(before, after));

  if (after.activePlayer !== before.activePlayer) {
    out.push({ kind: 'turnPassed', from: before.activePlayer, to: after.activePlayer });
  }
  if (after.winner !== undefined && before.winner === undefined) {
    out.push({ kind: 'matchWon', player: after.winner });
  }
  return out;
};

/**
 * Resolve a whole batch — a multi-step trip, or a bot's turn applied at once.
 *
 * Per step rather than end-to-end on purpose. A three-step trip that splits on
 * step one and closes on step three has two distinguishable causes, and a single
 * before/after diff would collapse them into one indistinguishable blob.
 */
export const resolveBatch = (steps: readonly AppliedStep[]): readonly GameEvent[] => {
  const out: GameEvent[] = [];
  for (const step of steps) out.push(...resolveEvents(step));
  return out;
};

// ── P107: the match log's compact record ─────────────────────────────────────

/** P107 D2 (skeleton). */
export const toLogEvent = (_event: GameEvent): LogEvent | undefined => {
  throw new Error('not implemented');
};

/** P107 D1 (skeleton). */
export const resolveShareEvents = (_geometry: GeometryPort, _step: AppliedStep): readonly LogEvent[] => {
  throw new Error('not implemented');
};

/** P107 D2 (skeleton). */
export const logEventsOf = (_geometry: GeometryPort, _step: AppliedStep): readonly LogEvent[] => {
  throw new Error('not implemented');
};
