# language: en
# Overview: docs/spec/heuristic-finishes/heuristic-finishes.md
# Adapter only — the heuristic seat's search and finisher, not a game rule

Feature: Finisher and search-budget edges — gates, carve shapes, staging limits, reply scoring, equivalences
  As the local heuristic seat
  I want the finisher to act only when dominant and only through legal, claiming loops and own-ground walks
  So that early play is untouched, every returned plan is legal, and the search's fixes change nothing else

  Background:
    Given the generated tiling behind GeometryPort and the pure RulesPort
    And isDominant, carvePlans, stagingWalk and isQuietPlan from botFinish

  Rule: The dominance gate

    Scenario Outline: A seat is dominant only with twice every other seat's heads combined
      Given seat A holds <a> heads, seat B holds <b> heads and seat C holds <c> heads
      And seat B or seat C owns territory
      When isDominant is asked for seat A
      Then the answer is <dominant>

      Examples:
        | a  | b  | c | dominant |
        | 20 | 10 | 0 | true     |
        | 19 | 10 | 0 | false    |
        | 2  | 0  | 0 | true     |
        | 1  | 0  | 0 | false    |
        | 30 | 10 | 6 | false    |
        | 32 | 10 | 6 | true     |

    Scenario: A seat that is not dominant gets no carve and no staging walk
      Given seat A is not dominant
      And a loop from one of A's stacks would claim an arrow of B's territory
      When carvePlans and stagingWalk are asked for seat A
      Then carvePlans returns no plan
      And stagingWalk returns nothing

  Rule: Carve shapes

    Scenario: A loop that claims no enemy arrow is not a carve
      Given seat A is dominant
      And the only loops from A's stacks run over unowned arrows and claim none of B's territory
      When carvePlans is asked for seat A
      Then it returns no plan

    Scenario: A carve may attack an enemy head standing on enemy ground
      Given seat A is dominant
      And the only claiming loop from stack S1 of A passes an arrow of B's territory that holds a B head
      When carvePlans is asked for seat A
      Then it returns a plan whose steps are legal in sequence
      And the step onto the B head moves all of S1's heads or all but one
      And after the plan A's group stands on the landing arrow

    Scenario: A carve never runs through an own stack before its landing
      Given seat A is dominant
      And every claiming loop from stack S1 passes an arrow holding another A stack before landing
      When carvePlans is asked for seat A
      Then no returned plan steps onto an arrow holding an A stack except at its last step

    Scenario: At most four carves are offered, best claim first
      Given seat A is dominant
      And more than four claiming loops exist from A's stacks
      When carvePlans is asked for seat A
      Then it returns at most four plans
      And no returned plan claims fewer of B's share arrows than a claiming loop it left out

  Rule: Staging limits

    Scenario: A staging walk stops where it merges into another own stack
      Given seat A is dominant with a stack S1 of 8 heads on A's territory
      And the shortest own-ground path from S1 to an entry arrow passes an arrow holding another A stack
      When stagingWalk is asked for seat A
      Then the walk's last step lands on that A stack
      And the walk ends seat A's turn

    Scenario: No entry arrow means no staging walk
      Given seat A is dominant
      And no arrow of A's territory has an out-arrow onto another seat's territory
      When stagingWalk is asked for seat A
      Then it returns nothing

    Scenario: A plan that takes ground is not replaced by a staging walk
      Given seat A is dominant and a staging walk exists
      And the plan the search chose grows A's territory
      When chooseTurnBeam plans seat A's turn
      Then the returned plan is not the staging walk

  Rule: Reply scores measure the enemy, not the round boundary

    Scenario: A finalist whose only change across the reply is production keeps its own score
      Given a complete plan P for seat A that is a finalist
      And B's best reply, from B's hypothesised chair, changes nothing for A except the round boundary's production
      When P is scored with replies
      Then P's score equals evaluate of P's terminal state

    Scenario: A finalist the enemy can punish loses exactly the damage
      Given a complete plan P for seat A that is a finalist and leaves A's trail cuttable
      And B's best reply cuts A's trail
      When P is scored with replies
      Then P's score equals evaluate of P's terminal state plus the reply's evaluate minus evaluate after B passes from the same chair
      And that score is lower than evaluate of P's terminal state

  Rule: Behaviour-preserving changes

    Scenario: Findings at a beam node are computed from one step per from→exit
      Given a position where one of A's stacks has 5 heads and three legal exits
      When the beam orders the steps at that node
      Then collectFindings is consulted with at most one step per from→exit
      And that step carries the largest legal count for its from→exit

    Scenario: The multi-source grain distance equals the minimum of single-source distances
      Given any set of start arrows, any set of goal arrows and a cap
      When grainDistanceFromAny is computed
      Then it equals the minimum over the starts of grainDistanceToAny with the same goals and cap

  Rule: A finisher replay never builds an empty step

    Scenario: A carve whose group is cut to one head mid-replay is dropped, not thrown
      Given seat A is dominant and carvePlans replays a claiming loop for stack S1
      And after its first step S1's group holds one head and the full-count next step is illegal
      When carvePlans is asked for seat A
      Then that candidate is dropped
      And no step with fewer than one head is ever constructed

    Scenario: A staging walk whose walker is lost mid-walk stops there, not thrown
      Given seat A is dominant and stagingWalk walks stack S1
      And after its first step no A group stands where S1 moved
      When stagingWalk is asked for seat A
      Then the walk is that one step followed by endTurn
