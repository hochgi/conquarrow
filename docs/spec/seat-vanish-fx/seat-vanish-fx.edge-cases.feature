# language: en
# Overview: docs/spec/seat-vanish-fx/seat-vanish-fx.md
# Boundaries: two seats, already gone, telemetry, settle, determinism

Feature: Flicker-then-fade when a seat vanishes — the boundaries
  As the web adapter
  I want vanish to stay a single reading at every seam
  So that a cut, a capture and a seat leaving the match never share a metaphor

  Background:
    Given a GameState before and after one applied move
    And a GeometryPort

  Rule: Leftover land and several seats

    Scenario: Unowned leftover territory is a remnant, not a retraction to nobody
      Given C owns share-free territory arrows that are unowned after
      And the step leaves C with no pieces
      When events are resolved and presented
      Then those arrows are in seatVanished for C
      And no territoryLost names C with to unset
      And there is no lossRetract overlay for C on those arrows

    Scenario: Two seats vanish in players order
      Given before.players is A, B, C
      And the step leaves B with no pieces and C with no pieces
      And A still holds pieces
      When events are resolved
      Then seatVanished events are B then C

    Scenario: An already-gone seat is not named again
      Given C has no group, no trail and no territory before
      And C has none after
      When events are resolved
      Then there is no seatVanished for C

    Scenario: A headless-but-paid seat is not vanished
      Given C owns territory after the step
      And C holds no group and no trail after
      When events are resolved
      Then there is no seatVanished for C

    Scenario: Every remnant cell is gone from after as that player's piece
      Given a seatVanish overlay for C
      Then none of its cells is C's territory, C's trail or C's group in after

  Rule: The same move can vanish one seat and cut another

    Scenario: A living bystander's trail still evaporates beside a vanish
      Given the step leaves C with no pieces
      And B still holds pieces with a smaller trail
      When events are resolved and presented
      Then seatVanished names C
      And trailCut names B
      And evaporate names B
      And evaporate does not name C

    Scenario: Closing the mover's own loop is still not a vanish
      Given A's trail becomes A's territory on the step
      And A still holds a group after
      When events are resolved
      Then there is no seatVanished for A
      And no trailCut names A as victim

  Rule: Playtest cuts stay honest

    Scenario: A vanished seat's trail drop does not increment cuts
      Given C's trail is smaller after than before
      And the step leaves C with no pieces
      And no living player's trail shrank
      When foldMatchSummary runs on that batch
      Then cuts stays 0

    Scenario: A living victim's trail drop still increments cuts
      Given B's trail is smaller after than before
      And B still holds pieces
      And no player's territory count increased
      When foldMatchSummary runs on that batch
      Then cuts is 1

  Rule: The celebration still waits, and now sees the vanish

    Scenario: A vanish overlay's lifetime is in the move's settle
      Given a step that queues a seatVanish overlay at offset 360ms lasting 520ms
      Then that overlay's lifetime is 880ms
      And the move's settle time is at least 880ms

    Scenario: More than 120 remnant arrows keep the first 120 in id order
      Given seatVanished for C with more remnant arrows than MAX_FX_CELLS
      When it is presented
      Then the overlay has 120 cells
      And those cells are the remnant arrows in id order, truncated

  Rule: Sound and determinism

    Scenario: seatVanish is audible with a falling sine, not a cut snap
      Then cueFor seatVanish falls in pitch
      And its wave is sine
      And cueFor cutSnap is a different wave

    Scenario: Equal diffs yield equal vanish events and overlays
      Given two equal before/after/move triples that vanish C
      When each is resolved and presented
      Then the seatVanished events are equal
      And the seatVanish overlays are equal in player, cells and delays

    Scenario: Remnant cells are sorted by arrow id
      Given seatVanished for C with several remnant arrows
      Then those arrows are in id order

    Scenario: A pass that vanishes nobody emits no seatVanished
      Given before equals after except the active player may have changed
      And every player who had pieces still has pieces
      When events are resolved
      Then there is no seatVanished

    Scenario: resolveEvents does not read a clock or a random source
      Given any before/after/move triple
      When events are resolved and presented
      Then no Date.now or Math.random was consulted
