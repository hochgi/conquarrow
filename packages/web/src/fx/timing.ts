/**
 * One timing vocabulary for every gameplay effect.
 *
 * Presentation only — nothing here is read by the rules. The numbers exist in one
 * place so the board keeps a *consistent* language: a player learns that a short
 * localized flash means combat and a spatial fill means capture, and that lesson
 * only holds if every capture takes the same time as every other one.
 *
 * The upper bound is deliberate. The state transition has already happened by the
 * time any of this runs — an effect is drawn *around* a committed `apply`, never
 * in front of one — so a long effect never delays input. It would still be a lie
 * about how fast the game is, which is why {@link MAJOR_SEQUENCE_MS} is the budget
 * for the chain the numbers are *tuned* against.
 *
 * **It is a budget and not a measurement, and the difference matters.** The claim
 * that used to stand here — that the biggest sequence in the game
 * (enclosure → capture → production) fits inside `MAJOR_SEQUENCE_MS` — is false, and
 * P38 leaned on it before measuring: `captureFresh` alone is offset 500 with a
 * duration of 700 and therefore settles at **1200**, against a stated 700. Nothing
 * downstream may treat this constant as the settle time of a real queue. Anything
 * that needs *when the effects of a move have finished* takes it from the queue —
 * `queueSettleMs`, or `max(offset + lifetime)` over the items present — so it cannot
 * go stale when one of the numbers below moves. Retuning them is a separate job.
 */

/**
 * Visual weight. Tier 1 is the handful of events that decide matches, tier 3 is
 * everything a player does dozens of times a turn and must never be celebrated.
 */
export type FxTier = 1 | 2 | 3;

/** How long one effect's own animation runs, once its offset has elapsed (ms). */
export const FX_MS = {
  /** Routine: the step itself, and the trail cell it leaves. */
  moved: 220,
  trailLaid: 200,
  /** Strategic: the stack changed shape. */
  split: 300,
  merge: 300,
  sentry: 280,
  produced: 320,
  /** P70: four-beat hand-off. Offset stays 300; do not retune the other entries. */
  converted: 700,
  /** Major: the loop closed, ground changed hands, a trail was severed. */
  closed: 300,
  captured: 400,
  captureFresh: 700,
  lost: 420,
  cut: 420,
  /** A seat leaving: flicker-then-fade of remnants, not a cut. */
  vanish: 520,
  combat: 320,
  /** A fight that wiped a stack of three or more reads heavier than a 1:1 trade. */
  combatHeavy: 440,
  /** Feedback, not an event: a refused click and the turn handover. */
  refused: 320,
  turn: 260,
} as const;

/**
 * Causal offsets — when each link of a chain *starts*, relative to the move.
 *
 * This is the whole point of the layer. A capture that fills at the same instant
 * the loop pulses reads as one undifferentiated flash; staggered, it reads as
 * "the loop closed, *therefore* this ground is mine, *therefore* these heads
 * appeared". The offsets are what makes the causal order visible.
 */
export const FX_OFFSET_MS = {
  /** The closing segment is the cause; it goes first, at zero. */
  closing: 0,
  loop: 40,
  captureFill: 220,
  captureFresh: 500,
  produced: 560,
  /** A cut's consequence trails the impact that caused it. */
  cut: 90,
  /** Losing ground reads as the other half of the winner's capture. */
  lost: 260,
  converted: 300,
  /** After conversion; remnants held visible during the delay, then flicker. */
  vanish: 360,
} as const;

/** Per-cell delay as an effect walks outward from its spatial origin (ms). */
export const FX_STAGGER_MS = {
  loop: 22,
  captureFill: 26,
  cut: 38,
  produced: 90,
  lost: 26,
} as const;

/**
 * Ceiling on accumulated stagger. A 200-tile capture must not animate for five
 * seconds just because it is large — past this point the far cells all land
 * together and the effect still reads as "outward from the closure".
 */
export const FX_STAGGER_CAP_MS = 260;

/**
 * Budget for the longest chain in the game (enclosure → capture → production).
 *
 * A tuning target, **not** a bound anything may wait on: the chain it names
 * actually settles at 1200 ms, because `captureFresh` starts at 500 and runs 700.
 * See the note at the top of this file.
 */
export const MAJOR_SEQUENCE_MS = 700;

const TIERS: Readonly<Record<string, FxTier>> = {
  loopPulse: 1,
  captureFill: 1,
  captureFresh: 1,
  lossRetract: 1,
  evaporate: 1,
  cutSnap: 1,
  combat: 1,
  divergence: 2,
  convergence: 2,
  sentry: 2,
  emergence: 2,
  conversion: 2,
  seatVanish: 1,
  trailLaid: 3,
  advance: 3,
  refusal: 3,
  turnHandover: 3,
};

/** Visual weight of one overlay kind. Unknown kinds are routine, never major. */
export const tierOf = (kind: string): FxTier => TIERS[kind] ?? 3;
