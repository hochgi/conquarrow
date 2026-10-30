# language: en
# Overview: docs/spec/ray-run-input/ray-run-input.md
# SPEC §4 turn structure (read), §3 allowance (read), §5 sentries (read)

Feature: Draft a route from straight runs, then send it
  As a player moving a stack that can walk several steps
  I want to name every arrow of the route myself, one straight run at a time
  So that the trail I lay is the trail I chose, not one the adapter picked

  Background:
    Given a GameState, a GeometryPort, a RulesPort, and route input
    And the active player owns a stack S1 on arrow a0 with enough heads to walk four steps
    And nothing is selected

  Rule: Selecting a stack opens the route phase with an empty draft

    Scenario: Clicking an own stack enters the route phase
      When the active player clicks a0
      Then the phase is route
      And the draft is empty
      And the tip is a0
      And no move has been applied to the game state

    Scenario: The carry defaults to every head on the source
      When the active player clicks a0
      Then the carry equals the head count of S1
      And the tip head count equals the head count of S1

    Scenario: A stack with nothing clickable reports blocked
      Given the active player owns stack S2 on arrow b0 whose every exit is refused by the engine
      When the active player clicks b0
      Then the phase is blocked
      And the click is refused with reason no-exit

    Scenario: Clicking an arrow that is not the active player's refuses
      When the active player clicks an arrow holding an enemy stack
      Then the click is refused with reason not-yours
      And the phase is idle

  Rule: The three rays are the primary offer

    Scenario: Three rays are offered from the tip
      When the active player clicks a0
      Then the clickable set contains a ray arrow for each of the three slots

    Scenario: A ray follows one slot repeatedly
      When the active player clicks a0
      Then the ray for slot 0 lists, in order, the arrows reached by taking slot 0 from each previous arrow

    Scenario: Every ray arrow is clickable
      When the active player clicks a0
      Then each arrow of each ray is in the clickable set with kind ray

    Scenario: A turn arrow is offered off every ray arrow
      When the active player clicks a0
      Then for each ray arrow the two arrows reached by its other two slots are in the clickable set with kind turn

    Scenario: Nine arrows are clickable at each distance of two or more
      Given no ray is truncated within four steps of a0
      When the active player clicks a0
      Then the clickable set holds exactly nine arrows at distance two
      And exactly nine arrows at distance three
      And exactly nine arrows at distance four

    Scenario: Every arrow within two steps is clickable
      Given no ray is truncated within two steps of a0
      When the active player clicks a0
      Then every arrow reachable from a0 within two steps is in the clickable set

  Rule: A click appends a run to the draft

    Scenario: Clicking a ray arrow appends that whole run
      Given the active player has clicked a0
      When the active player clicks the ray arrow three steps along slot 0
      Then the draft holds three step moves
      And those moves walk slot 0 from a0, in order
      And the tip is that ray arrow
      And no move has been applied to the game state

    Scenario: Clicking a turn arrow appends the run and the turn
      Given the active player has clicked a0
      When the active player clicks the turn arrow off the second ray arrow of slot 0
      Then the draft holds three step moves
      And the first two walk slot 0
      And the third walks the turn slot

    Scenario: A second click extends from the new tip
      Given the active player has clicked a0
      And has clicked the ray arrow two steps along slot 0
      When the active player clicks the ray arrow two steps along slot 1 from the tip
      Then the draft holds four step moves
      And the tip is the last of them

    Scenario: A straight route of any length is one click
      Given the active player has clicked a0
      When the active player clicks the ray arrow four steps along slot 0
      Then the draft holds four step moves
      And the draft was built by exactly one click

    Scenario: A dogleg route is two clicks
      Given the active player has clicked a0
      When the active player clicks the ray arrow two steps along slot 0
      And clicks the ray arrow two steps along slot 1 from the tip
      Then the draft holds four step moves
      And the draft was built by exactly two clicks

    # P35 inverted the order: the run drafts at the largest count that walks it,
    # and the count is chosen after the click. The invariant under test — one
    # count for every move of a run — is unchanged.
    Scenario: One count travels with every move of the run
      Given the active player has clicked a0 with 8 heads
      When the active player clicks the ray arrow three steps along slot 0
      Then every move in the draft carries the same count

  Rule: Nothing is applied until Send

    Scenario: Send emits the draft as pending
      Given the active player has drafted a three step route
      When the active player sends
      Then pending holds exactly the draft's three moves, in draft order
      And the phase is idle

    Scenario: Cancel applies nothing
      Given the active player has drafted a three step route
      When the active player cancels
      Then pending is empty
      And the phase is idle
      And the game state is unchanged

    Scenario: A background click discards the draft
      Given the active player has drafted a two step route
      When the active player clicks the background
      Then pending is empty
      And the phase is idle

    Scenario: The game state is untouched while drafting
      Given the active player has drafted a four step route
      Then the game state equals the state before the stack was selected

  Rule: Clicking a walked arrow pops the draft back to it

    Scenario: Popping truncates the draft
      Given the active player has drafted a four step route
      When the active player clicks the arrow the draft's second move walks to
      Then the draft holds two step moves
      And the tip is that arrow

    Scenario: Popping keeps every move before the clicked arrow
      Given the active player has drafted a four step route
      When the active player clicks the arrow the draft's second move walks to
      Then the draft's remaining moves are the first two, unchanged and in order

    Scenario: Popping repaints the rays from the restored tip
      Given the active player has drafted a four step route
      When the active player clicks the arrow the draft's second move walks to
      Then the clickable set is the one built from that arrow as tip

    Scenario: Popping to the source leaves an empty draft, still in route
      Given the active player has drafted a two step route
      When the active player clicks a0
      Then the draft is empty
      And the phase is route
      And the tip is a0

    @superseded-P77 # clicking the selected stack re-selects it; deselect is background, Escape, Cancel or the lap's none step
    Scenario: Clicking the source with an empty draft deselects
      Given the active player has clicked a0
      And the draft is empty
      When the active player clicks a0
      Then the phase is idle

  # Rule superseded by P35 — the count is chosen *after* the click, and edits the
  # run just drafted. The live rules are in
  # docs/spec/count-after-route/count-after-route.{md,core.feature}. Kept here,
  # rewritten to the P35 gesture order, because the underlying behaviours (the
  # offer tracks the count, only movable counts are offered, uncarried heads are
  # a sentry) are still the contract.
  Rule: The count is chosen after the click and repaints the rays

    Scenario: Lowering the count shortens what the tip offers
      Given the active player has clicked a0 with 8 heads
      And has clicked the ray arrow one step along slot 0
      When the count of the last run is set to 4
      Then each ray from the tip holds fewer arrows than it held at a count of 8

    Scenario: Raising the count lengthens what the tip offers
      Given the active player has clicked a0 with 8 heads
      And has clicked the ray arrow one step along slot 0
      And the count of the last run is set to 4
      When the count of the last run is set to 8
      Then each ray from the tip holds more arrows than it held at a count of 4

    Scenario: Only counts that walk the run are offerable
      Given the active player has clicked a0
      And has clicked a ray arrow
      Then every offerable count walks every step of the last run
      And no offerable count is refused by the engine for any step of it

    Scenario: Heads not carried stay behind as a sentry
      Given the active player has clicked a0 with 12 heads
      When the active player clicks the ray arrow two steps along slot 0
      And the count of the last run is set to 8
      And sends
      Then the moves carry a count of 8
      And 4 heads remain on a0 after the host applies them

    Scenario: A new run defaults its count to the heads standing at its start
      Given the active player has clicked a0 with 12 heads
      And has clicked the ray arrow one step along slot 0
      And the count of the last run is set to 8
      When the active player clicks the ray arrow one step along slot 0 from the tip
      Then the new run's count equals 8
      And the tip head count equals 8

  Rule: Paint reads draft loudest, rays primary, reach faintest

    Scenario: The three tiers are disjoint
      Given the active player has drafted a two step route
      Then no arrow appears in more than one of draft, ray, turn and reach wash

    Scenario: The draft is painted as walked
      Given the active player has drafted a three step route
      Then every arrow the draft walks is in the draft paint, in order

    Scenario: Turn arrows are subordinate to their rays
      Given the active player has clicked a0
      Then ray arrows and turn arrows are reported as separate sets

    Scenario: The reach wash carries what is reachable but not clickable
      Given the active player has clicked a0
      Then the reach wash holds every arrow the carry can reach that is not clickable, not drafted, and not the tip

    Scenario: Hovering a clickable arrow previews what it would offer
      Given the active player has clicked a0
      And the pointer is fine
      When the pointer hovers the ray arrow two steps along slot 0
      Then the hover preview is the clickable set that arrow would offer as tip

    Scenario: The route phase hint names extend, go back, and send
      Given the active player has drafted a two step route
      Then the hint reads "Click to extend · click a walked arrow to go back · Send when ready"

    Scenario: A tip with nothing clickable says the run can go no further
      Given the active player has drafted a route that has spent every step of allowance
      Then the clickable set from the tip is empty
      And the hint reads "This run can go no further · click a walked arrow to go back · Send when ready"

    Scenario: The empty draft hint names the ray and the free turn
      Given the active player has clicked a0
      And the draft is empty
      Then the hint reads "Click along a ray to walk straight · one turn at the end is free"
