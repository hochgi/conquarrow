# language: en
# Overview: docs/spec/heuristic-never-idle/heuristic-never-idle.md
# Adapter only — the live heuristic seat's return seam, not a game rule

Feature: Never-idle edges — which stepping plan replaces a pass, the starved beam, the nested search, determinism
  As the local heuristic seat
  I want the replacement for a pass to respect the threatened-kite intent, to exist even when the beam starves, and to leave the enemy model alone
  So that never passing does not reopen the risks P59 guarded against, and replays stay exact

  Background:
    Given the generated tiling behind GeometryPort and the pure RulesPort
    And chooseTurnBeam and chooseTurnBeamWithBudget from botSearch

  Rule: Each cause the diagnosis found is covered

    Scenario: The IDLE_SLACK cause with many legal steps
      Given the P53 board "passWithManySteps": seat Bot holds three 1-stacks and has more than BRANCH legal steps
      And passing evaluates better than any stepped complete by more than IDLE_SLACK
      When chooseTurnBeam plans Bot's turn
      Then the plan contains at least one step
      And the plan is a legal sequence that ends Bot's turn

    Scenario: The kite-gate cause where a non-kite stepping complete exists
      Given the committed fixture "playtest-2026-11-02" replayed through move 53, seat A to move
      And seat A's only mission is contest and every contest complete in the live search is a threatened kite
      When chooseTurnBeam plans seat A's turn
      Then the plan contains at least one step
      And the plan is not a threatened kite

    Scenario: The kite-gate cause where every contest plan is a threatened kite and no staging close exists
      Given the P59 board "threatenedKiteNoStaging" variant "onlyKites"
      When chooseTurnBeam plans Bot's turn
      Then the plan contains at least one step
      And the plan is a legal sequence that ends Bot's turn

    Scenario Outline: A dominant seat with no staging walk steps instead of passing
      Given the committed fixture "mirror-s3" replayed from makeMatch of its config through move <index>
      And it is seat A's turn, seat A is dominant and has a legal step
      And stagingWalk returns no walk for seat A
      And the fixture's next logged move is a lone endTurn for seat A
      When chooseTurnBeam plans seat A's turn
      Then the plan contains at least one step
      And the plan is a legal sequence that ends seat A's turn

      Examples:
        | round | index |
        | 28    | 167   |
        | 29    | 172   |

  Rule: The starved beam falls back to chooseMove

    Scenario: The beam keeps no stepping complete
      Given a position where it is seat Bot's turn and a step is legal
      And chooseTurnBeamWithBudget runs the live search with withReplies true and maxApplies 0
      When it plans Bot's turn
      Then the first move of the plan equals chooseMove's move for that position
      And that move is a step
      And the plan is a legal sequence that ends Bot's turn

  Rule: The nested search keeps P53 and P59 as they were

    Scenario: The nested reply search may still pass with a step legal
      Given the P53 board "passIsBest"
      When chooseTurnBeamWithBudget plans Bot's turn with withReplies false
      Then the plan is exactly [endTurn]

    Scenario: A boxed enemy with no legal step still passes in the nested search
      Given the P55 board "boxedAfterOccupy" from the enemy E's hypothesised chair
      When chooseTurnBeamWithBudget plans E's turn with withReplies false
      Then the plan is exactly [endTurn]

  Rule: No game rule and no new constant

    Scenario: The tuning constants are unchanged
      Given the exported constants of botSearch
      Then IDLE_SLACK equals MOBILITY_SCALE
      And SORTIE_SLACK equals MOBILITY_SCALE
      And BEAM, BRANCH, MAX_PLAN and MAX_APPLIES keep their P81 values

    Scenario: The guard lives in its own module and botSearch only calls it
      Given the source of botSearch.ts and botNeverIdle.ts
      Then botNeverIdle.ts exports neverIdle
      And botSearch.ts imports neverIdle from botNeverIdle
      And neither module uses Date, Math.random or performance.now

  Rule: Determinism

    Scenario Outline: The same position gives the same plan twice
      Given the committed fixture "playtest-2026-11-02" replayed through move <index>
      When chooseTurnBeam plans the turn of the seat to move twice
      Then the two plans are identical move for move

      Examples:
        | index |
        | 53    |
        | 404   |
