# language: en
# Overview: docs/spec/count-after-route/count-after-route.md
# SPEC §3 allowance (read), §5 sentries (read). No SPEC.md edit.

Feature: Name the route, then say how many heads walk it
  As a player moving a stack on a phone
  I want to be asked how many heads travel only after I have said where
  So that the question has a floor, and the answer never hides the offer

  Background:
    Given a GameState, a GeometryPort, a RulesPort, and route input
    And the active player owns a stack S1 on arrow a0 with enough heads to walk four steps
    And nothing is selected

  Rule: Nothing is asked before a route exists

    Scenario: Selecting a stack renders no count control
      When the active player clicks a0
      Then the phase is route
      And the draft is empty
      And no count control is rendered

    Scenario: The offerable counts are empty with an empty draft
      When the active player clicks a0
      Then the offerable counts are empty

    Scenario: The last run length is zero with an empty draft
      When the active player clicks a0
      Then the run boundaries are empty

    Scenario: The rays are measured at the tip's full head count
      Given S1 holds 8 heads
      When the active player clicks a0
      Then each ray holds the arrows a count of 8 can reach

    Scenario: An arrow is clickable when some count reaches it
      Given S1 holds 8 heads
      When the active player clicks a0
      Then the clickable set holds exactly the arrows some count of 8 or fewer reaches

    Scenario: An adjacent enemy arrow is clickable, armed by the count below full
      Given the first arrow along slot 0 holds an enemy stack
      And S1 holds 8 heads
      When the active player clicks a0
      Then that enemy arrow is in the clickable set
      And clicking it drafts a run carrying 7

  Rule: A click drafts the run at the largest count that walks it

    Scenario: A run carries every head when nothing refuses that count
      Given the active player has clicked a0 with 8 heads
      When the active player clicks the ray arrow two steps along slot 0
      Then every move in the draft carries a count of 8
      And the last run holds 2 moves

    Scenario: A second run carries every head that arrived
      Given the active player has clicked a0 with 12 heads
      And has clicked the ray arrow one step along slot 0
      And the count of the last run is set to 8
      When the active player clicks the ray arrow one step along slot 1 from the tip
      Then the second run carries a count of 8
      And the last run holds 1 move

    Scenario: The drafted run is the run that was painted
      Given the active player has clicked a0
      When the active player clicks the ray arrow three steps along slot 0
      Then the draft walks slot 0 from a0, in order
      And no move has been applied to the game state

  Rule: The count control edits the run just drafted

    Scenario: The control appears after the click, not before
      Given the active player has clicked a0 with 8 heads
      When the active player clicks the ray arrow one step along slot 0
      Then a count control is rendered
      And its offerable counts are the counts that walk that run

    Scenario: Lowering the count rewrites the last run
      Given the active player has clicked a0 with 8 heads
      And has clicked the ray arrow one step along slot 0
      When the count of the last run is set to 5
      Then every move of the last run carries a count of 5

    Scenario: Lowering the count leaves earlier runs untouched
      Given the active player has drafted a run of two steps carrying 8
      And has drafted a second run of one step carrying 8
      When the count of the last run is set to 4
      Then the first run's moves are byte-identical
      And the last run's move carries a count of 4

    Scenario: Rewriting re-emits exactly the last run
      Given a stack of 16 heads has drafted a run of two steps carrying 16
      And has drafted a second run of two steps at the largest count that walks it
      When the count of the last run is set to its floor
      Then the draft still holds four step moves
      And exactly the trailing two were re-emitted

    Scenario: A count below the floor is not offerable
      Given the active player has clicked a0 with 8 heads
      When the active player clicks the ray arrow three steps along slot 0
      Then no offerable count is below the least count that walks three steps

    Scenario: A count above the heads at the run's start is not offerable
      Given the active player has clicked a0 with 8 heads
      When the active player clicks the ray arrow one step along slot 0
      Then no offerable count exceeds 8

    Scenario: Setting a count that is not offerable is ignored
      Given the active player has drafted a run of three steps
      When a count below the floor is requested
      Then the draft is unchanged

    Scenario: The floor is measured by the engine, not derived from speed
      Given a rule change would refuse a count that speed alone would allow
      Then that count is not offerable

  Rule: A click with nothing left to decide applies the move

    @superseded-P77 # apply-on-click is retired: every move is drafted and sent (board-selection-model)
    Scenario: A two head stack walking two steps applies at once
      Given the active player owns a stack of 2 heads on arrow f0
      And the active player has clicked f0
      When the active player clicks the ray arrow two steps along slot 0
      Then the move is applied
      And no count control was rendered

    @superseded-P77 # apply-on-click is retired: every move is drafted and sent (board-selection-model)
    Scenario: A single head walks one step with no control at all
      Given the active player owns a stack of 1 head on arrow c0
      And the active player has clicked c0
      When the active player clicks an adjacent arrow along slot 0
      Then the move is applied
      And the phase is idle
      And no count control was rendered

    @superseded-P77 # apply-on-click is retired: every move is drafted and sent (board-selection-model)
    Scenario: A power-of-two stack spending its whole allowance applies at once
      Given the active player owns a stack of 8 heads on arrow d0
      And the active player has clicked d0
      When the active player clicks the ray arrow four steps along slot 0
      Then the move is applied
      And the phase is idle
      And no count control was rendered

    @superseded-P77 # apply-on-click is retired: every move is drafted and sent (board-selection-model)
    Scenario: An auto-applied click emits what Send would have emitted
      Given the active player owns a stack of 1 head on arrow c0
      And the active player has clicked c0
      When the active player clicks an adjacent arrow along slot 0
      Then pending holds exactly the moves a click followed by Send would hold

    Scenario Outline: A click that still has a decision left renders the control
      Given the active player has clicked a0 with <heads> heads
      When the active player clicks the ray arrow <steps> steps along slot 0
      Then a count control is rendered
      And nothing has been applied to the game state

      Examples:
        | heads | steps | why                                  |
        | 8     | 1     | eight legal counts remain            |
        | 2     | 1     | two legal counts remain              |
        | 8     | 2     | the tip can still be extended        |

    Scenario: A multi-run draft never auto-applies
      Given the active player has drafted a run of two steps
      When the active player clicks a further arrow whose count is forced and whose tip is finished
      Then a count control is rendered
      And nothing has been applied to the game state

  Rule: The control lives below the board, never on it

    Scenario: The strip is a sibling of the stage
      Given the active player has drafted a run of one step
      Then the count control is rendered outside the board stage

    Scenario Outline: The strip overlaps no clickable arrow
      Given the viewport is <width> pixels wide
      And the active player has drafted a run of one step
      Then the count control intersects no arrow in the clickable set

      Examples:
        | width |
        | 375   |
        | 768   |
        | 1280  |

    Scenario: The tip keeps its halo while the control is docked
      Given the active player has drafted a run of one step
      Then the tip arrow carries the selected halo

    Scenario: Changing the count repaints the rays live
      Given the active player has drafted a run of one step carrying 8
      When the count of the last run is set to 2
      Then the rays from the tip are the ones 2 heads can reach

  Rule: Send, cancel and pop are unchanged

    Scenario: Send emits every run in draft order
      Given the active player has drafted two runs totalling four step moves
      When the active player sends
      Then pending holds those four moves, in draft order
      And the phase is idle

    Scenario: Cancel applies nothing
      Given the active player has drafted a run of three steps
      When the active player cancels
      Then pending is empty
      And the game state is unchanged

    Scenario: Popping to a walked arrow restores that run's count control
      Given the active player has drafted two runs totalling four step moves
      When the active player clicks the arrow the draft's second move walks to
      Then the draft holds two step moves
      And the last run is the one ending at that arrow
