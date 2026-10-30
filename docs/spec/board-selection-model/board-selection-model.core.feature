# language: en
# Overview: ./board-selection-model.md — P77, web adapter only. No game rule.

Feature: Board selection model
  As the human seat with more than one stack
  I want selection and destination to be different gestures, and every move sent explicitly
  So that no click can cost me a move I did not mean to make

  Background:
    Given a fixture board, a RulesPort and the hot-seat input mode
    And it is player A's turn
    And player A owns stack S1 of 2 heads on arrow a0 and stack S2 of 1 head on arrow b0
    And a0 and b0 are both movable

  Rule: A click on an own stack selects it, always

    Scenario: Clicking an own stack that the selected stack could reach selects it
      Given S2 is selected
      And b0's offer can reach a0, so a0 would be a merge for S2
      When the active player clicks a0
      Then the selected stack is a0
      And the draft is empty
      And no move is pending

    Scenario: Clicking an own stack with a draft open discards the draft and selects it
      Given S1 is selected and has drafted a one step run
      When the active player clicks b0
      Then the selected stack is b0
      And the draft is empty
      And nothing has been applied to the game state

    Scenario: A merge is drafted from the strip, not from the tile
      Given S2 is selected
      And a0 is a merge target of S2's offer
      When the active player presses Merge into a0
      Then the draft walks from b0 to a0
      And the selected stack is still b0
      And no move is pending until Send

  Rule: Every move is drafted and then sent

    Scenario: Clicking an empty legal arrow drafts and never applies
      Given S1 is selected
      When the active player clicks a ray arrow one step along slot 0
      Then the draft holds exactly one step move
      And no move is pending
      And nothing has been applied to the game state

    Scenario: A one step one count move still requires Send
      Given S2 is selected
      When the active player clicks the only arrow S2 can reach
      Then a count control is rendered with the single count 1
      And no move is pending
      When the active player sends
      Then pending holds exactly that one step move

  Rule: Next stack walks every movable stack, then none

    Scenario: Next stack visits every movable stack, then none, then wraps
      Given movable arrows m1, m2 and m3 in compareArrows order
      And nothing is selected
      When Next stack is pressed four times
      Then the selection has been m1, m2, m3, none, in that order
      When Next stack is pressed once more
      Then the selected stack is m1

    Scenario: With one movable stack, the lap is that stack and none
      Given exactly one movable arrow m1
      And m1 is selected
      When Next stack is pressed
      Then nothing is selected
      When Next stack is pressed
      Then the selected stack is m1

    Scenario: The selection line reports n of m and names the selected arrow
      Given movable arrows m1, m2 and m3 in compareArrows order
      And m2 holding 2 heads is selected
      Then the selection line reads "Selected: 2 on m2 · 2 of 3"

    Scenario: The selection line says so in words when nothing is selected
      Given movable arrows m1, m2 and m3
      And nothing is selected
      Then the selection line reads "No stack selected · 3 can move"

  Rule: Lit means legal, and every refused click says why

    Scenario: A grain neighbour that would self-convert is drawn refused, not lit
      Given S1 stands on stack-grade trail with no territory-grade anchor
      And a grain neighbour r1 of a0 is enemy territory
      When S1 is selected
      Then r1 is in the refused set
      And r1 is not a target, not a merge target and not a multi-run mark

    Scenario: Clicking a refused arrow prints a reason
      Given S1 is selected and r1 is a refused grain neighbour of a0
      When the active player clicks r1
      Then the click is refused with reason would-convert
      And the message line reads "No trail home — those heads would flip"

    Scenario: Clicking out of reach names the selected stack
      Given S2 is selected
      When the active player clicks an empty arrow S2 cannot reach this turn
      Then the click is refused with reason out-of-reach
      And the message line reads "Too far for the stack on b0"

  Rule: The count strip says what the count means

    Scenario: The leftover names the arrow it stands on
      Given S1 holding 3 heads is selected
      And the active player has drafted a one step run from a0
      When the count on the last leg is lowered to 2
      Then the leftover reads "1 head stays on a0"

  Rule: The layout and the turn flow are stated

    Scenario: Button positions are stable across a status line of 1 and 3 lines
      Given the HUD rendered with a one line hint
      And the HUD rendered with a three line hint, a refusal and a BYOK status
      Then the markup up to the end of the action row is identical in both

    Scenario: With a sentry parked and nothing else able to move, the turn stays open and says so
      Given player A's only other stack has spent its allowance
      And a parked sentry of 1 head can still step
      Then the turn is not passed
      And the message line reads "1 stack can still move · End turn when done"

    Scenario: With nothing able to move, the turn passes and the strip says so
      Given no stack of player A can step
      Then the turn status reads "Nothing can move · the turn passes by itself"
      And the hot-seat host applies endTurn
