# language: en
# Overview: docs/spec/geometry-port/geometry-port.md
# SPEC §2 (the board), §7 (specials live on vertices)

Feature: GeometryPort conformance — the arrow graph
  As the rules core
  I want the board exposed as adjacency, incidence and a crossing test
  So that I can be tested against a readable fixture and the real tiling alike

  Background:
    Given a board obtained from a conforming GeometryPort
    And a window grown from the port's seed point

  # The board is unbounded (SPEC §11 item 4), so "every point" always means every
  # point of that window. Each property below is local, so a window is a fair
  # sample rather than a compromise.

  Rule: Points are 3-in / 3-out

    The load-bearing property of the whole design. It buys strong connectivity,
    so no head is ever stranded. Self-trap is impossible for a different reason:
    stepping onto your own trail is legal (SPEC §6.1a, invariant 2).

    Scenario: Every point has exactly three in-arrows and three out-arrows
      When I enumerate every point on the board
      Then each point has exactly 3 in-arrows
      And each point has exactly 3 out-arrows

    Scenario: Adjacency agrees with arrow endpoints
      When I enumerate every arrow on the board
      Then each arrow is among the out-arrows of its origin point
      And each arrow is among the in-arrows of its target point

    Scenario: A point's six arrow slots are distinct
      When I enumerate every point on the board
      Then that point's 3 in-arrows and 3 out-arrows are 6 distinct arrows

  Rule: Every arrow flanks exactly two spawner vertices

    An arrow touches exactly four interesting things: its origin point, its
    target point, and the two vertices on its left and right. Two is a hard
    limit, so a triple-fed arrow is impossible and the economy never has to
    consider one.

    Scenario: Every vertex is bordered by exactly three arrows
      When I enumerate every vertex on the board
      Then each vertex is bordered by exactly 3 arrows

    Scenario: Every arrow flanks exactly two distinct vertices
      When I enumerate every arrow on the board
      Then each arrow flanks exactly 2 distinct vertices

    Scenario: Flank and border are mutually inverse
      When I enumerate every arrow on the board
      Then every vertex that arrow flanks is bordered by that arrow
      And every arrow bordering a vertex flanks that vertex

  Rule: The incidence counts close at 3:1:2

    Derived, not measured. A board violating these is not a lattice, and every
    count the economy quotes depends on them.

    On an unbounded board these are densities rather than totals, so both halves
    are asserted locally — which is sharper anyway, since a global count can be
    right on average while being wrong at every individual point.

    Scenario: Every point owns exactly three arrows
      When I enumerate every point in the window
      Then exactly 3 arrows in the window have that point as their origin
      And no arrow in the window has an origin outside the window and is counted

    Scenario: Every point lies on exactly six minimal cycles
      When I enumerate every point in the window
      Then exactly 6 directed 3-cycles pass through it
      # Three points per cycle, so cycles are twice the points; the cycle-vertex
      # bijection in the edge cases then gives vertices twice the points. The
      # 2:1 ratio, with nothing counted globally.

  Rule: The graph is strongly connected with girth 3

    Strong connectivity is why movement needs no backwards step. Girth 3 is why
    the minimum enclosable territory costs 3 arrows and holds exactly one
    spawner.

    Scenario: Every point can reach every other point
      Given any point in the window
      When I compute the set of points reachable by following arrows forward
      Then that set contains every point in the window
      # The search is confined to a slightly larger window so that it terminates
      # on an unbounded board. Girth 3 means a U-turn costs three moves, so a
      # detour never needs much room — on the generated lattice, none at all.

    Scenario: The shortest directed cycle has length three
      When I compute the girth of the arrow graph
      Then the girth is exactly 3

    Scenario: A minimal cycle encloses exactly one spawner vertex
      Given a directed cycle of length 3
      When I ask which vertices lie inside it
      Then exactly one vertex lies inside it

  Rule: Enumeration is bounded and duplicate-free

    Fill (reachability, SPEC §7) sweeps a region of the board through this port and must not
    know how the board is represented. On an unbounded board the region has to be
    asked for explicitly, which is what a window is.

    Scenario Outline: Enumeration yields each element exactly once
      When I enumerate every <element> in the window
      Then no <element> appears twice

      Examples:
        | element |
        | point   |
        | arrow   |
        | vertex  |

    Scenario: A window holds everything its own points reach for
      When I enumerate every point in the window
      Then all 6 arrows of each are among the window's arrows
      And both flank vertices of each of those arrows are among the window's vertices
