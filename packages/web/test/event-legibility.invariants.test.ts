/**
 * Properties the event layer must hold, checked against the real engine.
 *
 * The core tests pin individual transitions; these pin the *relationships* — that an
 * attribution is never to the wrong player, that a presented count never disagrees
 * with the board, that resolving events cannot touch the state it read. A whole bot
 * match drives them, so the transitions are ones the engine actually produces rather
 * than ones chosen to be convenient.
 *
 * EARS form, for the record:
 *
 *   - While a match is in progress, when a move is applied, the event layer shall
 *     attribute every territory change to the player who holds that arrow after the
 *     move.
 *   - While a match is in progress, when a living player's trail shrinks without
 *     being claimed, the event layer shall attribute the cut to the player who
 *     moved. A vanished seat's trail drop is `seatVanished`, not a cut (P39).
 *   - When events are resolved, the event layer shall not modify either state.
 *   - When the same transition is resolved twice, the event layer shall produce
 *     identical events.
 *   - When a split or merge is presented, the presented counts shall equal the
 *     counts on the board.
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_MATCH_CONFIG } from '@conquarrow/contracts';
import type { ArrowId, GameState, Move, PlayerId } from '@conquarrow/contracts';
import { makeMatch, makeTiling } from '@conquarrow/geometry-tiling';
import { makeRules } from '@conquarrow/rules-core';
import { resolveEvents, type GameEvent } from '../src/fx/events';
import { overlayLifetimeMs, presentEvents, type FxOverlay } from '../src/fx/present';
import { emptyQueue, enqueue, MAX_FX_ITEMS } from '../src/fx/queue';
import { AUDIBLE_KINDS, cueFor } from '../src/fx/sound';
import { MAJOR_SEQUENCE_MS } from '../src/fx/timing';
import { chooseTurnGreedy } from '../src/botSearch';
import { playBotTurn } from '../src/opponent';

const geometry = makeTiling();
const rules = makeRules(geometry);

interface Transition {
  readonly before: GameState;
  readonly after: GameState;
  readonly move: Move;
  readonly events: readonly GameEvent[];
  readonly overlays: readonly FxOverlay[];
}

/**
 * A real match, resolved move by move.
 *
 * Bounded turns rather than played to a winner: the properties are per-transition,
 * so a few dozen turns of three seats expanding into each other exercises closures,
 * cuts, splits, merges and production without a minute of bot search.
 *
 * Drive the harness with frozen greedy-v1, not live `playBotTurn`. Beam (P53)
 * strides instead of milling; 60 opening turns then produce no cut and the
 * attribution property goes vacuous. Event-legibility needs a combat-rich
 * trajectory, not the local product policy.
 */
/** Sequence number each transition was presented with, for the re-present check. */
const seqs = new Map<GameState, number>();

const seqFor = (t: Transition): number => seqs.get(t.before) ?? 1;

const playMatch = (turns: number): readonly Transition[] => {
  let at = makeMatch({ ...DEFAULT_MATCH_CONFIG, playerCount: 3 });
  const out: Transition[] = [];
  let seq = 1;
  for (let turn = 0; turn < turns && at.winner === undefined; turn += 1) {
    const moves = chooseTurnGreedy(geometry, rules, at, at.activePlayer);
    if (moves.length === 0) break;
    for (const move of moves) {
      const before = at;
      let after: GameState;
      try {
        after = rules.apply(before, move);
      } catch {
        break;
      }
      const events = resolveEvents({ before, after, move });
      const overlays = presentEvents(events, { geometry, seq });
      seqs.set(before, seq);
      seq += overlays.length + 1;
      out.push({ before, after, move, events, overlays });
      at = after;
      if (at.winner !== undefined) break;
    }
  }
  return out;
};

const transitions = playMatch(60);

const owners = (state: GameState): ReadonlyMap<string, PlayerId> => {
  const out = new Map<string, PlayerId>();
  for (const [arrow, owner] of state.territory) out.set(String(arrow), owner);
  return out;
};

const headsFor = (state: GameState, player: PlayerId): number => {
  let n = 0;
  for (const group of state.groups.values()) if (group.owner === player) n += group.heads;
  return n;
};

const of = <K extends GameEvent['kind']>(
  events: readonly GameEvent[],
  kind: K,
): readonly Extract<GameEvent, { kind: K }>[] =>
  events.filter((e): e is Extract<GameEvent, { kind: K }> => e.kind === kind);

describe('the harness itself', () => {
  it('produced a match with real transitions to check', () => {
    expect(transitions.length).toBeGreaterThan(20);
    const seen = new Set<string>();
    for (const t of transitions) for (const e of t.events) seen.add(e.kind);
    // If the engine stopped producing these, the properties below are vacuous.
    expect(seen).toContain('moved');
    expect(seen).toContain('trailLaid');
    expect(seen).toContain('turnPassed');
  });
});

describe('resolving events cannot affect the game', () => {
  it('never modifies either state it read', () => {
    // Serialised either side of the read: the layer is a pure reading, and the
    // rules engine stays the only thing that produces a state.
    let at = makeMatch({ ...DEFAULT_MATCH_CONFIG, playerCount: 3 });
    const { moves } = playBotTurn(geometry, rules, at, at.activePlayer);
    for (const move of moves.slice(0, 6)) {
      const before = at;
      const after = rules.apply(before, move);
      const snapshot = (s: GameState): string =>
        JSON.stringify({
          active: String(s.activePlayer),
          groups: [...s.groups].map(([k, g]) => [String(k), String(g.owner), g.heads]).toSorted(),
          trails: [...s.trails].map(([p, t]) => [String(p), [...t].map(String).toSorted()]),
          territory: [...s.territory].map(([k, o]) => [String(k), String(o)]).toSorted(),
        });
      const beforeSnap = snapshot(before);
      const afterSnap = snapshot(after);
      const events = resolveEvents({ before, after, move });
      presentEvents(events, { geometry, seq: 1 });
      expect(snapshot(before)).toBe(beforeSnap);
      expect(snapshot(after)).toBe(afterSnap);
      at = after;
    }
  });

  it('resolves the same transition to identical events every time', () => {
    // Ordering is the realistic determinism failure here (ADR 0001): the layer
    // iterates sets, and a stagger built from an unstable order would drift.
    for (const t of transitions) {
      const again = resolveEvents({ before: t.before, after: t.after, move: t.move });
      expect(JSON.stringify(again)).toBe(JSON.stringify(t.events));
    }
  });

  it('presents the same events to identical overlays, ids included', () => {
    for (const t of transitions.slice(0, 40)) {
      const again = presentEvents(t.events, { geometry, seq: seqFor(t) });
      expect(JSON.stringify(again.map((o) => ({ ...o, id: '' })))).toBe(
        JSON.stringify(t.overlays.map((o) => ({ ...o, id: '' }))),
      );
    }
  });
});

describe('attribution', () => {
  it('attributes every territory change to whoever holds the arrow afterwards', () => {
    for (const t of transitions) {
      const wasOwned = owners(t.before);
      const isOwned = owners(t.after);
      const changed = new Set<string>();
      for (const [arrow, owner] of isOwned) {
        if (wasOwned.get(arrow) !== owner) changed.add(arrow);
      }
      const claimed = new Set<string>();
      for (const captured of of(t.events, 'territoryCaptured')) {
        for (const arrow of captured.arrows) {
          // The captor named by the event is the owner on the board. Anything else
          // would put the fill in the wrong colour.
          expect(isOwned.get(String(arrow))).toBe(captured.player);
          claimed.add(String(arrow));
        }
      }
      // Nothing changed hands without being announced.
      expect([...changed].toSorted()).toEqual([...claimed].toSorted());
    }
  });

  it('attributes lost ground to the player who actually held it', () => {
    for (const t of transitions) {
      const wasOwned = owners(t.before);
      for (const lost of of(t.events, 'territoryLost')) {
        for (const arrow of lost.arrows) {
          expect(wasOwned.get(String(arrow))).toBe(lost.player);
          expect(t.after.territory.get(arrow)).not.toBe(lost.player);
        }
        if (lost.to !== undefined) {
          for (const arrow of lost.arrows) {
            expect(t.after.territory.get(arrow)).toBe(lost.to);
          }
        }
      }
    }
  });

  it('attributes every cut to the player who moved, against a real victim', () => {
    let cuts = 0;
    for (const t of transitions) {
      for (const cut of of(t.events, 'trailCut')) {
        cuts += 1;
        expect(cut.attacker).toBe(t.before.activePlayer);
        const held = t.before.trails.get(cut.victim);
        const now = t.after.trails.get(cut.victim);
        for (const arrow of cut.arrows) {
          // Was theirs, is not any more, and was not claimed as their own ground.
          expect(held?.has(arrow)).toBe(true);
          expect(now?.has(arrow) ?? false).toBe(false);
          expect(t.after.territory.get(arrow)).not.toBe(cut.victim);
        }
      }
    }
    // A match where nobody ever cut anything would make this property vacuous.
    expect(cuts).toBeGreaterThan(0);
  });

  it('never reports a closure and a cut for the same arrow and player', () => {
    for (const t of transitions) {
      for (const closed of of(t.events, 'enclosureClosed')) {
        const boundary = new Set(closed.boundary.map(String));
        for (const cut of of(t.events, 'trailCut')) {
          if (cut.victim !== closed.player) continue;
          for (const arrow of cut.arrows) expect(boundary.has(String(arrow))).toBe(false);
        }
      }
    }
  });

  it('places production where the heads actually appeared', () => {
    for (const t of transitions) {
      for (const produced of of(t.events, 'unitsProduced')) {
        const was = t.before.groups.get(produced.arrow);
        const now = t.after.groups.get(produced.arrow);
        expect(now?.owner).toBe(produced.player);
        expect((now?.heads ?? 0) - (was?.owner === produced.player ? was.heads : 0)).toBe(
          produced.amount,
        );
        expect(produced.amount).toBeGreaterThan(0);
      }
    }
  });

  it('reports a conversion only where the owner changed in place', () => {
    for (const t of transitions) {
      for (const converted of of(t.events, 'unitsConverted')) {
        expect(t.before.groups.get(converted.arrow)?.owner).toBe(converted.from);
        expect(t.after.groups.get(converted.arrow)?.owner).toBe(converted.to);
        expect(t.after.groups.get(converted.arrow)?.heads).toBe(converted.heads);
      }
    }
  });
});

describe('presented counts agree with the board', () => {
  it('splits and merges never invent or lose a head', () => {
    for (const t of transitions) {
      for (const split of of(t.events, 'stackSplit')) {
        expect(split.moved + split.stayed).toBe(t.before.groups.get(split.from)?.heads);
        expect(t.after.groups.get(split.from)?.heads).toBe(split.stayed);
      }
      for (const sentry of of(t.events, 'sentryLeft')) {
        expect(t.after.groups.get(sentry.arrow)?.heads).toBe(sentry.heads);
        expect(t.after.groups.get(sentry.arrow)?.owner).toBe(sentry.player);
      }
      for (const merged of of(t.events, 'stackMerged')) {
        expect(merged.arriving + merged.existing).toBe(merged.total);
        expect(t.after.groups.get(merged.to)?.heads).toBe(merged.total);
      }
    }
  });

  it('combat losses stay inside what each side brought', () => {
    for (const t of transitions) {
      for (const combat of of(t.events, 'combat')) {
        expect(combat.attackerLost).toBeGreaterThanOrEqual(0);
        expect(combat.defenderLost).toBeGreaterThanOrEqual(0);
        expect(combat.attackerLost).toBeLessThanOrEqual(combat.attackerSent);
        expect(combat.defenderLost).toBeLessThanOrEqual(combat.defenderBefore);
        expect(combat.holder).toBe(t.after.groups.get(combat.arrow)?.owner);
      }
    }
  });

  it('never claims heads changed for a player whose total did not move', () => {
    for (const t of transitions) {
      for (const player of t.before.players) {
        const delta = headsFor(t.after, player) - headsFor(t.before, player);
        if (delta > 0) continue;
        // A player who gained nothing must not have a production event.
        for (const produced of of(t.events, 'unitsProduced')) {
          if (produced.player === player) expect(delta).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe('every arrow set leaves sorted, so a stagger is reproducible', () => {
  it('holds for every event that carries a set of arrows', () => {
    const sorted = (arrows: readonly ArrowId[]): boolean => {
      const strings = arrows.map(String);
      return strings.every((s, i) => i === 0 || (strings[i - 1] ?? '') <= s);
    };
    for (const t of transitions) {
      for (const event of t.events) {
        if ('arrows' in event) expect(sorted(event.arrows)).toBe(true);
        if ('boundary' in event) expect(sorted(event.boundary)).toBe(true);
        if ('claimed' in event) expect(sorted(event.claimed)).toBe(true);
      }
    }
  });
});

describe('presentation stays inside its budget', () => {
  it('keeps routine feedback shorter than major feedback, always', () => {
    let tier1 = 0;
    let tier3 = 0;
    for (const t of transitions) {
      for (const overlay of t.overlays) {
        if (overlay.tier === 1) tier1 = Math.max(tier1, overlay.durationMs);
        if (overlay.tier === 3) tier3 = Math.max(tier3, overlay.durationMs);
      }
    }
    expect(tier3).toBeGreaterThan(0);
    expect(tier3).toBeLessThan(tier1);
  });

  it('keeps every routine overlay inside the responsiveness budget', () => {
    for (const t of transitions) {
      for (const overlay of t.overlays) {
        if (overlay.tier !== 3) continue;
        expect(overlayLifetimeMs(overlay)).toBeLessThanOrEqual(MAJOR_SEQUENCE_MS);
      }
    }
  });

  it('never lets a real match overflow the queue with unique ids colliding', () => {
    let queue = emptyQueue();
    let clock = 1000;
    for (const t of transitions) {
      queue = enqueue(queue, t.overlays, clock);
      clock += 50;
      expect(queue.length).toBeLessThanOrEqual(MAX_FX_ITEMS);
      expect(new Set(queue.map((i) => i.overlay.id)).size).toBe(queue.length);
    }
  });
});

describe('sound reinforces, and stays quiet', () => {
  it('only the five deciding events plus the loss counterpart and a seat vanish are audible', () => {
    expect([...AUDIBLE_KINDS].toSorted()).toEqual(
      [
        'captureFill',
        'combat',
        'cutSnap',
        'emergence',
        'lossRetract',
        'loopPulse',
        'seatVanish',
      ].toSorted(),
    );
  });

  it('ordinary movement is silent', () => {
    expect(cueFor('advance')).toBeUndefined();
    expect(cueFor('trailLaid')).toBeUndefined();
    expect(cueFor('divergence')).toBeUndefined();
    expect(cueFor('turnHandover')).toBeUndefined();
  });

  it('pairs gaining and losing ground as inverses, so the two are distinguishable', () => {
    const gain = cueFor('captureFill');
    const loss = cueFor('lossRetract');
    expect(gain).toBeDefined();
    expect(loss).toBeDefined();
    if (gain === undefined || loss === undefined) return;
    expect(gain.toHz).toBeGreaterThan(gain.fromHz);
    expect(loss.toHz).toBeLessThan(loss.fromHz);
  });
});
