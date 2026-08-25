# language: en
# Overview: docs/spec/tutorial/tutorial.md
# Packet P43 — adapter feature over SPEC §4–§9 (read-only)

Feature: Tutorial boundaries, recovery and honesty
  As a new player who will click the wrong thing
  I want the tutorial to stay honest about legality and recover cleanly
  So that what I learn in a lesson is true of the real game

  Background:
    Given the real tiling, a RulesPort, and the tutorial module
    And a lesson session is active with player A as the single human seat

  Rule: A rail coaches without ever faking legality

    Scenario: An off-rail but legal click gets the coach line only
      Given an L0 expect step allowing one straight run north from a0
      When player A drafts a legal run east from a0 instead
      Then the coach line is presented
      And no refusal reason is raised
      And the draft is not committed

    Scenario: An engine-illegal click keeps its ordinary refusal beneath the coach
      Given an L0 expect step near an arrow whose exit the engine refuses
      When player A clicks that refused exit
      Then the engine's refusal reason surfaces exactly as outside lessons
      And the coach line is presented in addition

    Scenario: A disallowed carry value refuses with its coach line
      Given an L4 expect step expecting an attack that leaves one head behind
      When player A sets the carry to every head on the tip
      Then the carry change is ignored by the rail
      And the coach line explains the stay-behind

    Scenario: The engine stays the sole authority on legality
      Given any active lesson step
      When player A performs an action illegal under the rules
      Then it is refused identically to a match outside lessons

  Rule: Objectives tolerate every route to the idea

    Scenario: An alternative legal solution also completes
      Given an L3 objective step whose goal is cutEnemyTrail
      And a second distinct crossing of the enemy trail exists
      When player A performs the second crossing
      Then the goal predicate holds and the session advances

    Scenario: An objective survives End Turn boundaries while unmet
      Given an L3 objective step still unmet
      When player A ends the turn repeatedly through full rounds
      Then the session remains on the objective step
      And spawner accrual proceeds normally between attempts

    Scenario: The hint ladder escalates nudge then highlight then show me
      Given an unmet objective step with a three-tier hint plan
      When player A makes three consecutive fruitless batches
      Then the first response is a nudge line
      And the second highlights candidate arrows
      And the third offers show me

  Rule: Practice boards are labelled and confined to setup data

    Scenario: A differing config labels the session practice board
      Given lesson L7 runs a config whose starvation rounds differ from default
      When the session renders its HUD
      Then the practice-board label is visible for the whole session

    Scenario: The default config shows no label
      Given lesson L0 runs DEFAULT_MATCH_CONFIG unchanged
      When the session renders its HUD
      Then no practice-board label appears

    Scenario: Config differences touch only setup data
      Given all shipped lessons
      When each config diffs against DEFAULT_MATCH_CONFIG
      Then every differing field is a §7 placement or tuning value
      And no rule branch could read any of them

  Rule: Restart, skip and leaving behave predictably

    Scenario: Restart refolds the opening exactly
      Given a mid-lesson session on L2 with board state changed
      When player A activates restart lesson
      Then the state equals the opening fold of L2 again
      And the session is on its first step

    Scenario: Skip advances without marking completion
      Given an incomplete L1 session
      When player A activates skip lesson
      Then the session moves to L2
      And completion for L1 is not persisted

    Scenario: Leaving mid-lesson discards the match
      Given a mid-lesson session on L5
      When player A returns to the Lobby
      Then the lesson match is discarded
      And no completion was recorded

    Scenario: Reset progress restores the pristine first-run state
      Given completions for L0 through L3 exist
      And the walkthrough card was dismissed long ago
      When player A activates reset progress
      Then every completion flag is cleared
      And the first-run card is visible again

  Rule: Failures fail loudly

    Scenario: A demo move refused at runtime halts visibly
      Given a future rules change makes one L3 demo move illegal
      When the demo step plays
      Then the session halts with a visible error naming the lesson and step
      And the remaining demo moves are not skipped silently

    Scenario: The validator fails loudly when authored boards rot
      Given a mutated fixture that invalidates one lesson's golden path
      When the validator suite runs
      Then it fails naming the lesson, the step, and the action that became illegal

  Rule: Copy teaches numbers the board can prove

    Scenario: Tunable copy follows the config
      Given lesson L7 quotes starvation rounds in its copy
      When the lesson config sets starvation rounds to two
      Then the rendered copy says two
      And when the config sets four the rendered copy says four

    Scenario: Structural constants may be literal
      Given lesson L6 quotes girth three and three shares
      When the copy renders under any config
      Then those constants render as written

  Rule: Lesson chrome never mimics hot-seat play

    Scenario: No passing gate exists during a lesson
      Given any point in any lesson
      When it becomes player B's turn inside a demo
      Then no seat handoff banner appears
      And player A's turn controls return without a gate

    Scenario: End Turn during rails is a decision like any other
      Given an L1 observe phase after its expect steps complete
      When player A ends the turn
      Then the batch commits normally
      And the next narrate step plays over the new board
