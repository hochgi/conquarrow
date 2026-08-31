/**
 * BYOK target locks — playtest adapter (P21 follow-on).
 *
 * Locks stacks to findings from the deterministic planner so the LLM is not
 * re-planning from scratch every ply. Pure helpers + a session map (cleared
 * on new match). Not rules-core.
 */

import type {
  ArrowId,
  GameState,
  GeometryPort,
  Move,
  PlayerId,
  RulesPort,
  StepMove,
} from '@conquarrow/contracts';
import { distanceToTerritory } from './botEvaluate';
import {
  collectFindings,
  grainDistance,
  type Finding,
  type FindingsCaps,
  DEFAULT_FINDINGS_CAPS,
} from './findings';
import { playLayout } from './playLayout';

/** seat -> (stack arrow -> finding) */
const locksBySeat = new Map<string, Map<string, Finding>>();

export const clearTargetLocks = (): void => {
  locksBySeat.clear();
};

const steppableFroms = (rules: RulesPort, state: GameState, me: PlayerId): ArrowId[] => {
  const seen = new Set<string>();
  const out: ArrowId[] = [];
  for (const m of rules.legalMoves(state)) {
    if (m.kind !== 'step') continue;
    if (state.groups.get(m.from)?.owner !== me) continue;
    const key = String(m.from);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m.from);
  }
  return out.toSorted((a, b) => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0));
};

const lockStillValid = (
  geometry: GeometryPort,
  rules: RulesPort,
  state: GameState,
  me: PlayerId,
  finding: Finding,
  caps: FindingsCaps,
): boolean => {
  const group = state.groups.get(finding.from);
  if (group === undefined || group.owner !== me) return false;
  if (finding.kind === 'close_path') {
    if (state.territory.get(finding.goal) !== me) return false;
    const d0 = distanceToTerritory(geometry, state, me, finding.from, caps.distCap);
    return rules.legalMoves(state).some((m) => {
      if (m.kind !== 'step' || m.from !== finding.from) return false;
      return distanceToTerritory(geometry, state, me, m.exit, caps.distCap) < d0;
    });
  }
  if (finding.kind === 'claim_share' || finding.kind === 'approach_spawner') {
    if (state.territory.get(finding.goal) !== undefined) return false;
    const d = grainDistance(geometry, finding.from, finding.goal, caps.distCap);
    if (d > caps.distCap) return false;
  }
  // Need at least one legal step from this tip.
  return rules.legalMoves(state).some((m) => m.kind === 'step' && m.from === finding.from);
};

/**
 * Drop stale locks; assign findings to unlocked steppable stacks.
 * Returns the active lock list for the prompt.
 */
export const syncTargetLocks = (
  geometry: GeometryPort,
  rules: RulesPort,
  state: GameState,
  me: PlayerId,
  caps: FindingsCaps = DEFAULT_FINDINGS_CAPS,
): readonly Finding[] => {
  const seat = String(me);
  const prev = locksBySeat.get(seat) ?? new Map<string, Finding>();
  const next = new Map<string, Finding>();

  for (const [key, finding] of [...prev.entries()].toSorted((a, b) =>
    a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0,
  )) {
    if (lockStillValid(geometry, rules, state, me, finding, caps)) {
      next.set(key, finding);
    }
  }

  const unlocked = steppableFroms(rules, state, me).filter((from) => !next.has(String(from)));
  if (unlocked.length > 0) {
    const findings = collectFindings(geometry, rules, state, me, caps, playLayout);
    for (const from of unlocked) {
      const hit = findings.find((f) => f.from === from);
      if (hit !== undefined) next.set(String(from), hit);
    }
  }

  locksBySeat.set(seat, next);
  return [...next.values()].toSorted((a, b) =>
    String(a.from) < String(b.from) ? -1 : String(a.from) > String(b.from) ? 1 : 0,
  );
};

/** After a step, re-key the lock to the new tip or drop it if the goal landed. */
export const advanceTargetLock = (
  me: PlayerId,
  move: Move,
  geometry: GeometryPort,
  caps: FindingsCaps = DEFAULT_FINDINGS_CAPS,
): void => {
  if (move.kind !== 'step') return;
  const seat = String(me);
  const locks = locksBySeat.get(seat);
  if (locks === undefined) return;
  const prev = locks.get(String(move.from));
  if (prev === undefined) return;
  locks.delete(String(move.from));
  if (move.exit === prev.goal) return; // achieved
  const d = grainDistance(geometry, move.exit, prev.goal, caps.distCap);
  if (d > caps.distCap) return;
  locks.set(String(move.exit), {
    ...prev,
    from: move.exit,
    cost: Math.max(1, d),
    move: { ...prev.move, from: move.exit, exit: prev.goal },
  });
};

export const formatTargetsForPrompt = (targets: readonly Finding[]): string => {
  if (targets.length === 0) return 'TARGETS: none (stacks free — prefer leave_home / borders_spawner).';
  const lines = targets.map(
    (t, i) =>
      `[T${String(i)}] kind=${t.kind} from=${String(t.from)} goal=${String(t.goal)} ` +
      `cost=${String(t.cost)} score=${String(t.score)} via count=${String(t.move.count)} exit=${String(t.move.exit)}`,
  );
  return [
    'TARGETS (locked plans from the deterministic planner — prefer on_target moves):',
    ...lines,
  ].join('\n');
};

export const moveMatchesTarget = (move: StepMove, target: Finding): boolean =>
  move.from === target.from &&
  (move.exit === target.move.exit || move.exit === target.goal);

export const tagOnTarget = (
  move: StepMove,
  targets: readonly Finding[],
): boolean => targets.some((t) => moveMatchesTarget(move, t));
