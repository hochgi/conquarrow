/**
 * The lesson catalogue (P43) — L0..L7, in teaching order.
 *
 * Content is data. Every opening is a legal move script folded onto
 * `makeMatch(config)`; every golden answer is replayed by the validator, so a
 * future rules packet cannot silently rot a lesson (the P22/P42 failure mode).
 *
 * Openings were found by folding `makeMatch` + `rules.apply` on the real tiling
 * (home stacks are the sorted-first border of each home pinwheel; speed(3) = 2).
 * L0–L2 stay on `DEFAULT_MATCH_CONFIG`. L3–L6 use `homeOffset: 2` so opposite
 * homes sit close enough for a compact script. L7 only retunes `dominationN`.
 */

import { DEFAULT_MATCH_CONFIG, endTurn, mintArrowId, step } from '@conquarrow/contracts';
import type { ArrowId, MatchConfig } from '@conquarrow/contracts';
import { renderCopy } from './copy';
import type { Lesson, LessonId } from './types';

const arrow = (id: string): ArrowId => mintArrowId(id);

const PRACTICE_NEAR: MatchConfig = { ...DEFAULT_MATCH_CONFIG, homeOffset: 2 };
const PRACTICE_STARVE: MatchConfig = { ...DEFAULT_MATCH_CONFIG, dominationN: 2 };

const L0: Lesson = {
  id: 'L0',
  title: 'The grain',
  config: DEFAULT_MATCH_CONFIG,
  opening: [],
  steps: [
    {
      kind: 'narrate',
      text: 'Your stack sits on a home pinwheel. Movement always follows the grain — each arrow points to the next.',
      focus: [arrow('tiling:a:0,5,0')],
    },
    {
      kind: 'narrate',
      text: 'Three heads walk two steps this turn: speed is 1 + ⌊log₂ heads⌋, so a pair already matches two singles.',
    },
    {
      kind: 'expect',
      title: 'Walk one hop along the grain',
      action: {
        kind: 'route',
        from: arrow('tiling:a:0,5,0'),
        exits: [arrow('tiling:a:1,5,1')],
      },
      coach: 'Select that stack and send it along the lit grain — one arrow, then Send.',
    },
    {
      kind: 'end',
      summary: 'Stacks walk only along the grain. Speed grows with stack size; a pair already takes two steps.',
    },
  ],
};

const L1: Lesson = {
  id: 'L1',
  title: 'Trail & exposure',
  config: DEFAULT_MATCH_CONFIG,
  opening: [],
  steps: [
    {
      kind: 'narrate',
      text: 'Stepping off your territory lays trail. Trail is exposed: an enemy crossing a trail point cuts it.',
    },
    {
      kind: 'expect',
      title: 'Step off territory and lay trail',
      action: {
        kind: 'route',
        from: arrow('tiling:a:0,5,0'),
        exits: [arrow('tiling:a:1,5,0')],
      },
      coach: 'Send the stack onto the open arrow — leaving home is how trail starts.',
    },
    {
      kind: 'narrate',
      text: 'Heads you do not carry stay as a sentry. Skip and End Turn are ordinary moves; exposure is the cost of walking out.',
    },
    {
      kind: 'end',
      summary: 'Leaving territory lays trail. A sentry is heads you chose to leave; Skip and End Turn are normal.',
    },
  ],
};

const L2: Lesson = {
  id: 'L2',
  title: 'Closure',
  config: DEFAULT_MATCH_CONFIG,
  opening: [
    step(arrow('tiling:a:0,5,0'), arrow('tiling:a:1,5,2'), 2),
    step(arrow('tiling:a:1,5,2'), arrow('tiling:a:1,4,1'), 1),
    endTurn(),
    endTurn(),
  ],
  steps: [
    {
      kind: 'narrate',
      text: 'Depart your territory and land back on it: that is closure. The path becomes yours, and so does anything it rings.',
    },
    {
      kind: 'expect',
      title: 'Land back on your territory',
      action: {
        kind: 'route',
        from: arrow('tiling:a:1,4,1'),
        exits: [arrow('tiling:a:0,5,0')],
      },
      coach: 'Send the tip onto your home pinwheel — landing closes the walk.',
    },
    {
      kind: 'narrate',
      text: 'A strip that rings nothing is a land bridge: thin territory along the path. A pinwheel of 3 arrows is the smallest claim that takes a whole spawner.',
    },
    {
      kind: 'end',
      summary: 'Closure is departing and landing on your own territory. A land bridge claims the path; a pinwheel of 3 claims a whole spawner.',
    },
  ],
};

const L3: Lesson = {
  id: 'L3',
  title: 'Cuts & firebreaks',
  config: PRACTICE_NEAR,
  opening: [
    endTurn(),
    step(arrow('tiling:a:2,-1,2'), arrow('tiling:a:2,-2,1'), 3),
    step(arrow('tiling:a:2,-2,1'), arrow('tiling:a:1,-1,0'), 3),
    endTurn(),
    step(arrow('tiling:a:0,2,0'), arrow('tiling:a:1,2,0'), 3),
    step(arrow('tiling:a:1,2,0'), arrow('tiling:a:2,2,2'), 3),
    endTurn(),
    endTurn(),
    step(arrow('tiling:a:2,2,2'), arrow('tiling:a:2,1,2'), 3),
    step(arrow('tiling:a:2,1,2'), arrow('tiling:a:2,0,2'), 3),
    endTurn(),
    endTurn(),
  ],
  steps: [
    {
      kind: 'narrate',
      text: 'The enemy has walked out and left trail. Crossing a trail point cuts it; evaporation runs both ways from the cut until a firebreak.',
    },
    {
      kind: 'objective',
      goal: 'cutEnemyTrail',
      golden: [step(arrow('tiling:a:2,0,2'), arrow('tiling:a:2,-1,2'), 3)],
      hint: 'Step through the enemy trail — any hop that crosses it evaporates a region.',
    },
    {
      kind: 'narrate',
      text: 'Any head halts a front. The second head a front meets is the firebreak; sentry spacing is how big a region you lose.',
    },
    {
      kind: 'end',
      summary: 'A cut crosses an enemy trail point. Evaporation runs both ways; any head is a firebreak, and the region between firebreaks is what you lose.',
    },
  ],
};

const L4: Lesson = {
  id: 'L4',
  title: 'Contact combat',
  config: PRACTICE_NEAR,
  opening: [
    endTurn(),
    step(arrow('tiling:a:2,-1,2'), arrow('tiling:a:2,-2,1'), 1),
    endTurn(),
    step(arrow('tiling:a:0,2,0'), arrow('tiling:a:1,2,0'), 3),
    step(arrow('tiling:a:1,2,0'), arrow('tiling:a:2,2,2'), 3),
    endTurn(),
    endTurn(),
    step(arrow('tiling:a:2,2,2'), arrow('tiling:a:2,1,2'), 3),
    step(arrow('tiling:a:2,1,2'), arrow('tiling:a:2,0,2'), 3),
    endTurn(),
    endTurn(),
  ],
  steps: [
    {
      kind: 'narrate',
      text: 'Attack is a step onto an enemy-held arrow. A lone head cannot attack; the stack must leave a stay-behind head on the source.',
    },
    {
      kind: 'expect',
      title: 'Attack the adjacent stack, leaving one head behind',
      action: {
        kind: 'route',
        from: arrow('tiling:a:2,0,2'),
        exits: [arrow('tiling:a:2,-1,2')],
        carryAllow: [2],
      },
      coach: 'Send two heads onto the enemy stack — the third stays as the stay-behind. Equals favour the attacker.',
    },
    {
      kind: 'narrate',
      text: 'The fight resolves in the step under the threat-weighted floor rule. Equals favour the attacker; the attack costs one step of allowance.',
    },
    {
      kind: 'end',
      summary: 'Contact combat is a step onto an enemy stack. Stay-behind is required; equals favour the attacker; the fight is over in that step.',
    },
  ],
};

const L5: Lesson = {
  id: 'L5',
  title: 'Encirclement & conversion',
  config: PRACTICE_NEAR,
  opening: [
    endTurn(),
    step(arrow('tiling:a:2,-1,2'), arrow('tiling:a:2,-2,0'), 3),
    step(arrow('tiling:a:2,-2,0'), arrow('tiling:a:3,-2,0'), 3),
    endTurn(),
    endTurn(),
    step(arrow('tiling:a:3,-2,0'), arrow('tiling:a:4,-2,1'), 3),
    step(arrow('tiling:a:4,-2,1'), arrow('tiling:a:3,-1,1'), 3),
    endTurn(),
    endTurn(),
    step(arrow('tiling:a:3,-1,1'), arrow('tiling:a:2,0,1'), 3),
    step(arrow('tiling:a:2,0,1'), arrow('tiling:a:1,1,1'), 3),
    endTurn(),
    endTurn(),
    step(arrow('tiling:a:1,1,1'), arrow('tiling:a:0,2,1'), 3),
    step(arrow('tiling:a:0,2,1'), arrow('tiling:a:-1,3,0'), 3),
    endTurn(),
    step(arrow('tiling:a:0,2,0'), arrow('tiling:a:1,2,0'), 3),
    step(arrow('tiling:a:1,2,0'), arrow('tiling:a:2,2,1'), 3),
    endTurn(),
    endTurn(),
    step(arrow('tiling:a:2,2,1'), arrow('tiling:a:1,3,1'), 3),
    step(arrow('tiling:a:1,3,1'), arrow('tiling:a:0,4,2'), 3),
    endTurn(),
  ],
  steps: [
    {
      kind: 'narrate',
      text: 'A raider standing on open ground inside a claim, with only a stack-grade trail home, converts intact when you close.',
    },
    {
      kind: 'demo',
      label: 'The raider steps into the pocket',
      moves: [step(arrow('tiling:a:-1,3,0'), arrow('tiling:a:0,3,0'), 3), endTurn()],
    },
    {
      kind: 'objective',
      goal: 'convertedEnemyStack',
      golden: [step(arrow('tiling:a:0,4,2'), arrow('tiling:a:0,3,2'), 3)],
      hint: 'Land on your pinwheel to close. The stack inside the claim flips owner and stays on that arrow.',
    },
    {
      kind: 'end',
      summary: 'Closing ground under an enemy stack converts it intact. Territory-grade anchors resist; a raider with only a stack-grade link does not.',
    },
  ],
};

const L6: Lesson = {
  id: 'L6',
  title: 'Spawners & the economy',
  config: PRACTICE_NEAR,
  opening: [
    step(arrow('tiling:a:0,2,0'), arrow('tiling:a:1,2,2'), 2),
    step(arrow('tiling:a:1,2,2'), arrow('tiling:a:1,1,1'), 1),
    endTurn(),
    endTurn(),
  ],
  steps: [
    {
      kind: 'narrate',
      text: `${renderCopy('girth', PRACTICE_NEAR)} Spawners sit on vertices and are owned in thirds by the bordering arrows.`,
    },
    {
      kind: 'objective',
      goal: 'capturedShare',
      golden: [step(arrow('tiling:a:1,1,1'), arrow('tiling:a:0,2,0'), 1)],
      hint: 'Land on your home pinwheel. The walk claims the bordering arrows of the adjacent spawner.',
    },
    {
      kind: 'narrate',
      text: 'Each share banks an accumulator remainder; capture resets it. A parked enemy on a share is a blockade and halts that share’s accrual.',
    },
    {
      kind: 'end',
      summary: 'A spawner is owned in three shares. A pinwheel of 3 takes the whole vertex. Accumulators bank remainders and reset on capture.',
    },
  ],
};

const L7: Lesson = {
  id: 'L7',
  title: 'Winning & losing',
  config: PRACTICE_STARVE,
  opening: [],
  steps: [
    {
      kind: 'narrate',
      text: `Four loss cases, read off territory, shares and heads. Hold no territory and the seat is lost. Hold territory but no share and no heads, same. Hold heads but no share and the starvation clock runs: ${renderCopy('starvation-rounds', PRACTICE_STARVE)}`,
    },
    {
      kind: 'narrate',
      text: `Fleeing past the cutoff radius R = ${String(PRACTICE_STARVE.R)} holds no share by itself, so that clock starts without a chase. A won match accepts no further move.`,
    },
    {
      kind: 'end',
      summary: 'Loss is four cases over territory, shares and heads. Starvation counts rounds with zero shares; fleeing past R starts that clock; the last seat not lost wins.',
    },
  ],
};

/** The eight shipped lessons, in order. */
export const LESSONS: readonly Lesson[] = [L0, L1, L2, L3, L4, L5, L6, L7];

export const lessonById = (id: LessonId): Lesson | undefined =>
  LESSONS.find((lesson) => lesson.id === id);
