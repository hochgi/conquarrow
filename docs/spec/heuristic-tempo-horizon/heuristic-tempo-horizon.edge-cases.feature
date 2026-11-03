# language: en
# Overview: docs/spec/heuristic-tempo-horizon/heuristic-tempo-horizon.md
# Adapter only — the live heuristic seat's tempo horizon, not a game rule

Feature: Tempo-horizon edges — the race arithmetic, the caps, the threat test, and what stays unchanged
  As the local heuristic seat
  I want each tempo reading to count turns exactly and to stop at its caps
  So that a larger sortie is taken only when it is safe, a march is made only when it can win, and nothing outside the live seat moves

  Background:
    Given the generated tiling behind GeometryPort and the pure RulesPort
    And the readings of botTempo with TEMPO_TURN_CAP 8, SORTIE_TURN_CAP 3, SORTIE_TOTAL_CAP 5 and SORTIE_CREDIT 1/2

  Rule: The safe window counts each enemy group at its own speed, from its next turn

    Scenario: A lone enemy 1-stack three grain steps from the target has W 3
      Given a terminal where the only enemy group is a 1-stack whose shortest passable grain path to arrow X is 3 steps
      When safeWindow reads the set {X} with cap 8
      Then W is 3

    Scenario: A 3-stack at the same distance is faster, and a split never beats the stack
      Given the same terminal with that enemy group holding 3 heads instead
      When safeWindow reads the set {X} with cap 8
      Then W is 2, which is ceil(3 / speed(3))

    Scenario: A group already standing next to the target still needs one turn
      Given a terminal where an enemy group's shortest passable grain path to arrow X is 1 step
      When safeWindow reads the set {X} with cap 8
      Then W is 1

    Scenario: No enemy within the cap gives cap plus one
      Given a terminal where no enemy group has a passable grain path to arrow X within speed times 2 steps
      When safeWindow reads the set {X} with cap 2
      Then W is 3

    # On the generated tiling every grain walk between two arrows has the same length mod 3,
    # so a blocked 2-step path detours by 5, 8, … steps (phase 2 checked 3,270 pairs).
    Scenario: An enemy path may not cross my territory
      Given a terminal where the enemy's only grain path of 2 steps to arrow X crosses an arrow of my territory, and its shortest path that avoids my territory is 5 steps
      And the enemy group is a 1-stack
      When safeWindow reads the set {X} with cap 8
      Then W is 5

    Scenario: Every enemy seat counts in a 3-player game, the seat in between included
      Given a 3-seat terminal where seat B's nearest group is 4 turns from my projected sortie and seat C's is 2 turns
      When safeWindow reads my projected sortie
      Then W is 2

  Rule: The sortie credit is half the projected loot, only inside the caps and the window

    Scenario Outline: Credit is 0 outside a cap or the window
      Given a terminal where seat Bot has an open trail with turns to land <L>, elapsed <E>, and safe window <W> over its projected sortie
      When sortieCredit reads that terminal
      Then the credit is <credit>

      Examples:
        | L | E | W | credit                                   |
        | 2 | 2 | 5 | 1/2 × loot(shares, arrows) of the sortie |
        | 3 | 2 | 4 | 1/2 × loot(shares, arrows) of the sortie |
        | 4 | 1 | 9 | 0                                        |
        | 3 | 3 | 9 | 0                                        |
        | 2 | 2 | 2 | 0                                        |
        | 2 | 2 | 1 | 0                                        |

    Scenario: No open trail earns no credit
      Given a terminal where seat Bot has no trail
      When sortieCredit reads that terminal
      Then the credit is 0
      And sortieOf returns undefined

    Scenario: The projected sortie is the trail plus every tip's homeward path, minus my land
      Given a terminal where seat Bot has an open trail of 4 arrows and one tip 3 grain steps from its territory
      When sortieOf reads that terminal
      Then projected is the trail together with that tip's homewardPath path, sorted by arrow id
      And arrows counts the projected arrows that are not Bot's territory
      And shares counts those of them that flank a spawner vertex
      And turnsToLand is ceil(3 / speed of the tip)
      And elapsed is ceil(4 / speed of the tip)

  Rule: The intercept race counts my turns against the enemy's turns to close, to bare marks only

    Scenario: A tie goes to the seat on move
      Given an enemy trail whose tip needs 2 turns to close, and my nearest group needs 2 turns to reach a bare mark of it
      When interceptOf reads the turn's start state
      Then the race is won, with turns 2 and enemyTurns 2

    Scenario: One turn short is a lost race and no march
      Given the I1 position altered so that my nearest group needs 3 turns to reach any bare mark and the enemy needs 2 to close
      When interceptOf reads the turn's start state
      Then it returns undefined
      And the seat's missions do not include intercept

    Scenario: A trail arrow holding the enemy's heads is not a target
      Given an enemy trail of 3 arrows, one of which holds the enemy's tip
      When interceptOf reads the turn's start state
      Then its targets are the 2 bare marks only

    Scenario: An enemy with no tip on its trail cannot close, so there is no race against it
      Given an enemy trail with no group of that enemy on it
      When enemyTurnsToClose reads that enemy
      Then it is TEMPO_TURN_CAP + 1
      And interceptOf does not name that enemy

    Scenario: Two won races take the one I reach soonest, then the lower PlayerId
      Given a 3-seat start where I win the race against B in 3 turns and against C in 2 turns
      When interceptOf reads it
      Then it names C
      And if both took 2 turns it would name B

  Rule: Missions — intercept never displaces bank or cut

    Scenario: A legal cut keeps the cut mission and no intercept is added
      Given a start where a step of mine cuts enemy E's trail this turn and I also win a multi-turn race against E
      When missionsOf reads it
      Then the missions include cut and do not include intercept

    Scenario: Under fire, bank comes first and no intercept is added
      Given a start where my open trail has positive exposure and I win a race against an enemy
      When missionsOf reads it
      Then the missions include bank and do not include intercept

  Rule: P59's threatened-kite test reads the race, for the live seat

    Scenario: A kite with a wide window is no longer threatened
      Given the committed fixture "playtest-2026-11-02" replayed through move 20, seat A to move, with missions [contest]
      And the plan "6,0,1>5,1,1 ×1, 5,0,0>6,0,1 ×2, 6,0,1>5,1,1 ×1, endTurn" (arrow ids "tiling:a:<q>,<r>,<k>"), the plan P59's gate cut back to [endTurn] before P85
      And that plan is a kite (isKite true) whose terminal has turns to land 2 and W 6 over its projected trail
      When isThreatenedKite reads that plan under the live mission context
      Then it is false
      And under the pre-P85 test (any enemy group within 12 grain steps) it was true

    Scenario: A kite whose window is no wider than its turns to land stays threatened
      Given a kite plan whose W over its projected trail is at most its turns to land
      When isThreatenedKite reads that plan under the live mission context
      Then it is true

  Rule: What stays as it was

    Scenario: The nested search is unchanged
      Given any intercept fixture or sortie fixture position
      When chooseTurnBeamWithBudget plans it with withReplies false
      Then the plan equals the plan the pre-P85 code returns for that position (the fixture records it)

    Scenario: chooseMove is unchanged
      Given any intercept fixture or sortie fixture position
      When chooseMove picks the seat's move
      Then the move equals the pre-P85 move for that position (the fixture records it)

    Scenario: A seat with no legal step still passes
      Given it is seat Bot's turn and rules.legalMoves offers no step
      When chooseTurnBeam plans Bot's turn
      Then the plan is exactly [endTurn]
