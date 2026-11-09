# Playtest 2026-11-08: human vs the post-P91 heuristic

The human played seat A against two heuristic seats (B and C), after P91.
The config matches [2026-11-04](../playtest-2026-11-04/FINDINGS.md) and
[2026-11-07](../playtest-2026-11-07/FINDINGS.md): 3 players, R 7,
`homeOffset` 5, spawner seed 1. The seat does not: those games the human was
C. Log: [`match-log.json`](./match-log.json), 714 moves. Started
2026-11-08T20:48:11Z. The numbers come from replaying it through `rules.apply`.

## Result: the human won at round 39

Land is owned arrows. Income is heads per round.

| round | **A (human)** heads / land / income | B | C |
|---:|---|---|---|
| 5 | **3 / 11 / 0.94** | 3 / 3 / 0.33 | 3 / 14 / 0.83 |
| 10 | **3 / 34 / 2.67** | 3 / 15 / 1.03 | 3 / 14 / 0.83 |
| 15 | **3 / 48 / 3.69** | 3 / 28 / 2.06 | 3 / 29 / 2.33 |
| 20 | **7 / 74 / 7.81** | 5 / 33 / 3.50 | 3 / 40 / 2.67 |
| 25 | **17 / 85 / 8.42** | 8 / 46 / 4.39 | 7 / 49 / 3.22 |
| 30 | **28 / 129 / 11.75** | 10 / 44 / 4.06 | 0 / 34 / 1.56 |
| 35 | **56 / 192 / 16.58** | 6 / 30 / 1.50 | 2 / 20 / 0.67 |
| 39 | **84 / 305 / 19.75, wins** | out at r38 | out on the last move |

- **Turns whose land grew:** A 22 (308 arrows, mean 14.0), B 8 (47, mean 5.9),
  C 6 (46, mean 7.7). The log summary's 61 closes count steps, not turns.
- **Passes with a step legal:** 0. On 2026-11-02 it was A 12 and B 1.
- **Legal cuts the bots declined:** 0 of 6. Each time a step onto an enemy
  trail was legal, the turn took one.
- The log's 19 cuts are almost all the human's. One bot step cost the human
  a head (move 608, a trade of 1).

## 1. The loop of doom did not recur

No seat spent a turn walking only arrows already in its own trail. No plan
repeated. No stack ended five turns on the same arrows. No seat sat on
unchanged land for eight of its turns.

What the bots did instead is the gate P91 added. A sortie grows every turn,
then closes:

- B's trail reaches 8 and closes at round 5 (land 3 → 15), reaches 10 and
  closes at round 12 (15 → 28), reaches 7 and closes at round 17 (28 → 35).
- C closes at round 5 (3 → 14), round 11 (14 → 29) and round 18 (29 → 38).

The flat land between those closes is the sortie being built. Trail size
goes up every turn of it. That is not the ring. On 11-06 and 11-07 the trail
size did not change for twenty rounds.

They do not close too soon against the human. The sorties run about five or
six turns, which is P85's cap once the trail is actually growing, and then
they drive home. The mirror shortening (median 104 → 71) did not show up
here as a panic close. The game lasted 39 rounds, against 42 on 11-04.

## 2. No turn was skipped while a step was legal

The only passes are seats with no heads, so no step exists:

| moves | seat | rounds | heads / land | why |
|---|---|---|---|---|
| 412, 436, 463, 493, 530 | C | 30–34 | 0 / 34 down to 0 / 20 | wiped; nothing to move |
| 708 | B | 38 | 0 / 0 | already out |

C had 7 heads at round 25 and none by round 30. Move 306 (`0,0,0 → 1,0,0`
×4) costs C 3 heads and 5 land; the rest of the heads are gone before C's
round-30 turn. For the next four round boundaries no head is born. One
border of a 1/9 spawner has A's ×1 standing on C's land, so that arrow does
not accrue. The other owned borders are empty, and their forces are 1/9 and
1/12, so a low accumulator does not birth in four rounds. A head appears at
the boundary after move 530. C is back to 2 heads at round 35 and dies on
move 713.

Those five passes are the only legal move. They are not the bot declining a
step. Land falls 34 → 20 during them because A is taking it and C cannot
answer. The miss is the wipe, which is the income and closing gap below, not
a new skip.

A stack left unmoved is not a skipped turn either. From round 23 to 34, B
leaves a ×1 on its home arrow `-4,5,1` while a step onto neutral is legal.
Other stacks move every one of those turns. A lone head stepping out is not
clearly the better play, and it is one head, not the turn.

## 3. Income is still the gap, and they still close rarely

Same shape as [2026-11-04](../playtest-2026-11-04/FINDINGS.md), with the
seat caveat (the human was C then, A now, and A starts on the richer home).

At round 20 the human's income is 7.81 against 3.50 and 2.67 (about 2.2×
the stronger bot; 11-04 was 4.92 against 2.33, about 2.1×). At round 30 it
is 11.75 against 4.06 and 1.56. Land at round 20 is 74 against 33 and 40,
about 1.9× the stronger bot (11-04 was 84 against 49, about 1.7×).

They close the opening sortie, which they did not do while the loop had
them, and then they stop. 8 and 6 closing turns in 39 rounds, against the
human's 22. On 11-04 it was 10 and 9 against 38. The means are in the same
range (bots 6–8 arrows, human 14).

The long human trails (up to 19 arrows, around moves 570 and 651) are not
cut. That is not a declined cut: a cut was legal on 6 bot turns, and all 6
were taken. The trails survived because no bot step reached them. That is
the old horizon, not a skip.
