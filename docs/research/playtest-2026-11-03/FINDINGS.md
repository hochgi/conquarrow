# Playtest 2026-11-03: human vs the post-P84 heuristic

The human played seat C against **two** heuristic seats (A and B) after P84,
which stopped the seat from passing while a step is legal. The config was the
same as [2026-11-02](../playtest-2026-11-02/FINDINGS.md): 3 players, R 7,
`homeOffset` 5, spawner seed 1. Log: [`match-log.json`](./match-log.json).

## Result: the human won at round 38, again an easy win

The numbers come from replaying the log through `rules.apply`. Land is the
count of owned arrows. Income is heads per round.

| round | A heads / land / income | B heads / land / income | **C (human)** heads / land / income |
|---:|---|---|---|
| 5 | 3 / 8 / 0.58 | 3 / 7 / 0.58 | **3 / 3 / 0.25** |
| 10 | 3 / 11 / 0.83 | 3 / 12 / 0.75 | **3 / 37 / 1.92** |
| 15 | 3 / 21 / 1.61 | 3 / 16 / 0.92 | **3 / 79 / 5.36** |
| 20 | 4 / 24 / 1.94 | 5 / 21 / 1.03 | **10 / 113 / 6.69** |
| 30 | 4 / 33 / 2.36 | 4 / 29 / 1.92 | **20 / 176 / 11.42** |
| end | out by r38 | out at r38 | **44 / 356 / 20.17** |

- **Closes:** C 28, B 14, A 11. The log summary has 53 closes and 9 cuts in total.
- **Passes with a legal step:** A 0, B 0, C 0. On 2026-11-02 it was A 12
  and B 1. **P84 holds in real play.**

Compared with 2026-11-02 (human won at r42; land at r20 A 11, B 26, C 66),
the bots no longer stall, but they are no closer to the human.

## What it says

1. **The bots' closes are small.** The human averaged about 13 arrows of land
   per close (356 from 28). A and B averaged 2–3. Most of their closes are
   land bridges and tiny loops.
2. **The bots do not punish a long trail.** In the human's words: at several
   points the human was on a long trail that the bot could have cut within two
   turns, while the human needed three to close. The bot never moved toward it,
   because it cannot cut it *this* turn.
3. **The human's diagnosis is that both come from one cause: the heuristic
   looks only one turn ahead.**
   - The `cut` mission switches on only when a cut is legal this turn
     (`cutAvailable`, `botMission.ts`).
   - The threat model is one enemy reply (P55, `botReply.ts`). P59's
     threatened-kite gate penalises any trail an enemy can cut next turn.
     So the seat keeps every trail short, even when no enemy can arrive for
     several rounds.
4. **The opening has room.** On this board, every seat's stack starts 16
   grain steps from any rival's land, and land is 14 from land. That holds
   for both the 2- and 3-player boards at R 7, `homeOffset` 5, seed 1. A
   pair or a 3-stack moves 2 a turn, so a rival needs about 7–8 turns to
   arrive. A first close that takes 3–4 rounds is safe, and it pays for the
   whole game.

These are packeted as [P85](../../design/packets/P85-heuristic-tempo-horizon.md).
