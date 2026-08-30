# language: en
# Overview: docs/spec/ray-run-input/ray-run-input.md
# SPEC §3 merge, §5 sentries, §6.1 cuts, §6.2 combat, §6.3 conversion, §7 closure (all read)

Feature: Route drafting at the boundaries
  As a player drafting a route across contested ground
  I want a ray to stop exactly where the engine would stop me
  So that a click never buys a shorter or different run than the one I saw

  Background:
    Given a GameState, a GeometryPort, a RulesPort, and route input
    And the active player owns a stack S1 on arrow a0
    And every offer is measured by walking rules.apply on a scratch state

  Rule: A ray stops where the engine stops, and is never painted past it

    Scenario: A ray ends before an enemy-held arrow two or more steps out
      Given the third arrow along slot 0 holds an enemy stack
      And the carry equals the head count at the tip
      When the active player clicks a0
      Then the ray for slot 0 ends at the second arrow
      And that enemy arrow is not in the clickable set
      And no arrow beyond it is in the clickable set by way of slot 0

    # P35: no carry is set before the click — the offer walks at 8 and at 7, so
    # the arrow is offered and the drafted run carries 7.
    Scenario: An enemy-held arrow one step out is offered, with a sentry left behind
      Given the first arrow along slot 0 holds an enemy stack
      And S1 holds 8 heads
      When the clickable set is built
      Then that enemy arrow is in the clickable set
      And the run drafted to it carries 7

    # Superseded by P35: there is no carry before a click, and the offer walks the
    # run at `heads` and at `heads - 1`, so this arrow is offered rather than
    # withdrawn. See docs/spec/count-after-route/count-after-route.md.
    Scenario: An enemy-held arrow one step out is offered, armed one head short
      Given the first arrow along slot 0 holds an enemy stack
      And S1 holds 8 heads
      When the clickable set is built
      Then that enemy arrow is in the clickable set
      And clicking it drafts a run carrying 7

    # Retired by P35. With the attack armed before the click, the only states
    # left for `needs-stay-behind` were a terminal tip and a draft at MAX_DEPTH —
    # where no count makes the arrow clickable, so "an attack must leave a head
    # behind" would have been a lie. Those now fall through to out-of-reach.
    Scenario: An enemy-held arrow no count can attack refuses as out of reach
      Given an adjacent enemy-held arrow that no count can attack from this tip
      When the active player clicks that enemy arrow
      Then the click is refused with reason out-of-reach
      And the draft is unchanged

    Scenario: A ray stops at a merge, and the merge arrow is clickable
      Given the second arrow along slot 0 holds another of the active player's stacks
      When the active player clicks a0
      Then the ray for slot 0 ends at that arrow
      And that arrow is in the clickable set
      And clicking it drafts exactly two moves

    Scenario: A ray stops where a closure lands mid-path
      Given walking two steps along slot 0 completes a closure
      When the active player clicks a0
      Then the ray for slot 0 ends at the arrow that closes
      And no arrow beyond it is offered by way of slot 0
      And the engine accepts a further hop from that arrow, yet it is not offered

    Scenario: A ray stops at enemy territory without territory-grade protection
      Given the second arrow along slot 0 is enemy territory
      And the source carries no territory-grade anchor
      When the active player clicks a0
      Then the ray for slot 0 ends before that arrow

    Scenario: A ray stops at a refused self-convert exit
      Given the second arrow along slot 0 is a self-convert exit refused under P28
      When the active player clicks a0
      Then the ray for slot 0 ends before that arrow
      And that arrow is painted in the refused wash, not as a ray arrow

    Scenario: A ray stops when allowance runs out
      Given S1 holds 4 heads
      When the active player clicks a0
      Then each ray holds no more arrows than the engine will accept hops for

    Scenario: Clicking past a ray's stop refuses
      Given the third arrow along slot 0 holds an enemy stack
      When the active player clicks a0
      And clicks the fourth arrow along slot 0
      Then the click is refused with reason out-of-reach
      And the draft is unchanged

    Scenario: A truncated ray still offers its turn arrows
      Given the third arrow along slot 0 holds an enemy stack
      When the active player clicks a0
      Then turn arrows off the first and second arrows of slot 0 are still offered

    Scenario: A turn arrow the engine refuses is not offered
      Given the turn off the second arrow of slot 0 is refused by the engine
      When the active player clicks a0
      Then that arrow is not in the clickable set

    Scenario Outline: One ray truncates and the others do not
      Given the ray for slot <blocked> is truncated at one step
      When the active player clicks a0
      Then the ray for slot <blocked> holds one arrow
      And the other two rays are unaffected

      Examples:
        | blocked |
        | 0       |
        | 1       |
        | 2       |

  Rule: A terminal step ends the draft, because the board it changed is not on screen

    Scenario Outline: A terminal tip offers nothing further
      Given the active player has drafted a route whose last step <effect>
      When the clickable set is built from the tip
      Then it is empty
      And the draft may still be sent
      And the draft may still be popped

      Examples:
        | effect                                       |
        | merges into another of the player's stacks   |
        | completes a closure                          |
        | resolves combat against an enemy stack      |

    Scenario: A click from a terminal tip refuses
      Given the active player has drafted a route whose last step completes a closure
      When the active player clicks an arrow one step from the tip
      Then the click is refused with reason out-of-reach
      And the draft is unchanged

    Scenario: Sending from a terminal tip emits the whole draft
      Given the active player has drafted a two step route whose second step merges
      When the active player sends
      Then pending holds both moves, in draft order

    Scenario: Popping off a terminal tip restores a live tip
      Given the active player has drafted a two step route whose second step merges
      When the active player pops to the first walked arrow
      Then the clickable set from the tip is not empty

  Rule: The clickable set is exactly the unique-route set

    Scenario: An arrow needing two runs is not clickable
      Given no ray is truncated within four steps of a0
      When the active player clicks a0
      Then an arrow at distance three whose only routes are two-run words is not in the clickable set

    Scenario: Every clickable arrow has exactly one shortest route
      Given no ray is truncated within four steps of a0
      When the active player clicks a0
      Then every arrow in the clickable set is reached by exactly one shortest route from a0

    Scenario: Every unique-route arrow is clickable
      Given no ray is truncated within four steps of a0
      When the active player clicks a0
      Then every arrow reached by exactly one shortest route from a0 is in the clickable set

    Scenario: Clicking a reachable but ambiguous arrow refuses
      Given an arrow at distance four is reachable by three shortest routes
      When the active player clicks a0
      And clicks that arrow
      Then the click is refused with reason out-of-reach
      And the draft is empty

    Scenario: The ambiguous arrow becomes clickable after one run is drafted
      Given an arrow at distance four is reachable by three shortest routes
      When the active player clicks a0
      And clicks the ray arrow two steps along slot 0
      Then that arrow is in the clickable set if its remaining route is a single run

    Scenario: An arrow on both a ray and a turn keeps its shorter route
      Given an arrow is a turn arrow at distance three and a ray arrow at distance two
      When the active player clicks a0
      Then that arrow's clickable entry names the two step route

    Scenario: A ray that would revisit one of its own arrows stops
      Given a fixture board whose slot 0 walk returns to an earlier arrow of the same ray
      When the active player clicks a0
      Then the ray for slot 0 ends before the repeated arrow

    Scenario: A ray that would revisit a drafted arrow stops
      Given the active player has drafted a two step route
      When a ray from the tip would re-enter an arrow the draft already walks
      Then that ray ends before that arrow

  Rule: Popping and extending compose without leaking state

    Scenario: Extending after a pop uses the restored tip
      Given the active player has drafted a four step route
      And has popped back to the second walked arrow
      When the active player clicks a ray arrow two steps from the tip
      Then the draft holds four step moves
      And its first two moves are the ones that survived the pop

    Scenario: Popping twice returns to an empty draft
      Given the active player has drafted a four step route
      When the active player pops to the second walked arrow
      And pops to the source
      Then the draft is empty
      And the phase is route

    Scenario: Popping then cancelling applies nothing
      Given the active player has drafted a four step route
      When the active player pops to the second walked arrow
      And cancels
      Then pending is empty
      And the game state is unchanged

    Scenario: Popping restores the tip head count from the state after the shorter draft
      Given the active player has drafted a two step route whose second step merges into a stack of 3
      And the carry is 8
      Then the tip head count is 11
      When the active player pops to the first walked arrow
      Then the tip head count is 8

    # P35: the count belongs to a run, so a pop restores the count of the run it
    # lands in rather than carrying one value across the whole route.
    Scenario: A pop restores the count of the run it lands in
      Given the active player has drafted two runs at different counts
      When the active player pops to the boundary between them
      Then the count is the first run's count

  # P35: the count rewrites the *last run* and nothing earlier.
  Rule: The count rewrites the last run and nothing earlier

    Scenario: Lowering the count mid-route leaves earlier runs alone
      Given the active player has drafted a run of two steps and then a further run
      When the count of the last run is lowered
      Then the first run's moves still carry their original count

    Scenario: Lowering the count mid-route shortens only what is still offered
      Given the active player has drafted a run of two steps carrying 8
      When the count of the last run is set to 4
      Then the clickable set is the one 4 heads can reach from the tip

    Scenario: A count larger than the heads at the run's start is not offerable
      Given the active player has drafted a run that began on an arrow holding 4 heads
      Then no offerable count exceeds 4

    Scenario: A count of every head leaves no sentry
      Given the active player has clicked a0 with 8 heads
      When the active player clicks the ray arrow one step along slot 0
      And sends
      Then no heads remain on a0 after the host applies the moves

    Scenario: Splitting twice along one route leaves two sentries
      Given the active player has clicked a0 with 12 heads
      When the ray arrow one step along slot 0 is clicked and the count is set to 8
      And the ray arrow one step along slot 0 is clicked again and the count is set to 4
      And the active player sends
      Then 4 heads remain on a0
      And 4 heads remain on the first walked arrow

    Scenario: Combat on the first hop reduces the tip head count and ends the draft
      Given the active player has clicked a0 with 8 heads
      When the active player clicks an adjacent arrow holding an enemy stack
      Then the tip head count is the surviving count of the attackers that landed
      And the clickable set from the tip is empty

    # P35: the ceiling is the heads where the *run began*, so a merge raises the
    # tip's head count without raising the count offered for the run that merged.
    Scenario: A merge grows the tip head count above the run's count
      Given the active player has clicked a0 with 8 heads
      When the active player clicks an adjacent arrow holding 3 of the player's own heads
      Then the tip head count is 11
      And no offerable count exceeds 8

  Rule: Turn flow and the rest of the app are undisturbed

    Scenario: Ending the turn discards an open draft
      Given the active player has drafted a two step route
      When the active player requests an end of turn
      Then pending holds an end turn
      And the draft is discarded

    Scenario: A sent route reaches the host as one ordered batch
      Given the active player has drafted a four step route
      When the active player sends
      Then the host receives four step moves in draft order and applies them in that order

    Scenario: Match over drops the route chrome
      Given the match is over
      Then no ray, turn, draft or reach paint is produced

    Scenario: The refused wash still paints in the route phase
      Given the active player has clicked a0
      And a grain-adjacent exit of a0 is a refused self-convert under P28
      Then that exit is in the refused wash

    Scenario: The selected halo still marks the source
      Given the active player has clicked a0
      Then a0 carries the selected halo

  Rule: Purity, determinism and cost

    Scenario: Equal inputs produce an equal clickable set
      Given two equal states, tips, carries and drafts
      Then the clickable sets are equal
      And the paints are equal

    Scenario: The clickable set is built once per change, not per hover
      Given the active player has clicked a0
      When the pointer hovers six different clickable arrows in turn
      Then the clickable set is built no more than once

    Scenario: No clock and no randomness
      Then route.ts references neither a clock nor a random source

    Scenario: Offers come from apply, not from speed
      Given a rule change would refuse a hop that speed alone would allow
      Then that hop is not offered
