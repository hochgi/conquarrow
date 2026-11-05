# language: en
# Overview: docs/spec/heuristic-tempo-horizon/heuristic-tempo-horizon.md
# Adapter only — the live heuristic seat's tempo horizon, not a game rule

Feature: The live heuristic seat counts the race
  As the local heuristic seat
  I want to know how many turns I have before an enemy reaches my trail, and how many I need to reach theirs
  So that I take large closes when the board gives me time, and punish a long enemy trail I can reach in time

  Background:
    Given the generated tiling behind GeometryPort and the pure RulesPort
    And chooseTurnBeam from botSearch, the live seat's search, reached through playBotTurn
    And the readings of botTempo with TEMPO_TURN_CAP 8, SORTIE_TURN_CAP 3, SORTIE_TOTAL_CAP 5 and SORTIE_CREDIT 1/2

  Rule: A won intercept race makes the seat march, even with no cut legal

    Scenario: The six intercept fixtures pass as a set at the predeclared floor
      Given the intercept fixtures, each replayed from makeMatch of its log's config through its move index:
        | id | log                 | index | seat | enemy | mine | theirs |
        | I1 | playtest-2026-11-02 | 193   | A    | C     | 2    | 2      |
        | I2 | playtest-2026-11-02 | 249   | B    | C     | 1    | 1      |
        | I3 | playtest-2026-11-03 | 102   | B    | C     | 2    | 2      |
        | I4 | playtest-2026-11-03 | 134   | A    | C     | 5    | 5      |
        | I5 | playtest-2026-11-03 | 154   | A    | C     | 3    | 3      |
        | I6 | mirror-p85-s1       | 153   | A    | B     | 2    | 2      |
      And at each, it is <seat>'s turn and no step of <seat> cuts <enemy>'s trail this turn
      And at each, interceptOf for <seat> names <enemy> with turns <mine> and enemyTurns <theirs>
      When playBotTurn plays <seat>'s turn at each fixture
      Then at a fixture that passes, <enemy>'s trail is smaller after the turn, or interceptDistance for <seat> (by the origin's interceptOf) is strictly smaller after the turn than before
      And at least 5 of the 6 fixtures pass
      And every played turn is legal in sequence from its position

  Rule: A wide safe window lets the seat reach for a larger close

    # P88: S15 (playtest-2026-11-03 @330) dropped — that log diverges at move 265 under the P86 rulings, so the position is unreachable.
    Scenario: The 36 sortie fixtures pass as a set at the predeclared floor
      Given the sortie fixtures, each replayed from makeMatch of its log's config through its move index (the turn the logged seat landed):
        | id  | log                 | index | seat | loot |
        | S1  | playtest-2026-11-02 | 12    | A    | 2    |
        | S2  | playtest-2026-11-02 | 43    | A    | 3    |
        | S3  | playtest-2026-11-02 | 69    | B    | 3    |
        | S4  | playtest-2026-11-02 | 87    | B    | 2    |
        | S5  | playtest-2026-11-02 | 130   | B    | 2    |
        | S6  | playtest-2026-11-02 | 168   | A    | 3    |
        | S7  | playtest-2026-11-02 | 259   | A    | 1    |
        | S8  | playtest-2026-11-02 | 367   | A    | 2    |
        | S9  | playtest-2026-11-03 | 12    | A    | 2    |
        | S10 | playtest-2026-11-03 | 43    | A    | 3    |
        | S11 | playtest-2026-11-03 | 72    | B    | 3    |
        | S12 | playtest-2026-11-03 | 89    | A    | 3    |
        | S13 | playtest-2026-11-03 | 93    | B    | 2    |
        | S14 | playtest-2026-11-03 | 137   | B    | 2    |
        | S16 | mirror-p85-s1       | 8     | B    | 3    |
        | S17 | mirror-p85-s1       | 29    | B    | 3    |
        | S18 | mirror-p85-s1       | 33    | A    | 3    |
        | S19 | mirror-p85-s1       | 54    | A    | 3    |
        | S20 | mirror-p85-s1       | 57    | B    | 3    |
        | S21 | mirror-p85-s1       | 64    | B    | 1    |
        | S22 | mirror-p85-s1       | 68    | A    | 2    |
        | S23 | mirror-p85-s1       | 75    | A    | 1    |
        | S24 | mirror-p85-s1       | 91    | B    | 1    |
        | S25 | mirror-p85-s2       | 10    | B    | 2    |
        | S26 | mirror-p85-s2       | 28    | A    | 3    |
        | S27 | mirror-p85-s2       | 32    | B    | 3    |
        | S28 | mirror-p85-s2       | 46    | B    | 3    |
        | S29 | mirror-p85-s2       | 50    | A    | 2    |
        | S30 | mirror-p85-s2       | 109   | A    | 2    |
        | S31 | mirror-p85-s2       | 120   | A    | 2    |
        | S32 | mirror-p85-s2       | 135   | A    | 2    |
        | S33 | mirror-p85-s3       | 27    | A    | 3    |
        | S34 | mirror-p85-s3       | 43    | B    | 3    |
        | S35 | mirror-p85-s3       | 105   | A    | 1    |
        | S36 | mirror-p85-s3       | 134   | B    | 1    |
        | S37 | mirror-p85-s3       | 158   | B    | 1    |
      When chooseTurnBeam plans <seat>'s turn at each fixture and the plan is applied
      Then a fixture reaches for a larger close when the land <seat> gains this turn is greater than <loot>, or sortieOf at the plan's terminal has more than <loot> arrows
      And at least 30 of the 36 fixtures reach for a larger close
      And every plan is a legal sequence that ends <seat>'s turn or the match

    Scenario: The opening position starts a close larger than a land bridge
      Given the committed fixture "playtest-2026-11-03" replayed through move 0, seat A to move
      And no enemy group can reach, within 4 of its own turns, any arrow seat A's groups can step onto this turn
      When chooseTurnBeam plans seat A's turn and the plan is applied
      Then seat A's trail is open at the plan's terminal
      And sortieOf at the terminal has more than 3 arrows
      And sortieCredit at the terminal is greater than 0

  Rule: A real threat still keeps the sortie short

    Scenario: A terminal whose window is no wider than its turns to land earns no credit
      Given a terminal where seat Bot has an open trail with turns to land L
      And some enemy group can reach an arrow of Bot's projected sortie within L of its own turns
      When sortieCredit reads that terminal
      Then the credit is 0

  Rule: The seat never passes while a step is legal (P84 stands)

    Scenario: P84's playtest positions still take a step
      Given the committed fixture "playtest-2026-11-02" at P84's 13 positions
      When playBotTurn plays each turn
      Then every played turn contains at least one step

  Rule: Determinism

    Scenario: The same position twice gives the same plan
      Given any intercept fixture or sortie fixture position
      When chooseTurnBeam plans the turn twice
      Then the two plans are equal move for move
