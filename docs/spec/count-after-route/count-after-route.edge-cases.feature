# language: en
# Overview: docs/spec/count-after-route/count-after-route.md
# SPEC §3 merge, §5 sentries, §6.2 combat, §7 closure (all read)

Feature: Counting a route at the boundaries
  As a player whose run ends in a merge, a closure or a fight
  I want the count offered to be exactly the one the engine will accept
  So that no control offers a number that would be refused

  Background:
    Given a GameState, a GeometryPort, a RulesPort, and route input
    And the active player owns a stack S1 on arrow a0
    And every offer is measured by walking rules.apply on a scratch state

  Rule: The floor tracks the distance the run actually covers

    Scenario Outline: The floor at each run length
      Given the active player has clicked a0 with 16 heads
      When the active player clicks the ray arrow <steps> steps along slot 0
      Then the least offerable count is the least count rules.apply accepts for <steps> steps

      Examples:
        | steps |
        | 1     |
        | 2     |
        | 3     |
        | 4     |
        | 5     |

    Scenario: A one-step run floors at one head
      Given the active player has clicked a0 with 8 heads
      When the active player clicks the ray arrow one step along slot 0
      Then the least offerable count is 1

    Scenario: A truncated ray's floor is read from the run it actually offers
      Given the third arrow along slot 0 holds an enemy stack
      And the active player has clicked a0 with 16 heads
      When the active player clicks the second arrow along slot 0
      Then the least offerable count is the one for a two step run

    Scenario: A turn arrow's floor counts the turn as a step
      Given the active player has clicked a0 with 16 heads
      When the active player clicks the turn arrow off the second ray arrow of slot 0
      Then the least offerable count is the one for a three step run

  Rule: A terminal run still gets its count, and nothing more

    Scenario: A run ending in a merge offers a count and no extension
      Given the second arrow along slot 0 holds another of the active player's stacks
      And the active player has clicked a0 with 8 heads
      When the active player clicks that arrow
      Then a count control is rendered
      And the clickable set from the tip is empty

    Scenario: A merge does not auto-apply even though the tip is finished
      Given the second arrow along slot 0 holds another of the active player's stacks
      And the active player has clicked a0 with 8 heads
      When the active player clicks that arrow
      Then nothing has been applied to the game state

    Scenario: A run ending in a closure offers a count
      Given walking two steps along slot 0 completes a closure
      And the active player has clicked a0 with 8 heads
      When the active player clicks the arrow that closes
      Then a count control is rendered
      And the clickable set from the tip is empty

    Scenario: An attack run offers only counts that leave a head behind
      Given the first arrow along slot 0 holds an enemy stack
      And the active player has clicked a0 with 8 heads
      When the active player clicks that enemy arrow
      Then no offerable count exceeds 7
      And the least offerable count is 1

    Scenario: A lone head is never offered an attack
      Given the active player owns a stack of 1 head on arrow c0
      And the first arrow along slot 0 from c0 holds an enemy stack
      When the active player clicks c0
      Then that enemy arrow is not in the clickable set

    Scenario: A one-head stack facing only an enemy reports blocked
      Given the active player owns a stack of 1 head on arrow c0 whose every exit holds an enemy stack
      When the active player clicks c0
      Then the phase is blocked
      And the click is refused with reason no-exit

  Rule: Rewriting the last run re-measures everything downstream of it

    Scenario: Lowering the last run's count lowers the heads at the tip
      Given the active player has drafted a run of one step carrying 8
      When the count of the last run is set to 3
      Then the tip head count is 3

    Scenario: Lowering the last run's count shortens what the tip offers
      Given the active player has drafted a run of one step carrying 8
      When the count of the last run is set to 2
      Then the clickable set is the one 2 heads offer from the tip

    Scenario: Raising the last run's count lengthens what the tip offers
      Given the active player has drafted a run of one step carrying 8
      And the count of the last run is set to 2
      When the count of the last run is set to 8
      Then the clickable set is the one 8 heads offer from the tip

    Scenario: Lowering the last run's count leaves a sentry at its start
      Given the active player has clicked a0 with 12 heads
      And has clicked the ray arrow one step along slot 0
      When the count of the last run is set to 8
      And the active player sends
      Then 4 heads remain on a0 after the host applies the moves

    Scenario: Two runs at two counts leave two sentries
      Given the active player has clicked a0 with 12 heads
      And has clicked the ray arrow one step along slot 0
      And the count of the last run is set to 8
      And has clicked the ray arrow one step along slot 0 from the tip
      When the count of the last run is set to 4
      And the active player sends
      Then 4 heads remain on a0
      And 4 heads remain on the first walked arrow

    Scenario: A merge raises the ceiling on the next run, not on this one
      Given the active player has clicked a0 with 8 heads
      When the active player clicks an adjacent arrow holding 3 of the player's own heads
      Then no offerable count exceeds 8

    Scenario: Combat lowers the ceiling on the next run
      Given the active player has clicked a0 with 8 heads
      And has clicked an adjacent arrow holding an enemy stack with a count of 7
      When the tip head count is read
      Then it is the surviving count of the attackers that landed

  Rule: Popping composes with the count without leaking state

    Scenario: Popping restores the earlier run as the last run
      Given a stack of 16 heads has drafted a run of two steps carrying 16
      And has drafted a second run of two steps at the largest count that walks it
      When the active player pops to the second walked arrow
      Then the last run is the first run
      And the offerable counts are the ones for that run

    Scenario: Popping then rewriting edits the restored run
      Given a stack of 16 heads has drafted a run of two steps carrying 16
      And has drafted a second run of two steps at the largest count that walks it
      When the active player pops to the second walked arrow
      And the count of the last run is set to 6
      Then the draft holds two step moves
      And both carry a count of 6

    Scenario: Popping to the source empties the draft and hides the control
      Given the active player has drafted a run of two steps
      When the active player clicks a0
      Then the draft is empty
      And the phase is route
      And no count control is rendered

    Scenario: Popping twice returns to an empty draft
      Given the active player has drafted two runs totalling four step moves
      When the active player pops to the second walked arrow
      And pops to the source
      Then the draft is empty
      And the run boundaries are empty

    Scenario: Extending after a pop starts the new run at full strength
      Given the active player has drafted two runs totalling four step moves
      And has popped to the second walked arrow
      When the active player clicks a ray arrow one step from the tip
      Then the new run carries the heads standing on that tip

  Rule: The auto-apply test is exact at its boundaries

    Scenario: Two legal counts defeat auto-apply even with a finished tip
      Given the active player owns a stack of 3 heads on arrow e0
      And the active player has clicked e0
      When the active player clicks the ray arrow two steps along slot 0
      Then the offerable counts are 2 and 3
      And a count control is rendered
      And nothing has been applied to the game state

    Scenario: A count that is not forced defeats auto-apply
      Given the active player has clicked a0 with 4 heads
      When the active player clicks the ray arrow two steps along slot 0
      Then more than one count is offerable
      And a count control is rendered

    Scenario: An unreachable auto-apply state is not asserted
      Given a one run draft whose count is forced
      Then its clickable set is empty
      And no scenario claims otherwise

    Scenario: A forced count on a second run defeats auto-apply
      Given the active player has drafted a run of one step
      When a further run whose count is forced and whose tip is finished is clicked
      Then a count control is rendered
      And nothing has been applied to the game state

    Scenario: An auto-applied move leaves no route phase behind
      Given the active player owns a stack of 1 head on arrow c0
      And the active player has clicked c0
      When the active player clicks an adjacent arrow along slot 0
      Then the phase is idle
      And no arrow carries route paint

  Rule: The rest of the app is undisturbed

    Scenario: Ending the turn discards an open draft
      Given the active player has drafted a run of two steps
      When the active player requests an end of turn
      Then pending holds an end turn
      And the draft is discarded

    Scenario: Match over drops the count control
      Given the match is over
      Then no count control is rendered

    Scenario: A locked board drops the count control
      Given input is locked
      Then no count control is rendered

    Scenario: The refused wash still paints
      Given the active player has clicked a0
      And a grain-adjacent exit of a0 is a refused self-convert under P28
      Then that exit is in the refused wash

  Rule: Purity, determinism and cost

    Scenario: Equal inputs produce an equal offer
      Given two equal states, tips, drafts and last run lengths
      Then the offers are equal
      And the paints are equal
      And the auto-apply verdicts are equal

    Scenario: The offer is built once per change, not per hover
      Given the active player has drafted a run of one step
      When the pointer hovers six different clickable arrows in turn
      Then the offer is built no more than once

    Scenario: The offer's cost does not scale with the head count
      Given two boards identical but for the heads on the source
      And both head counts allow the same number of steps
      Then building the clickable set calls rules.apply the same number of times

    Scenario: No clock and no randomness
      Then route.ts references neither a clock nor a random source

    Scenario: The run boundaries always account for every drafted move
      Given any sequence of clicks, pops and count changes
      Then the run boundaries sum to the number of drafted moves
      And they are empty exactly when the draft is empty

    Scenario: Popping into the middle of a run truncates that run
      Given the active player has drafted a run of three steps
      When the active player pops to the arrow its first move walks to
      Then the last run holds 1 move
      And the offerable counts are the ones for a one step run
