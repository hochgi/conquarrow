# language: en
# Overview: ./board-selection-model.md — P77, web adapter only. No game rule.

Feature: Board selection model — edge cases
  As the human seat
  I want the selection model to hold at its boundaries and against the five 2026-10-29 incidents
  So that no sequence of clicks can both change selection and commit a move

  Background:
    Given a fixture board, a RulesPort and the hot-seat input mode
    And it is player A's turn

  Rule: The five playtest incidents cannot recur

    # Turn 2: the auto-selected sentry's only destination was the pair's tile.
    Scenario: Clicking the pair's tile while the sentry is selected selects the pair
      Given player A owns a sentry of 1 head on s0 and a pair of 2 heads on p0
      And p0 is the only arrow the sentry can reach, as a merge
      And the sentry is selected
      When the active player clicks p0
      Then the selected stack is p0
      And no move is pending
      And the game state is unchanged

    # Turns 16 and 32: a destination meant for the front was clicked with the sentry selected.
    Scenario: A destination out of the selected stack's reach is refused with the stack's name
      Given player A owns a sentry of 1 head on s0 and a front of 2 heads on f0
      And the sentry is selected
      When the active player clicks an arrow two steps from f0 and out of the sentry's reach
      Then the click is refused with reason out-of-reach
      And the message line reads "Too far for the stack on s0"
      And the selection line names s0

    # Turn 17: Next stack alternated between one stack and nothing, never the front.
    Scenario: Next stack reaches the front from the sentry
      Given player A owns a sentry on s0 and a front on f0, both movable, s0 before f0
      And the sentry is selected
      When Next stack is pressed
      Then the selected stack is f0

    # Turn 18: the turn opened with the sentry auto-selected and the front's next arrow lit.
    Scenario: The auto-selected stack is named before any click
      Given player A's turn has just begun with two movable stacks
      Then exactly one stack carries the selected marker
      And the selection line names that stack's arrow and reads "1 of 2" or "2 of 2"

    # Turn 37: a lit arrow was a self-convert step and the click did nothing at all.
    Scenario: No lit arrow is a step the engine refuses
      Given player A owns a stack with no trail home standing beside enemy territory
      When that stack is selected
      Then every target and every merge target is the last exit of a draft apply accepts
      And every refused grain neighbour carries the refused treatment instead

  Rule: Own-stack clicks select before any other reading

    Scenario: Clicking the selected stack with an empty draft keeps it selected
      Given S1 on a0 is selected and the draft is empty
      When the active player clicks a0
      Then the selected stack is a0
      And the phase is route

    Scenario: Clicking the selected stack with a draft clears the draft and keeps it selected
      Given S1 on a0 is selected and has drafted a two step route
      When the active player clicks a0
      Then the selected stack is a0
      And the draft is empty

    Scenario: Clicking an own stack that has no move left selects it as blocked
      Given player A owns a stack on z0 whose every exit the engine refuses
      When the active player clicks z0
      Then the phase is blocked on z0
      And the click is refused with reason no-exit
      And the message line reads "The stack on z0 has no move left this turn"

    Scenario: A click elsewhere while a blocked stack is selected says why
      Given the stack on z0 is selected and blocked
      When the active player clicks an empty arrow
      Then the click is refused with reason no-exit
      And the selected stack is still z0

    Scenario: A drafted tip that holds heads only in the scratch state is popped, not selected
      Given S1 on a0 is selected and has drafted a two step route to t2
      When the active player clicks the first walked arrow t1
      Then the draft walks to t1 only
      And the selected stack is still a0

    Scenario: Merge targets are not click targets
      Given S1 on a0 is selected
      And an own stack on b0 is reachable from a0 by one run
      Then b0 is in the merge set
      And b0 is not in the target set

    Scenario: Merge into an arrow that is not a merge target is refused
      Given S1 on a0 is selected
      When Merge into an arrow outside the merge set is requested
      Then the draft is unchanged
      And the request is refused with reason out-of-reach

  Rule: Nothing a click does applies a move

    Scenario: A two head two step run that spends the whole allowance still waits for Send
      Given S1 holds 2 heads on a0 and is selected
      When the active player clicks the ray arrow two steps along slot 0
      Then a count control is rendered
      And no move is pending

    Scenario: A power-of-two stack spending its whole allowance still waits for Send
      Given a stack of 8 heads on d0 is selected
      When the active player clicks the ray arrow four steps along slot 0
      Then a count control is rendered
      And no move is pending

    Scenario Outline: No click produces a pending move
      Given the phase is <phase>
      When the active player clicks <arrow>
      Then no move is pending

      Examples:
        | phase   | arrow                         |
        | idle    | an own stack                  |
        | idle    | an enemy stack                |
        | idle    | an empty arrow                |
        | route   | a target                      |
        | route   | a walked arrow                |
        | route   | an own stack                  |
        | route   | a refused grain neighbour     |
        | route   | a multi-run mark              |
        | blocked | an empty arrow                |

  Rule: Every refused click says why

    Scenario Outline: Each refusal carries its reason and one sentence
      Given the phase is <phase>
      When the active player clicks <arrow>
      Then the click is refused with reason <reason>
      And the message line reads "<text>"

      Examples:
        | phase | arrow              | reason           | text                                                                 |
        | idle  | an empty arrow     | nothing-selected | Nothing selected · click one of your stacks first                    |
        | idle  | an enemy stack     | not-yours        | Not your stack                                                       |
        | route | a multi-run mark   | not-one-run      | Reachable, but not in one run · click a lit arrow on the way first   |

    Scenario: A click on an arrow while input is locked is refused as board-busy
      Given input is locked because an AI seat is moving
      When the pointer is released on an arrow without dragging
      Then the pointer-up intent is a board-busy refusal on that arrow

    Scenario: A background click while input is locked says nothing
      Given input is locked
      When the pointer is released on the background without dragging
      Then the pointer-up intent is nothing

    Scenario: A refusal is cleared by the next click that does something
      Given the last click was refused
      When the active player clicks an own stack
      Then the message line shows the turn status again

  Rule: Refused is measured at the tip

    Scenario: After a run, refused names the tip's grain neighbours, not the source's
      Given S1 on a0 is selected and a0's grain neighbour r0 would self-convert
      And S1 drafts a run to a tip t1 whose grain neighbour r1 would self-convert
      Then r1 is in the refused set
      And r0 is not in the refused set unless it is also a grain neighbour of t1

  Rule: The lap is exact at its boundaries

    Scenario: With no movable stack, Next stack selects nothing
      Given no stack of player A is movable
      When Next stack is pressed
      Then nothing is selected
      And the selection line reads "No stack selected · nothing can move"

    Scenario: From a selected stack that is not movable, Next stack goes to the next movable arrow after it
      Given movable arrows m1 and m3, and a blocked stack on m2 between them in compareArrows order
      And m2 is selected
      When Next stack is pressed
      Then the selected stack is m3

    Scenario: Next stack with a draft open discards the draft
      Given S1 is selected and has drafted a one step run
      When Next stack is pressed
      Then nothing has been applied to the game state
      And the draft of the newly selected stack is empty

    Scenario: The lap ignores the order the movable list arrives in
      Given the movable arrows listed in two different orders
      Then nextStack yields the same sequence for both

    Scenario: A selected stack that is not movable is reported without a lap position
      Given the stack on z0 holding 1 head is selected and not movable
      And 2 stacks are movable
      Then the selection line reads "Selected: 1 on z0 · no move left · 2 can move"

  Rule: Pan, zoom and motion leave selection alone

    Scenario: Selection survives a board pan; a pan does not change selection
      Given S1 is selected
      When the pointer is dragged more than three pixels and released
      Then the pointer-up intent is nothing
      And the selected stack is still a0

    Scenario: Reduced motion: markers are static, no pulse
      Given the user prefers reduced motion
      Then the selected marker carries no animation
      And the reduced-motion stylesheet block switches off every selection animation

  Rule: The count strip and leftover wording hold for every run

    Scenario Outline: The leftover names where it stands, or says none stays
      Given the last run began on <start> with <ceiling> heads
      And its count is <count>
      Then the leftover reads "<text>"

      Examples:
        | start | ceiling | count | text                   |
        | a0    | 3       | 3     | No head stays behind   |
        | a0    | 3       | 2     | 1 head stays on a0     |
        | t2    | 8       | 4     | 4 heads stay on t2     |
