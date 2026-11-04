# Playtest 2026-11-04: human vs the post-P85 heuristic

The human played seat C against **two** heuristic seats (A and B) after P85,
which gave the seat race arithmetic: bigger sorties inside a safe window, and
an intercept mission. The config was the same as
[2026-11-03](../playtest-2026-11-03/FINDINGS.md): 3 players, R 7,
`homeOffset` 5, spawner seed 1. Log: [`match-log.json`](./match-log.json).

## Result: the human won at round 42, but it was a fight

The numbers come from replaying the log through `rules.apply`. Land is the
count of owned arrows. Income is heads per round.

| round | A heads / land / income | B heads / land / income | **C (human)** heads / land / income |
|---:|---|---|---|
| 5 | 3 / 6 / 0.42 | 3 / 3 / 0.33 | **3 / 3 / 0.25** |
| 10 | 3 / 27 / 1.33 | 3 / 15 / 1.03 | **3 / 51 / 1.92** |
| 15 | 3 / 39 / 1.75 | 3 / 15 / 1.03 | **3 / 82 / 4.58** |
| 20 | 4 / 49 / 2.33 | 6 / 24 / 1.83 | **6 / 84 / 4.92** |
| 25 | 4 / 59 / 2.56 | 4 / 44 / 2.92 | **11 / 101 / 8.25** |
| 30 | 3 / 59 / 2.56 | 2 / 41 / 2.58 | **26 / 136 / 10.92** |
| 40 | 1 / 23 / 0.83 | out | **72 / 340 / 19.25** |
| end | out at r42 | out | **wins at r42** (787 moves) |

- **Closes:** C 38 (mean 12.3 arrows), B 10 (mean 4.9), A 9 (mean 7.0).
  On 2026-11-03 the bots averaged 2–3 arrows per close.
- **Heads converted:** C took 23, B took 11 (from C). A took none.

The human's verdict: still an easy win, but much better than before. The
bots' moves made sense some of the time, and they fought back.

## What it says

1. **P85 worked where it aimed.** At r20 the bots held 49 and 24 land against
   24 and 21 the day before, and the human held 84 against 113. The human's
   lead at r20 fell from about 5× to 1.7× over the stronger bot.
2. **Income is now the gap, not land.** At r20 the human's income was 4.92
   against 2.33 and 1.83, and by r30 10.92 against 2.56. The bots stay at
   3–6 heads through r30; the human snowballs from r25. This matches P85's
   missed mirror gate: the credit buys land, not spawner shares.
3. **The bots close rarely.** 9–10 closes in 42 rounds against the human's
   38. The human keeps closing small and often between big closes; the bots
   do neither once their opening sortie lands.
4. **A rules conflict surfaced (human, 2026-11-04).** A raider whose trail
   still reaches its own land was **converted** when the human's close
   claimed the arrow under it (move #345: A ×1 on `tiling:a:2,2,2`, a
   3-arrow close). A raider already standing on the human's land was **not
   converted** by a close around it (move #329: B ×2 on `tiling:a:-1,1,2`)
   until the human cut its trail (#331). The cause is the P13 closure trail
   strip running before the §6.3 grade check. §6.3 says a trail-connected
   raider is never captured by claim alone; the human decided that **§6.3
   wins**. Packeted with the SPEC conflict audit as
   [P86](../../design/packets/P86-spec-conflict-resolution.md).
