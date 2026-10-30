/**
 * Ray-run route drafting — what is clickable from the tip, and how it paints.
 *
 * Packet P34. `docs/spec/ray-run-input/ray-run-input.md`.
 *
 * A route is a **word over three out-slots**. Because the three out-directions
 * sum to zero, a shortest route's prefix uses at most two of them, and a
 * destination fixes the word's last letter — so a destination has exactly one
 * route **iff** its word is `s^m` or `s^m·e`: straight along one slot, then
 * optionally one turn at the end. That set is what this module offers, which is
 * why no route is ever picked by the adapter: every arrow of the draft was named
 * by a click.
 *
 * There is deliberately **no `remaining <= 2` special case**. Everything within
 * two steps has word `s·e`, a prefix of length one, so the general rule already
 * covers it.
 *
 * **Measured, never derived.** Every hop is offered only because `rules.apply`
 * accepted it on a scratch state, exactly as `reach.ts` already does.
 * `speed(carry)` and {@link MAX_DEPTH} only *bound* the search; the engine
 * decides every step, so a rule change moves the offer with it.
 *
 * Pure: equal state + tip + carry + draft produce equal rays, turn arrows and
 * paint. No clock, no randomness.
 *
 * @see docs/spec/ray-run-input/ray-run-input.md
 */

import { speed, step } from '@conquarrow/contracts';
import type {
  ArrowId,
  GameState,
  GeometryPort,
  Move,
  RulesPort,
  StepMove,
} from '@conquarrow/contracts';
import type { InputPhase, RoutePhase } from './input/modes';
import { reachFrom } from './reach';
import type { PointerKind } from './selectionChrome';

/** A depth cap, so a pathological board cannot spin the renderer. As `reach.ts`. */
export const MAX_DEPTH = 8;

/**
 * An index into `outArrows(point)` — 0, 1 or 2.
 *
 * Not `contracts`' `Slot`, which is one of the *six* cyclic positions at a point
 * and carries no direction (P02 D1 / §11 item 29). A ray is "keep taking the
 * same out-slot", and on the generated tiling `outArrows(point)[k]` is the arrow
 * of grain `k` — so slot-consistency is the rule and straightness is a tiling
 * property. This packet adds no grain accessor to `GeometryPort`.
 */
export type RaySlot = 0 | 1 | 2;

export const RAY_SLOTS: readonly RaySlot[] = [0, 1, 2];

/** `ray` for word `s^m`; `turn` for `s^m·e` — the one free turn at the end. */
export type OptionKind = 'ray' | 'turn';

/** One clickable arrow, and the single run (plus optional turn) that reaches it. */
export interface RouteOption {
  readonly arrow: ArrowId;
  readonly kind: OptionKind;
  /** The slot the run took. A turn arrow names its *ray's* slot, not the turn's. */
  readonly slot: RaySlot;
  /** Exits to walk from the tip, in order. The last one is `arrow`. */
  readonly steps: readonly ArrowId[];
  /**
   * The count the run drafts at: the **largest** that walks it end to end (P35).
   *
   * `tipHeads` everywhere except a final attack step, where §6.2's stay-behind
   * takes it to `tipHeads - 1`. Carried on the option rather than re-derived by
   * the caller, because it is the count this run *was measured at* — deriving it
   * again is how the two copies come to disagree.
   */
  readonly count: number;
}

/** Ray arrows and turn arrows, keyed by arrow. Provably the unique-route set. */
export type ClickableSet = ReadonlyMap<ArrowId, RouteOption>;

/**
 * Everything a measurement needs: the scratch state after the draft, where the
 * tip is, and how many heads travel from it.
 */
export interface RouteInputs {
  readonly geometry: GeometryPort;
  readonly rules: RulesPort;
  /** The scratch state **after** the draft has been walked. Never the live board. */
  readonly state: GameState;
  /** The original source. Clicking it deselects (empty draft) or pops. */
  readonly from: ArrowId;
  /** Last arrow the draft walks, or `from` when the draft is empty. */
  readonly tip: ArrowId;
  /** The draft so far, in order. Applied to nothing. */
  readonly draft: readonly Move[];
  /**
   * Heads travelling from the tip. The rest stay as a sentry (§5).
   *
   * **Since P35 this steers no ray.** The offer — rays, turns, clickable set — is
   * measured at {@link RouteInputs.tipHeads}, because the count is asked after the
   * click and can no longer shrink what is on offer before one. What is left
   * reading it is the reach wash, the faint tier that says "further than one run".
   */
  readonly carry: number;
  /**
   * Heads standing on the tip in `state` — read off the state, not the carry.
   *
   * **The measurement the whole offer is taken at** (P35): a run is walked at this
   * count and at one below it, and an arrow is clickable iff one of the two walks
   * reaches it.
   */
  readonly tipHeads: number;
  /**
   * Did the draft's **last** step merge, close or resolve combat?
   *
   * Not derivable here: `state` is the board *after* the draft, and combat has
   * already destroyed the heads that would give the diff away. The caller holds
   * the pre-draft board and measures it with {@link isTerminalStep} as it walks —
   * so it is passed in rather than re-derived. Absent means "no draft, or an
   * ordinary hop", which is the common case.
   */
  readonly terminal?: boolean;
  /**
   * The **last run** on the draft — what the count control edits (P35).
   *
   * Absent with an empty draft, which is why {@link runCarries} is empty there
   * and no control is drawn before a destination exists.
   */
  readonly lastRun?: LastRun;
}

/**
 * The last run of a draft: where it began, and the exits it walks (P35).
 *
 * A run is defined by the click that made it, and nothing in a flat `Move[]`
 * records where a click ended — so the boundaries are carried rather than
 * re-derived. `steps.length` is the final entry of `RoutePhase.runLengths`,
 * which {@link lastRunLength} reads.
 */
export interface LastRun {
  /** The scratch state as it stood **before** the run was walked. */
  readonly state: GameState;
  /** The arrow the run started from. Heads standing here cap its count. */
  readonly start: ArrowId;
  /** The exits the run walks, in order. The last one is the tip. */
  readonly steps: readonly ArrowId[];
}

/**
 * The whole offer from one tip, built once per selection / extend / pop / count.
 *
 * It carries **no `carry`**. P34's offer echoed the carry it was measured at, but
 * P35 measures every offer at the tip's full head count, so the echo had no
 * reader left — and on the snapshot after a terminal step it disagreed with
 * `RoutePhase.carry` (the count the last run was *drafted* at) while wearing the
 * same name. Two fields named `carry` meaning two things, one of them unread, is
 * the shape of a future wrong answer.
 */
export interface RouteOffer {
  readonly tip: ArrowId;
  /** Indexed by out-slot; always length 3. Truncated where the engine stops. */
  readonly rays: readonly (readonly ArrowId[])[];
  readonly clickable: ClickableSet;
  /**
   * Legal counts for the **last run**, ascending — empty with an empty draft.
   *
   * P35 redefines this: it used to be the carries that could make one hop from
   * the tip, forward of the click; it is now {@link runCarries}, the counts that
   * walk the whole run the click just named, behind it.
   */
  readonly carries: readonly number[];
  /**
   * Heads standing where the **last run** began — the ceiling on its count, and
   * the base the sentry (§5) is the difference from. Zero with an empty draft.
   *
   * Carried on the offer because the docked control is drawn from the phase
   * alone, and no board state reaches it: the heads at the run's *start* are not
   * `tipHeads` (a merge raises that number, combat lowers it) and are not
   * `max(carries)` either (an attack's ceiling is one below them).
   */
  readonly ceiling: number;
  /** The faint tier: reachable with this carry, minus every louder tier. */
  readonly reachWash: ReadonlySet<ArrowId>;
  /**
   * Per clickable arrow, the set that would be clickable from *there*.
   *
   * Built with the offer so hover is a map lookup. Recomputing reach per hovered
   * arrow is what would make this model feel broken.
   */
  readonly previews: ReadonlyMap<ArrowId, ClickableSet>;
}

/** Three tiers plus the tip, quietest first. */
export interface RoutePaint {
  readonly reachWash: ReadonlySet<ArrowId>;
  readonly rayArrows: ReadonlySet<ArrowId>;
  readonly turnArrows: ReadonlySet<ArrowId>;
  /** The draft, in walk order — the strongest mark. */
  readonly draftArrows: readonly ArrowId[];
  readonly hoverPreview: ReadonlySet<ArrowId>;
  readonly tip?: ArrowId;
}

/** P77: names the dashed multi-run mark, which is not a click target. */
export const ROUTE_HINT_EMPTY =
  'Click a lit arrow to draft a run · one turn at the end is free · dashed = needs more than one run';
export const ROUTE_HINT_DRAFTED =
  'Click to extend · click a walked arrow to go back · Send to move';
/**
 * Shown when the draft can go no further — allowance spent, or the last step was
 * terminal (§ *Terminal steps*). Offering "click to extend" with an empty
 * clickable set is the small kind of lie this packet exists to remove: the player
 * hunts for a ray that is not there and concludes the rays are broken.
 */
export const ROUTE_HINT_FINISHED =
  'This run can go no further · click a walked arrow to go back · Send to move';

/** The arrows a list of drafted moves walks, in order. */
export const draftExits = (draft: readonly Move[]): readonly ArrowId[] =>
  draft.filter((move): move is StepMove => move.kind === 'step').map((move) => move.exit);

/** The moves that walk `steps` from `tip`, all at one carry. */
export const runMoves = (
  tip: ArrowId,
  steps: readonly ArrowId[],
  carry: number,
): readonly Move[] => {
  const moves: Move[] = [];
  let at = tip;
  for (const exit of steps) {
    moves.push(step(at, exit, carry));
    at = exit;
  }
  return moves;
};

/**
 * Arrows the draft already walks, plus the source.
 *
 * A run ends rather than re-entering one of these, so a ray cannot loop on a
 * board with a short cycle, and the source is never offered as a destination —
 * clicking it deselects or pops (P11's idiom, unchanged).
 */
export const walkedArrows = (inputs: RouteInputs): ReadonlySet<ArrowId> =>
  new Set<ArrowId>([inputs.from, ...draftExits(inputs.draft)]);

/** `MAX_DEPTH` less the draft length. A bound on the search, never an authority. */
export const searchBound = (inputs: RouteInputs, count: number): number => {
  if (count < 1 || !Number.isInteger(count)) return 0;
  // `speed(count)` can only ever *narrow* the window: a run carries the whole
  // count, so no group on it is bigger than that. The engine still refuses every
  // hop past the allowance actually left.
  return Math.max(0, Math.min(MAX_DEPTH - inputs.draft.length, speed(count)));
};

const headsOn = (state: GameState, arrow: ArrowId): number =>
  state.groups.get(arrow)?.heads ?? 0;

const exitAt = (
  geometry: GeometryPort,
  arrow: ArrowId,
  slot: RaySlot,
): ArrowId | undefined => geometry.outArrows(geometry.target(arrow))[slot];

/** The state after one hop, or `undefined` when the engine refuses it. */
const tryHop = (
  inputs: RouteInputs,
  state: GameState,
  move: StepMove,
): GameState | undefined => {
  try {
    return inputs.rules.apply(state, move);
  } catch {
    return undefined;
  }
};

/** A step, or `undefined` when it is not even a well-formed move. */
const hopMove = (at: ArrowId, exit: ArrowId, carry: number): StepMove | undefined => {
  if (at === exit || carry < 1 || !Number.isInteger(carry)) return undefined;
  return step(at, exit, carry);
};

/**
 * Did this accepted hop change the board beyond what an un-applied draft can show?
 *
 * Three do, and each **ends the draft**, not merely the run — at a terminal tip
 * the clickable set is empty and only Send or a pop remain:
 *
 * - **merge** — `before` held a group of the active player on `exit` (§3)
 * - **closure** — `after.territory` grew across the hop (§7)
 * - **combat** — head counts changed on `exit` or on `move.from` (§6.2)
 *
 * Detected by comparing the two scratch states, never by reading engine
 * internals. The closure case cannot come from `try apply … else stop`: the
 * engine *accepts* the hop after a closure lands, so this is the feature's own
 * rule.
 *
 * The combat test is *conservation* across the two arrows the hop touches, not
 * "the counts differ": every hop moves heads off `from` and onto `exit`, so a
 * plain difference would call every step terminal. Heads going missing is what
 * only combat does (§6.2's 1:1 exchange).
 */
export const isTerminalStep = (
  before: GameState,
  after: GameState,
  move: StepMove,
): boolean => {
  const standing = before.groups.get(move.exit);
  if (standing !== undefined && standing.owner === before.activePlayer) return true;
  if (after.territory.size > before.territory.size) return true;
  const was = headsOn(before, move.from) + headsOn(before, move.exit);
  const now = headsOn(after, move.from) + headsOn(after, move.exit);
  return now !== was;
};

/** One arrow of a ray, with the scratch state the run stands in after it. */
interface RayHop {
  readonly arrow: ArrowId;
  /** Exits from the tip to here, in order. */
  readonly steps: readonly ArrowId[];
  readonly state: GameState;
  readonly terminal: boolean;
  /** The count this whole run was walked at — what a click on it drafts. */
  readonly count: number;
}

/** One whole-run walk of a ray at one count, and why it stopped. */
interface RayWalk {
  readonly hops: readonly RayHop[];
  /**
   * Did the **engine** end the walk, as opposed to the bound, the geometry or a
   * revisit?
   *
   * Only an engine refusal is worth a second walk: everything else says the same
   * thing at every count, and re-walking on a revisit or a spent allowance is how
   * the offer would come to cost a walk per count.
   */
  readonly refused: boolean;
}

/** Walk one ray from the tip at a single count, stopping where anything stops it. */
const walkRay = (inputs: RouteInputs, slot: RaySlot, count: number): RayWalk => {
  const bound = searchBound(inputs, count);
  const blocked = new Set<ArrowId>(walkedArrows(inputs));
  const hops: RayHop[] = [];
  let at = inputs.tip;
  let state = inputs.state;
  let steps: readonly ArrowId[] = [];
  for (let m = 0; m < bound; m += 1) {
    const exit = exitAt(inputs.geometry, at, slot);
    if (exit === undefined || blocked.has(exit)) break;
    const move = hopMove(at, exit, count);
    if (move === undefined) break;
    const next = tryHop(inputs, state, move);
    if (next === undefined) return { hops, refused: true };
    steps = [...steps, exit];
    const terminal = isTerminalStep(state, next, move);
    hops.push({ arrow: exit, steps, state: next, terminal, count });
    if (terminal) break;
    blocked.add(exit);
    at = exit;
    state = next;
  }
  return { hops, refused: false };
};

/**
 * One ray, offered at the largest count that walks each of its runs (P35).
 *
 * **Two whole-run walks, never a per-step retry.** The ray is walked at the
 * carry; if the engine refused a step, it is walked *again from the tip* at one
 * count fewer, and the arrows the second walk reaches beyond the first join the
 * offer at that lower count. The union keeps the higher count wherever both
 * reached, so a run never mixes counts inside itself.
 *
 * Retrying the one refused *step* at a lower count would mix them, and that
 * quietly re-permits a mid-route attack: with an enemy two steps out, step 1 is
 * accepted at `heads` and step 2 retried at `heads - 1` is accepted too, because
 * the movers still number `heads` — an arrow no *single* count can reach would
 * become clickable. A count must hold for every step of its run.
 *
 * Two counts suffice because §6.2's stay-behind is the only count-sensitive
 * refusal and, past the first hop, the movers **are** the count — so a run whose
 * later step attacks is unwalkable at every count.
 *
 * That same argument says the second walk can only ever add to the *first* step,
 * so `slice` covers the general union without a length test: where the armed walk
 * reached no further, the tail it contributes is empty.
 *
 * The two counts are read from **`tipHeads`**, not from `inputs.carry`: the rule
 * is "some count *not exceeding the heads standing on the tip*" (invariant 4), and
 * P35 measures every offer at full strength — a carry chosen in advance no longer
 * shrinks what is offered. Reading the heads makes that true by construction
 * rather than by the caller's convention of passing `carry === tipHeads`.
 */
const rayHops = (inputs: RouteInputs, slot: RaySlot): readonly RayHop[] => {
  if (inputs.terminal === true) return [];
  const full = walkRay(inputs, slot, inputs.tipHeads);
  if (!full.refused) return full.hops;
  const armed = walkRay(inputs, slot, inputs.tipHeads - 1);
  return [...full.hops, ...armed.hops.slice(full.hops.length)];
};

/**
 * The arrows reachable from the tip through one slot, in order, truncated.
 *
 * Stops at the first hop the engine **refuses** — enemy territory without
 * territory-grade protection (§6.3), a P28 refused self-convert exit, an attack
 * the stay-behind rule forbids, a revisit, allowance running out — and at the
 * first hop it **accepts terminally**, see {@link isTerminalStep}.
 *
 * §6.2's stay-behind (`count <= heads - 1`, §11 item 38) is why an enemy-held
 * arrow is never reached mid-run: a run carries one count throughout, so after
 * the first hop `count = heads` at the tip and the attack is refused. A ray
 * therefore ends *before* an enemy-held arrow at distance >= 2.
 *
 * **P35**: an *adjacent* one is offered all the same. An arrow is clickable iff
 * **some** count `<= tipHeads` walks the whole run to it, and the run drafts at
 * the largest such count — which is `tipHeads` everywhere except a final attack
 * step, where it is `tipHeads - 1`. Nothing else in the engine reads the count
 * and `speed` is monotone, so walking the run at `tipHeads` and at
 * `tipHeads - 1` decides it: two walks, not one per count. The 1..ceiling scan
 * happens once, in {@link runCarries}, for the single drafted run.
 */
export const rayArrows = (inputs: RouteInputs, slot: RaySlot): readonly ArrowId[] =>
  rayHops(inputs, slot).map((hop) => hop.arrow);

/** The three rays, walked once. */
const raysOf = (inputs: RouteInputs): readonly (readonly RayHop[])[] =>
  RAY_SLOTS.map((slot) => rayHops(inputs, slot));

/** A clickable arrow, plus the scratch state a click on it would leave behind. */
interface WalkedOption {
  readonly option: RouteOption;
  readonly state: GameState;
  readonly terminal: boolean;
}

const turnOptions = (
  inputs: RouteInputs,
  slot: RaySlot,
  hop: RayHop,
  blocked: ReadonlySet<ArrowId>,
): readonly WalkedOption[] => {
  const out: WalkedOption[] = [];
  for (const turnSlot of RAY_SLOTS) {
    if (turnSlot === slot) continue;
    const exit = exitAt(inputs.geometry, hop.arrow, turnSlot);
    if (exit === undefined || blocked.has(exit) || hop.steps.includes(exit)) continue;
    // The turn is one more step of the *same* run, so it takes the ray's count.
    // It is never a run's first step, and past the first hop the movers are the
    // count — so no lower count could take a turn this one refuses.
    const move = hopMove(hop.arrow, exit, hop.count);
    if (move === undefined) continue;
    const next = tryHop(inputs, hop.state, move);
    if (next === undefined) continue;
    out.push({
      option: { arrow: exit, kind: 'turn', slot, steps: [...hop.steps, exit], count: hop.count },
      state: next,
      terminal: isTerminalStep(hop.state, next, move),
    });
  }
  return out;
};

/**
 * Every offer from the tip: the three rays, then the turns off them.
 *
 * Rays first so that where a ray arrow and a turn arrow land on the same arrow at
 * the same distance — which an abstract fixture board allows and the tiling's
 * linear lattice does not — the ray keeps the entry.
 */
const routeOptions = (
  inputs: RouteInputs,
  rays: readonly (readonly RayHop[])[],
): readonly WalkedOption[] => {
  const blocked = walkedArrows(inputs);
  const out: WalkedOption[] = [];
  for (const slot of RAY_SLOTS) {
    for (const hop of rays[slot] ?? []) {
      out.push({
        option: { arrow: hop.arrow, kind: 'ray', slot, steps: hop.steps, count: hop.count },
        state: hop.state,
        terminal: hop.terminal,
      });
    }
  }
  for (const slot of RAY_SLOTS) {
    for (const hop of rays[slot] ?? []) {
      // A turn off a terminal ray arrow would draft *past* a merge, a closure or
      // resolved combat — the board a later leg would be drawn against is gone.
      if (hop.terminal) continue;
      out.push(...turnOptions(inputs, slot, hop, blocked));
    }
  }
  return out;
};

/** Shorter routes win, and a tie keeps the entry offered first (rays before turns). */
const keepShortest = (walked: readonly WalkedOption[]): Map<ArrowId, WalkedOption> => {
  const best = new Map<ArrowId, WalkedOption>();
  for (const item of walked) {
    const seen = best.get(item.option.arrow);
    if (seen !== undefined && seen.option.steps.length <= item.option.steps.length) continue;
    best.set(item.option.arrow, item);
  }
  return best;
};

const optionsOf = (best: ReadonlyMap<ArrowId, WalkedOption>): ClickableSet => {
  const clickable = new Map<ArrowId, RouteOption>();
  for (const [arrow, item] of best) clickable.set(arrow, item.option);
  return clickable;
};

/**
 * Ray arrows, plus the two turn arrows off every ray arrow.
 *
 * Ray-before-turn: a turn arrow exists only if its whole ray prefix is walkable,
 * and an arrow already keyed at a shorter distance keeps that shorter entry.
 *
 * **Empty at a terminal tip** — a tip the draft reached by merging, closing or
 * resolving combat offers Send or a pop and nothing else.
 */
export const clickableSet = (inputs: RouteInputs): ClickableSet =>
  inputs.terminal === true
    ? new Map()
    : optionsOf(keepShortest(routeOptions(inputs, raysOf(inputs))));

/** Does `count` walk every step of the run, measured hop by hop on the engine? */
const walksRun = (inputs: RouteInputs, run: LastRun, count: number): boolean => {
  let state = run.state;
  let at = run.start;
  for (const exit of run.steps) {
    const move = hopMove(at, exit, count);
    if (move === undefined) return false;
    const next = tryHop(inputs, state, move);
    if (next === undefined) return false;
    state = next;
    at = exit;
  }
  return true;
};

/**
 * Heads standing where the last run began — the ceiling on its count (P35).
 *
 * Zero with an empty draft, which is what makes {@link runCarries} empty there.
 */
export const runCeiling = (inputs: RouteInputs): number =>
  inputs.lastRun === undefined ? 0 : headsOn(inputs.lastRun.state, inputs.lastRun.start);

/**
 * The counts that walk the **whole last run**, ascending (P35).
 *
 * Measured, never derived: a count is offered only when **every step** of the
 * run is accepted by `rules.apply`, walked from `lastRun.start` on
 * `lastRun.state`. It is *not* computed from `speed(N) = 1 + floor(log2 N)` —
 * two derivations of one number is how the two copies come to disagree, and the
 * engine is the one that decides.
 *
 * The ceiling falls out of the same measurement: no count above the heads
 * standing where the run began can step at all — and where the run's final step
 * attacks, §6.2's stay-behind takes the ceiling down to `heads - 1`.
 *
 * Measuring is what makes it right about **spent allowance**: `spent` travels
 * with the movers, so a second run of `k` steps off a tip that has already spent
 * `j` needs the heads for `j + k`, not for `k`. A formula would have to know
 * that; a walk on the scratch state already does.
 *
 * **Empty with an empty draft** — there is no last run, so there is nothing to
 * count and no control to draw.
 */
export const runCarries = (inputs: RouteInputs): readonly number[] => {
  const run = inputs.lastRun;
  if (run === undefined || run.steps.length === 0) return [];
  const out: number[] = [];
  // The one 1..ceiling scan this feature affords, and it is affordable because it
  // is built once for the single drafted run — never per clickable arrow, never
  // per hover. Ascending because the control steps through it in that order.
  for (let count = 1; count <= runCeiling(inputs); count += 1) {
    if (walksRun(inputs, run, count)) out.push(count);
  }
  return out;
};

/**
 * Everything the carry can reach that no louder tier already claims.
 *
 * Present so a smaller *clickable* set never reads as a smaller *reach*: the rays
 * shrink when heads stay behind, and without this the player would read that as
 * the stack having lost its legs.
 */
const reachWashOf = (
  inputs: RouteInputs,
  clickable: ClickableSet,
): ReadonlySet<ArrowId> => {
  const wash = new Set<ArrowId>();
  if (inputs.terminal === true || inputs.carry < 1) return wash;
  const walked = walkedArrows(inputs);
  const reach = reachFrom(inputs.geometry, inputs.rules, inputs.state, inputs.tip);
  for (const [arrow, entry] of reach) {
    if (!entry.plans.has(inputs.carry)) continue;
    if (arrow === inputs.tip || clickable.has(arrow) || walked.has(arrow)) continue;
    wash.add(arrow);
  }
  return wash;
};

/** The inputs a click on `item` would leave behind — the shape a hover previews. */
const nextInputs = (inputs: RouteInputs, item: WalkedOption): RouteInputs => {
  const heads = headsOn(item.state, item.option.arrow);
  return {
    geometry: inputs.geometry,
    rules: inputs.rules,
    state: item.state,
    from: inputs.from,
    tip: item.option.arrow,
    draft: [...inputs.draft, ...runMoves(inputs.tip, item.option.steps, item.option.count)],
    // The preview's carry is what stands on the new tip. On any hop the draft can
    // continue from, that *is* the carry — the whole carry arrives. Where the two
    // differ the hop was terminal, and then the offer is empty either way, so this
    // never disagrees with the extend `input/modes.ts` would actually make.
    carry: heads,
    tipHeads: heads,
    terminal: item.terminal,
  };
};

/** Build the whole offer once. Hover is then a lookup into `previews`. */
export const buildRouteOffer = (inputs: RouteInputs): RouteOffer => {
  // One set of ray walks feeds both the painted rays and the clickable set: the
  // rays *are* the measurement, so measuring them twice is only a way for the two
  // readings to drift apart.
  const rays = raysOf(inputs);
  const best: ReadonlyMap<ArrowId, WalkedOption> =
    inputs.terminal === true ? new Map() : keepShortest(routeOptions(inputs, rays));
  const clickable = optionsOf(best);
  const previews = new Map<ArrowId, ClickableSet>();
  for (const [arrow, item] of best) previews.set(arrow, clickableSet(nextInputs(inputs, item)));
  return {
    tip: inputs.tip,
    rays: rays.map((hops) => hops.map((hop) => hop.arrow)),
    clickable,
    carries: runCarries(inputs),
    ceiling: runCeiling(inputs),
    reachWash: reachWashOf(inputs, clickable),
    previews,
  };
};

/**
 * The run the count control edits: the final entry of `runLengths`, or `0`.
 *
 * Derived, never stored (P35 *Phase state*). The list is what survives a pop to
 * an earlier boundary; a stored scalar would not.
 */
export const lastRunLength = (runLengths: readonly number[]): number =>
  runLengths[runLengths.length - 1] ?? 0;

/**
 * The docked count control's model, or `undefined` when none is drawn (P35).
 *
 * The control asks the one question a named run has left — how many heads walk
 * it, the rest staying at its start as a sentry (§5). It carries **no
 * coordinates**: it is docked below the board rather than anchored on the tip,
 * because a panel at the tip covers the arrows it is asking about.
 */
export interface CountControl {
  /** The count on the last drafted run. */
  readonly count: number;
  /** Heads standing where the last run began — the ceiling, and the sentry base. */
  readonly ceiling: number;
  /** Legal counts for the last run, ascending. Never empty while a control shows. */
  readonly counts: readonly number[];
  readonly draftLength: number;
  /**
   * The arrow the **last run** began on (P77): the source for a one-run draft,
   * the previous run's tip otherwise. Where the leftover stands.
   */
  readonly start: ArrowId;
}

/**
 * Whether the docked control is drawn at all, and with what.
 *
 * `undefined` with an empty draft (there is no run to count), while the match is
 * over, and while input is locked.
 */
export const countControl = (opts: {
  readonly phase: InputPhase;
  readonly inputLocked: boolean;
  readonly matchOver: boolean;
}): CountControl | undefined => {
  const { phase } = opts;
  if (opts.inputLocked || opts.matchOver) return undefined;
  if (phase.kind !== 'route') return undefined;
  // No run, no question. The empty draft is a *selected* stack, not a route: the
  // count is only meaningful once a click has said what it has to pay for, which
  // is the whole inversion this feature makes (invariant 1).
  if (phase.draft.length === 0) return undefined;
  return {
    count: phase.carry,
    ceiling: phase.offer.ceiling,
    counts: phase.offer.carries,
    draftLength: phase.draft.length,
    start: lastRunStart(phase),
  };
};

/**
 * Where the last run began: the exit just before its boundary, or the source
 * for a one-run draft (P77). The same boundary `setCarry` re-emits from.
 */
const lastRunStart = (phase: RoutePhase): ArrowId => {
  const boundary = phase.draft.length - lastRunLength(phase.runLengths);
  return draftExits(phase.draft)[boundary - 1] ?? phase.from;
};

/**
 * The count strip's note (P77): where the heads a lowered count leaves behind
 * stand — the arrow the last run began on — or that none stays.
 */
export const leftoverNote = (opts: {
  readonly count: number;
  readonly ceiling: number;
  readonly start: ArrowId;
}): string => {
  const left = opts.ceiling - opts.count;
  if (left <= 0) return 'No head stays behind';
  const heads = left === 1 ? '1 head stays' : `${String(left)} heads stay`;
  return `${heads} on ${String(opts.start)}`;
};

/** The locked HUD line for a route phase: empty draft or drafted. */
export const routeHint = (phase: InputPhase): string | undefined => {
  if (phase.kind !== 'route') return undefined;
  if (phase.draft.length === 0) return ROUTE_HINT_EMPTY;
  return phase.offer.clickable.size === 0 ? ROUTE_HINT_FINISHED : ROUTE_HINT_DRAFTED;
};

const emptyPaint = (): RoutePaint => ({
  reachWash: new Set(),
  rayArrows: new Set(),
  turnArrows: new Set(),
  draftArrows: [],
  hoverPreview: new Set(),
});

const previewFor = (
  offer: RouteOffer,
  pointer: PointerKind,
  hoverArrow: ArrowId | undefined,
): ReadonlySet<ArrowId> => {
  if (pointer !== 'fine' || hoverArrow === undefined) return new Set();
  const preview = offer.previews.get(hoverArrow);
  return preview === undefined ? new Set() : new Set(preview.keys());
};

/**
 * Paint for the route phase, and nothing at all for any other phase.
 *
 * A coarse pointer gets no hover preview: every clickable arrow is unambiguous,
 * so there is nothing a preview must disclose.
 *
 * Costs **no** `rules.apply` call: everything is a lookup into the offer the
 * phase already carries, because hover lag is what would make this model feel
 * broken.
 */
export const routePaint = (opts: {
  readonly phase: InputPhase;
  readonly hoverArrow?: ArrowId;
  readonly pointer: PointerKind;
}): RoutePaint => {
  const { phase, pointer } = opts;
  if (phase.kind !== 'route') return emptyPaint();
  const rays = new Set<ArrowId>();
  const turns = new Set<ArrowId>();
  for (const [arrow, option] of phase.offer.clickable) {
    if (option.kind === 'ray') rays.add(arrow);
    else turns.add(arrow);
  }
  return {
    reachWash: phase.offer.reachWash,
    rayArrows: rays,
    turnArrows: turns,
    draftArrows: draftExits(phase.draft),
    hoverPreview: previewFor(phase.offer, pointer, opts.hoverArrow),
    tip: phase.tip,
  };
};
