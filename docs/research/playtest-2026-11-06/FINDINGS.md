# Playtest 2026-11-06: human vs two heuristic seats, on a phone

The human played seat C against two heuristic seats (A and B) on a phone,
after P88 and P89. The config was the same as
[2026-11-04](../playtest-2026-11-04/FINDINGS.md): 3 players, R 7,
`homeOffset` 5, spawner seed 1. Two attempts, neither finished:

1. **The page froze at move 580** with the AI seat B to move (A 14 heads on
   screen). It stopped responding, so the log could not be downloaded.
2. **An accidental back swipe ended the second game.** Going forward again
   landed on the lobby, and the match was gone. The log here is the last
   periodic save before that: [`match-log.json`](./match-log.json), 583 moves,
   44 rounds.

## Result at the last save: the human leads clearly at round 44

The numbers come from replaying the log through `rules.apply`. Land is the
count of owned arrows. Income is heads per round.

| round | A heads / land / income | B heads / land / income | **C (human)** heads / land / income |
|---:|---|---|---|
| 5 | 3 / 3 / 0.33 | 3 / 3 / 0.33 | **3 / 3 / 0.25** |
| 10 | 3 / 18 / 0.92 | 2 / 3 / 0.33 | **2 / 11 / 0.58** |
| 15 | 3 / 27 / 1.33 | 2 / 3 / 0.33 | **2 / 13 / 0.75** |
| 20 | 4 / 29 / 1.42 | 3 / 17 / 0.83 | **2 / 23 / 1.75** |
| 25 | 4 / 30 / 1.42 | 3 / 19 / 1.00 | **3 / 35 / 2.28** |
| 30 | 4 / 30 / 1.42 | 3 / 22 / 1.33 | **4 / 44 / 3.78** |
| 35 | 5 / 30 / 1.42 | 2 / 25 / 1.56 | **8 / 64 / 5.89** |
| 40 | 10 / 30 / 1.42 | 2 / 14 / 0.83 | **15 / 101 / 7.97** |
| 44 | 15 / 52 / 2.72 | 1 / 10 / 0.33 | **33 / 169 / 15.56** |

The human and B fought each other; A led at r20 with nobody pressing it, and
then stood still for twenty rounds.

## Findings

### 1. The loop of doom: A's main stack walks a ring of its own trail for 27 rounds

From move 209 to move 529 (about rounds 17–43) A's ×4 stack spent **every
turn** on the same three steps: `4,0,2 → 4,-1,1 → 3,0,0 → 4,0,2`. All three
arrows are in A's own trail, at the tip of a 12-arrow sortie from its land.
The walk ends where it starts, re-walking its own trail changes nothing, and
no claim follows. A's land sat at 29–30 from r20 to r40 while its income
stayed at 1.42.

That the ring happens to end on its start arrow is incidental: a ×2 or ×3
stack has a different speed, would end each turn on a different arrow of the
ring, and would be just as stuck (the human, 2026-11-06). So "ends where it
started" is not the defect, and scoring it as a pass is not the fix.

The defect is the choice: the seat retraces its own trail instead of driving
the stack home to close a 12-arrow trail. The packet starts with a diagnosis
of why the beam never prefers that close. Candidates to test, not
conclusions:
- the close home scores worse than staying out (reply damage, a threatened
  kite, or the evaluation of the claim);
- the close home is longer than the beam's plan horizon, so no plan reaches
  it, and P84's never-idle seam then takes any legal step.

### 2. The phone froze at move 580, and slow turns do not explain it

The human left the frozen page for **several hours**, hoping to save the log.
The turn before took a few seconds. Slow turns cannot explain a turn that
never ends, so this is most likely a hang: a loop in the planner (or in the
page) that does not terminate on that position. That log is lost, so the
hang has no reproduction yet.

What is known:
- replaying the last saved position of the second game, one heuristic turn
  for seat A (`chooseTurnBeam`) took **6.5 s on a desktop Mac**; a phone is
  several times slower, and two bot seats move back to back;
- the planner runs on the page's main thread (no Web Worker), so while it
  runs the page cannot repaint, take input or download the log;
- the beam has an apply budget (`MAX_APPLIES`), but other parts of the turn
  (P84's never-idle fallback, the staging walk, the P85 missions) may not be
  bounded the same way.

Next steps: autosave (finding 3) keeps the log of the next freeze; a Web
Worker keeps the page usable during one; then reproduce from that log, and
add a hard bound to each turn.

### 3. A back swipe or a refresh loses a local game

The local game lives only in React state. Nothing saves it, nothing warns
before leaving, and the lobby cannot resume from a log. On a phone, an edge
swipe is a back navigation.

Fix, in order of value:
- autosave the match (config and moves) to browser storage after every move,
  and offer **Resume** in the lobby: this survives back, refresh, a crash and
  a frozen tab;
- catch the back gesture inside the page (a history entry for the game
  screen) and ask before leaving;
- a `beforeunload` prompt for refresh and tab close. Mobile browsers honour it
  unevenly, so it cannot be the only guard.

### 4. B stood still for the opening

B's land was 3 from r5 to r15, so for fifteen rounds it closed nothing. The
log does not say why; the replay can show it when the heuristic work starts.

### 5. Income is still the gap

The human out-earned both seats from r20 (1.75 against 1.42 and 0.83), and
by r44 earned 15.56 against 2.72. This repeats the 2026-11-04 finding; the
backlog item stands.
