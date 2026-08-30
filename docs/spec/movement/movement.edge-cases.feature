# language: en
# Overview: docs/spec/movement/movement.md
# SPEC §3 (merge cost, conveyor, allowance), §4 (turn end), §11 items 19–22

Feature: Movement — refusals, merge barring and purity
  As the rules core
  I want illegal and boundary moves to fail loudly at apply
  So that a wrong step never becomes a silent wrong board state

  Background:
    Given a fixture board behind GeometryPort
    And a game state of occupancy, spent counters and merge overrides
    And it is player A's turn

  Rule: Illegal steps are refused with a contract violation

    Scenario: A step whose exit is not an out-arrow of the source's target is refused
      Given arrow a1 holds 1 head belonging to player A
      And arrow x1 is not among the out-arrows of the target of a1
      When player A tries to step count 1 from a1 to x1
      Then the step is refused with a contract violation

    Scenario: A step that overdraws the source is refused
      Given arrow a1 holds 2 heads belonging to player A
      And exit e1 is a legal empty out-arrow from a1
      When player A tries to step count 3 from a1 to e1
      Then the step is refused with a contract violation

    Scenario: A step from an empty arrow is refused
      Given arrow a1 is empty
      And exit e1 is an out-arrow of the target of a1
      When player A tries to step count 1 from a1 to e1
      Then the step is refused with a contract violation

    Scenario: A step from an opponent's group is refused
      Given arrow a1 holds 2 heads belonging to player B
      And exit e1 is a legal empty out-arrow from a1
      When player A tries to step count 1 from a1 to e1
      Then the step is refused with a contract violation

    Scenario: A step onto an opponent-occupied arrow is refused
      Given arrow a1 holds 1 head belonging to player A
      And arrow e1 holds 1 head belonging to player B
      And e1 is an out-arrow of the target of a1
      When player A tries to step count 1 from a1 to e1
      Then the step is refused with a contract violation
      # Combat on contact is P06. P04 refuses; it does not resolve.

    Scenario: A step with no allowance left is refused
      Given arrow a1 holds 1 head belonging to player A
      And the group has spent 1
      And exit e1 is a legal empty out-arrow from a1
      When player A tries to step count 1 from a1 to e1
      Then the step is refused with a contract violation

  Rule: Once barred, a later arrival cannot un-bar

    Scenario: A small arrival after a majority merge leaves the stack barred
      Given arrow dest holds 1 head belonging to player A with spent 0
      And arrow big holds 2 heads belonging to player A with spent 0
      And arrow small holds 1 head belonging to player A with spent 0
      And dest is a legal exit from both big and small
      When player A steps the 2 from big onto dest
      Then the merged group of 3 has effective speed 0
      When player A steps the 1 from small onto dest
      Then the merged group of 4 still has effective speed 0
      And no further step from dest is legal this turn
      # *Any* is load-bearing (§3): order must not launder the restriction.

    Scenario: On merge, destination spent is kept and arrivals' spent is discarded
      Given arrow dest holds 2 heads belonging to player A with spent 1
      And arrow src holds 1 head belonging to player A with spent 0
      And dest is a legal exit from src
      When player A steps the 1 from src onto dest
      Then the merged group keeps spent 1
      And its effective speed is 1
      # Arrivals already paid to get there; they are carried, not carrying.

  Rule: The conveyor is priced, not banned

    Scenario: An equal-link chain is barred on the second merge
      Given arrows c0, c1, c2 each hold 1 head belonging to player A
      And c1 is a legal exit from c0
      And c2 is a legal exit from c1
      When player A steps the head on c0 onto c1
      Then c1 holds 2 heads with effective speed 1
      When player A steps those 2 from c1 onto c2
      Then c2 holds 3 heads with effective speed 0
      And no further step from c2 is legal this turn
      # §3 conveyor: equal links do not free-roll; the growing arrival outnumbers
      # the next parked head and pays speed 0.

  Rule: apply is pure

    Scenario: apply does not mutate its input state
      Given a state S0 with player A's group on a1
      And a legal step m from a1
      When I apply m to S0 yielding S1
      Then S0 is unchanged
      And S1 differs from S0 in occupancy and spent

    Scenario: Two equal applies agree exactly
      Given two identical copies of a state S
      And a legal move m
      When I apply m to each copy
      Then the two resulting states are equal
