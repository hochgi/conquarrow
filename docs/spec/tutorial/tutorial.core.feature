# language: en
# Overview: docs/spec/tutorial/tutorial.md
# Packet P43 — adapter feature over SPEC §4–§9 (read-only)

Feature: Learn conquarrow through scripted lessons on the real engine
  As a new player who cannot yet read the board
  I want short lessons that make me perform each mechanic myself
  So that the game's vocabulary and its deterministic rules become mine

  Background:
    Given the real tiling, a RulesPort, and the tutorial module
    And lesson L0 is the grain, whose opening is a move script folded onto makeMatch(config)
    And player A is the single human seat of a fixed two-seat plan

  Rule: The Lobby offers the tutorial without ever blocking play

    Scenario: The Learn entry starts lesson 1
      When player A activates the Learn entry beside Local and Online
      Then a lesson session for L0 starts
      And the seat plan is two seats with exactly one human
      And no seat handoff banner appears at any point afterwards

    Scenario: A first visit shows the dismissible walkthrough card
      Given no completion record exists in storage
      When the Lobby renders
      Then the walkthrough card is visible
      And activating it enters L0 directly

    Scenario: Dismissing the card persists across reloads
      Given no completion record exists in storage
      When player A dismisses the walkthrough card
      Then the card is not shown again on a later Lobby render

    Scenario: An existing player sees no first-run card
      Given completion record for L0 exists in storage
      When the Lobby renders
      Then the walkthrough card is not shown
      And the Learn entry remains available

  Rule: Narration points before it asks

    Scenario: A narrate step waits for Next
      Given the L0 session is on its opening narrate step
      Then the narration card is visible
      And no input reaches the board

    Scenario: Focus rings name what the text names
      Given a narrate step with focus on arrows f1 and f2
      When the step renders
      Then focus rings are painted on f1 and f2 and nothing else

    Scenario: Next advances and unpaints
      Given the L0 session is on a narrate step with focus rings
      When player A presses Next
      Then the card and rings are gone
      And the session is on the next step

  Rule: Demos play enemy agency through the ordinary commit path

    Scenario: A demo applies its moves as committed moves
      Given an L3 demo step whose moves have player B cutting player A's trail
      When the step plays
      Then each move is applied through the same commit path as a sent batch
      And the trail fire presents with the standard cut vocabulary

    Scenario: A demo paces itself and then advances
      Given any demo step
      When the step plays
      Then consecutive moves present at playback pacing
      And the session advances only after the last effect is presented

    Scenario: An enemy demo never yields control mid-sequence
      Given an L3 demo step playing player B's cut
      When the step plays
      Then no board input from player A is accepted until the step advances

  Rule: Rails narrow choice to the action being taught

    Scenario: Only the rail's source is selectable during an expect step
      Given an L0 expect step naming stack S1 on arrow a0
      And player A also owns stack S2 on arrow b0
      When the session paints highlights
      Then a0 is selectable and b0 is not

    Scenario: Clickable targets are filtered to the route shape
      Given an L0 expect step allowing one straight run north from a0
      When the session paints highlights
      Then only the arrows of that run are clickable
      And every other reachable arrow is not clickable

    Scenario: Completing the expected action commits and advances
      Given an L0 expect step expecting one straight run north from a0
      When player A drafts that run and sends it
      Then the batch applies like any sent route
      And the session advances to the next step

    Scenario: Cancel exits a rail cleanly and re-arms
      Given an L0 expect step with a partially drafted route
      When player A presses Escape
      Then the draft is discarded
      And the expect step is active again from its beginning

  Rule: Objectives hand over free play until judgement lands

    Scenario: Free play accepts any legal action
      Given an L3 objective step whose goal is cutEnemyTrail
      When player A selects any own stack or ends the turn
      Then the action commits without coaching

    Scenario: The golden solution completes the objective
      Given an L3 objective step whose goal is cutEnemyTrail
      When player A performs the lesson's golden crossing
      Then the goal predicate holds on the committed state
      And the session advances to the next step

    Scenario: Show me replays the golden answer as a demo
      Given an L3 objective step whose hints reach show me
      When player A activates show me
      Then the golden answer plays as a demo step
      And completing it advances the session

  Rule: Completion persists and progress is legible

    Scenario: Reaching end marks completion
      Given the L0 session is on its end step
      When the summary is dismissed
      Then completion for L0 is persisted
      And the session returns to the lesson list

    Scenario: Completion survives reload
      Given completion for L0 was persisted
      When the page reloads and the Lobby renders
      Then L0's progress dot is filled
      And the walkthrough card is not shown

    Scenario: Progress dots reflect the eight lessons
      Given completions for L0 and L1 exist
      When the lesson list renders
      Then L0 and L1 are filled, L2 is current, and L3 through L7 are locked

  Rule: Lessons are deterministic and self-validating

    Scenario: An opening equals the engine's fold of its script
      Given any shipped lesson
      When its opening state is computed headlessly
      Then it equals makeMatch(config) folded with its opening script via rules.apply

    Scenario: The golden path validates headlessly
      Given all shipped lessons
      When each golden path replays through the engine
      Then every expect action is legal when reached
      And every objective predicate fires at the golden answer
      And every lesson reaches its end step
