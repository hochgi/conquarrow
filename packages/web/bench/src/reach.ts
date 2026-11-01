/**
 * P78 — is combat reachable? A reading of each `apply`, never a rule.
 *
 * Counts, per match, where heads went and what closures took. Everything is read
 * off `before → after` plus two port **queries** — `combatLosses` (§6.2) and
 * `closureOf` (§7) — so the core stays untouched and nothing here re-decides a
 * rule. Where the diff cannot be explained, the reading throws instead of
 * guessing: a harness that silently mis-files a head is worse than none.
 *
 * Head losses are kept separable by cause:
 *
 * - **combat** — the §6.2 exchange on the step's destination, as `combatLosses`
 *   prices it. Fight-to-wipe takes one round under the current table; a pair
 *   with both sides still standing throws, so a retuned table cannot drift past
 *   this reading unnoticed.
 * - **encirclement** — heads that changed owner without moving (§6.3). Not killed:
 *   converted. From the loser's side they are gone all the same.
 * - **evaporation** — any other head that vanished from a living seat. §6.1 says
 *   evaporation kills nobody (P12), so this should read zero; it is counted rather
 *   than assumed, so a regression would show.
 * - **vanished** — heads removed with a seat that lost this apply (§9).
 *
 * Pure and deterministic: arrows are visited in id order, no clock, no I/O.
 */

import type { ArrowId, GameState, MatchConfig, Move, PlayerId, RulesPort } from '@conquarrow/contracts';
import { makeMatch } from '@conquarrow/geometry-tiling';
import { emptyMatchSummary, foldMatchSummary, type MatchSummary } from '../../src/matchLog';

export const LOSS_CAUSES = ['combat', 'encirclement', 'evaporation', 'vanished'] as const;
export type LossCause = (typeof LOSS_CAUSES)[number];
export type Losses = Readonly<Record<LossCause, number>>;

/**
 * Land bridge: the claim rings nothing (`enclosed` empty, §7). Area capture: it
 * rings something. Capture with enemy heads: the claimed ground (path or pocket)
 * held at least one enemy head — that one wins over the other two.
 */
export const CLOSURE_KINDS = ['landBridge', 'areaCapture', 'captureWithEnemyHeads'] as const;
export type ClosureKind = (typeof CLOSURE_KINDS)[number];

export interface ClosureReading {
  readonly kind: ClosureKind;
  /** Enemy heads standing on ground this closure claimed, before it closed. */
  readonly enemyHeads: number;
}

export interface StepReading {
  readonly losses: Losses;
  readonly births: number;
  /** Territory grew (the summary's close) — undefined when it did not. */
  readonly closure: ClosureReading | undefined;
  /** The step attacked a stack (§6.2 contact). */
  readonly attack: boolean;
  /**
   * The mover touched another seat: stepped onto an arrow holding an enemy stack,
   * enemy trail or enemy territory, or closed over enemy heads. A measurement
   * definition, not a rule.
   */
  readonly contact: boolean;
}

interface Occupant {
  readonly owner: PlayerId;
  readonly heads: number;
}

const byId = (a: ArrowId, b: ArrowId): number => {
  const x = String(a);
  const y = String(b);
  return x < y ? -1 : x > y ? 1 : 0;
};

const zeroLosses = (): Record<LossCause, number> => ({ combat: 0, encirclement: 0, evaporation: 0, vanished: 0 });

const hadPieces = (state: GameState, player: PlayerId): boolean => {
  for (const group of state.groups.values()) if (group.owner === player) return true;
  if ((state.trails.get(player)?.size ?? 0) > 0) return true;
  for (const owner of state.territory.values()) if (owner === player) return true;
  return false;
};

const vanishedSeats = (before: GameState, after: GameState): ReadonlySet<PlayerId> =>
  new Set(before.players.filter((p) => hadPieces(before, p) && !hadPieces(after, p)));

const anomaly = (what: string, arrow: ArrowId): never => {
  throw new Error(`reach: ${what} on ${String(arrow)} — the reading cannot explain this apply`);
};

/**
 * Who should stand where once the move's own mechanics are done — split, merge,
 * or the §6.2 exchange — and the heads that exchange cost. Everything after that
 * (cuts, closure, conversion, losses) happens off the move's two arrows.
 */
const expectedAfterMove = (
  rules: RulesPort,
  before: GameState,
  move: Move,
): { readonly expected: Map<ArrowId, Occupant>; readonly combat: number; readonly attack: boolean } => {
  const expected = new Map<ArrowId, Occupant>();
  for (const [arrow, group] of before.groups) expected.set(arrow, { owner: group.owner, heads: group.heads });
  if (move.kind !== 'step') return { expected, combat: 0, attack: false };
  const source = before.groups.get(move.from) ?? anomaly('a step from an empty arrow', move.from);
  const remainder = source.heads - move.count;
  if (remainder > 0) expected.set(move.from, { owner: source.owner, heads: remainder });
  else expected.delete(move.from);
  const standing = before.groups.get(move.exit);
  if (standing === undefined || standing.owner === source.owner) {
    expected.set(move.exit, { owner: source.owner, heads: move.count + (standing?.heads ?? 0) });
    return { expected, combat: 0, attack: false };
  }
  const lost = rules.combatLosses(move.count, standing.heads);
  const attackers = move.count - lost.attacker;
  const defenders = standing.heads - lost.defender;
  if (attackers > 0 && defenders > 0) anomaly('a combat round that wiped neither side', move.exit);
  if (defenders > 0) expected.set(move.exit, { owner: standing.owner, heads: defenders });
  else if (attackers > 0) expected.set(move.exit, { owner: source.owner, heads: attackers });
  else expected.delete(move.exit);
  return { expected, combat: lost.attacker + lost.defender, attack: true };
};

/** Compare what the move left with what `apply` produced, arrow by arrow. */
const offMoveChanges = (
  expected: ReadonlyMap<ArrowId, Occupant>,
  after: GameState,
  gone: ReadonlySet<PlayerId>,
  isEndTurn: boolean,
): { readonly losses: Record<LossCause, number>; readonly births: number } => {
  const losses = zeroLosses();
  let births = 0;
  const arrows = [...new Set<ArrowId>([...expected.keys(), ...after.groups.keys()])].toSorted(byId);
  for (const arrow of arrows) {
    const was = expected.get(arrow);
    const now = after.groups.get(arrow);
    if (was === undefined) {
      if (now === undefined) continue;
      if (!isEndTurn) anomaly('heads appearing mid-turn', arrow);
      births += now.heads;
    } else if (now === undefined) {
      losses[gone.has(was.owner) ? 'vanished' : 'evaporation'] += was.heads;
    } else if (now.owner !== was.owner) {
      if (now.heads > was.heads) anomaly('a conversion that gained heads', arrow);
      losses.encirclement += now.heads;
      losses.evaporation += was.heads - now.heads;
    } else if (now.heads > was.heads) {
      if (!isEndTurn) anomaly('heads appearing mid-turn', arrow);
      births += now.heads - was.heads;
    } else {
      losses.evaporation += was.heads - now.heads;
    }
  }
  return { losses, births };
};

const territoryGrew = (before: GameState, after: GameState): boolean => {
  const count = (s: GameState): Map<PlayerId, number> => {
    const m = new Map<PlayerId, number>();
    for (const owner of s.territory.values()) m.set(owner, (m.get(owner) ?? 0) + 1);
    return m;
  };
  const b = count(before);
  for (const [owner, n] of count(after)) if (n > (b.get(owner) ?? 0)) return true;
  return false;
};

const readClosure = (rules: RulesPort, before: GameState, move: Move, after: GameState): ClosureReading => {
  const mover = before.activePlayer;
  const claim = move.kind === 'step' ? rules.closureOf(before, move, mover) : undefined;
  if (claim === undefined) {
    throw new Error('reach: territory grew without a closure claim — the reading cannot explain this apply');
  }
  let enemyHeads = 0;
  for (const [arrow, owner] of after.territory) {
    if (owner !== mover || before.territory.get(arrow) === mover) continue;
    const group = before.groups.get(arrow);
    if (group !== undefined && group.owner !== mover) enemyHeads += group.heads;
  }
  const kind: ClosureKind =
    enemyHeads > 0 ? 'captureWithEnemyHeads' : claim.enclosed.length === 0 ? 'landBridge' : 'areaCapture';
  return { kind, enemyHeads };
};

const touchesEnemy = (before: GameState, move: Move): boolean => {
  if (move.kind !== 'step') return false;
  const mover = before.activePlayer;
  const enemy = (p: PlayerId | undefined): boolean => p !== undefined && p !== mover;
  if (enemy(before.groups.get(move.exit)?.owner) || enemy(before.territory.get(move.exit))) return true;
  for (const [player, trail] of before.trails) if (player !== mover && trail.has(move.exit)) return true;
  return false;
};

/** Read one applied move. `after` must be `rules.apply(before, move)`. */
export const readStep = (rules: RulesPort, before: GameState, move: Move, after: GameState): StepReading => {
  const { expected, combat, attack } = expectedAfterMove(rules, before, move);
  const { losses, births } = offMoveChanges(expected, after, vanishedSeats(before, after), move.kind === 'endTurn');
  losses.combat += combat;
  const closure = territoryGrew(before, after) ? readClosure(rules, before, move, after) : undefined;
  return {
    losses,
    births,
    closure,
    attack,
    contact: touchesEnemy(before, move) || (closure?.enemyHeads ?? 0) > 0,
  };
};

// ── one match ────────────────────────────────────────────────────────────────

export interface Moment {
  /** Index into the match's moves. */
  readonly move: number;
  /** Seat-turns completed before it (end-turns so far). */
  readonly turn: number;
}

export interface ReachReport {
  readonly summary: MatchSummary;
  readonly losses: Losses;
  readonly births: number;
  /** Steps that attacked a stack. */
  readonly attacks: number;
  readonly closures: Readonly<Record<ClosureKind, number>>;
  /** Closures whose claimed ground held at least one enemy head — once per closure. */
  readonly closuresWithEnemyHeads: number;
  /** Enemy heads on claimed ground, summed over closures. */
  readonly enemyHeadsClaimed: number;
  /** Encirclement losses in steps that closed nothing (a trail lost its territory grade). */
  readonly encirclementWithoutClosure: number;
  readonly firstContact: Moment | null;
  readonly firstDeath: (Moment & { readonly cause: LossCause }) | null;
  /** `firstDeath.turn − firstContact.turn`; null unless both happened. */
  readonly contactToDeathTurns: number | null;
}

interface Running {
  summary: MatchSummary;
  losses: Record<LossCause, number>;
  births: number;
  attacks: number;
  closures: Record<ClosureKind, number>;
  closuresWithEnemyHeads: number;
  enemyHeadsClaimed: number;
  encirclementWithoutClosure: number;
  firstContact: Moment | null;
  firstDeath: (Moment & { cause: LossCause }) | null;
  endTurns: number;
  moves: number;
}

export const emptyReach = (): Running => ({
  summary: emptyMatchSummary(),
  losses: zeroLosses(),
  births: 0,
  attacks: 0,
  closures: { landBridge: 0, areaCapture: 0, captureWithEnemyHeads: 0 },
  closuresWithEnemyHeads: 0,
  enemyHeadsClaimed: 0,
  encirclementWithoutClosure: 0,
  firstContact: null,
  firstDeath: null,
  endTurns: 0,
  moves: 0,
});

export type ReachTally = ReturnType<typeof emptyReach>;

/** Fold one applied move into the running tally (mutates `tally`). */
export const foldReach = (
  rules: RulesPort,
  tally: ReachTally,
  before: GameState,
  move: Move,
  after: GameState,
): void => {
  const reading = readStep(rules, before, move, after);
  const at: Moment = { move: tally.moves, turn: tally.endTurns };
  tally.summary = foldMatchSummary(tally.summary, [move], before, after, tally.moves);
  for (const cause of LOSS_CAUSES) tally.losses[cause] += reading.losses[cause];
  tally.births += reading.births;
  if (reading.attack) tally.attacks += 1;
  if (reading.closure !== undefined) {
    tally.closures[reading.closure.kind] += 1;
    if (reading.closure.enemyHeads > 0) tally.closuresWithEnemyHeads += 1;
    tally.enemyHeadsClaimed += reading.closure.enemyHeads;
  } else {
    tally.encirclementWithoutClosure += reading.losses.encirclement;
  }
  if (reading.contact && tally.firstContact === null) tally.firstContact = at;
  const cause = LOSS_CAUSES.find((c) => reading.losses[c] > 0);
  if (cause !== undefined && tally.firstDeath === null) tally.firstDeath = { ...at, cause };
  tally.moves += 1;
  if (move.kind === 'endTurn') tally.endTurns += 1;
};

export const reachReport = (tally: ReachTally): ReachReport => ({
  summary: tally.summary,
  losses: { ...tally.losses },
  births: tally.births,
  attacks: tally.attacks,
  closures: { ...tally.closures },
  closuresWithEnemyHeads: tally.closuresWithEnemyHeads,
  enemyHeadsClaimed: tally.enemyHeadsClaimed,
  encirclementWithoutClosure: tally.encirclementWithoutClosure,
  firstContact: tally.firstContact,
  firstDeath: tally.firstDeath,
  contactToDeathTurns:
    tally.firstContact === null || tally.firstDeath === null
      ? null
      : tally.firstDeath.turn - tally.firstContact.turn,
});

/** Replay `moves` from `makeMatch(config)` and score every apply. */
export const scoreMatch = (rules: RulesPort, config: MatchConfig, moves: readonly Move[]): ReachReport => {
  let state = makeMatch(config);
  const tally = emptyReach();
  for (const move of moves) {
    const after = rules.apply(state, move);
    foldReach(rules, tally, state, move, after);
    state = after;
  }
  return reachReport(tally);
};
