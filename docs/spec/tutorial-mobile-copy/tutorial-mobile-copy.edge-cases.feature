# language: en
# Overview: docs/spec/tutorial-mobile-copy/tutorial-mobile-copy.md
# Packet P44 — honesty under misuse. No SPEC.md edit.

Feature: Padding, auto-Send and chrome fail closed
  As a player who taps the wrong place, drafts mid-rail, or uses a mouse
  I want padding not to steal a far arrow, auto-Send not to fire early, and the viewport not to yank
  So that the lesson still teaches the same legal game

  Background:
    Given the real tiling, a RulesPort, and the P43 tutorial module

  Rule: Fine pointers and non-candidates stay exact

    Scenario: Fine pointer within coarse padding but outside the polygon misses
      Given candidate arrows include a0
      And the click sits outside a0's lattice polygon but within 24 CSS px of it
      When hitArrow runs with padding 0
      Then there is no hit

    Scenario: Padding 0 matches today's point-in-polygon
      Given the same layout, viewport, click and candidates
      When hitArrow runs with no options and with padding 0
      Then both hits are equal

    Scenario: A far own stack is not a lesson-target
      Given an expect rail whose selectable set is only a0
      And the learner also owns a1
      When lesson-target arrows are computed
      Then a0 is a lesson-target
      And a1 is not

  Rule: Auto-Send does not invent a send

    Scenario: Multi-value carryAllow does not auto-Send
      Given an expect rail with one exit and carryAllow [1, 2]
      When the last exit is drafted
      Then auto-Send does not apply
      And the coach names Send

    Scenario: Auto-Send still uses the ordinary send path
      Given a single-exit expect that auto-Sends
      When the last exit is clicked
      Then the committed batch is the same moves send would emit
      And no second apply door is used

    Scenario: An engine-illegal send is still refused
      Given a decorated mode whose inner send would refuse
      When auto-Send runs
      Then the engine refusal is still present
      And the coach line is still attached

  Rule: Pan does not yank a draft

    Scenario: Expect-entry pan is skipped while a draft is in progress
      Given an expect step whose from is off-screen
      And the route draft already contains a step
      When expect-entry pan is considered
      Then the viewport does not change

    Scenario: Expect-entry pan is skipped when from is already on-screen
      Given an expect step whose from is inside the viewport
      And the route draft is empty
      When expect-entry pan is considered
      Then the viewport does not change

    Scenario: Pan does not run on narrate, demo, objective or end
      Given the current step is not an expect
      When expect-entry pan is considered
      Then the viewport does not change

  Rule: Banner and copy stay honest

    Scenario: Stage banner and HUD coach are the same string
      Given a snapshot whose coach is C
      And the current step is an expect with title T
      When the stage banner is computed
      Then the banner title is T
      And the banner body is C
      And the HUD coach is C

    Scenario: Objective banner shows the hint
      Given the L3 session is on its objective step
      When the stage banner is computed
      Then the banner body is that step's hint

    Scenario: No learner string contains the speed formula
      Given every shipped lesson and every copy template
      Then no learner string matches the speed-formula pattern

    Scenario: L4 copy does not name the threat-weighted floor rule
      Given lesson L4
      Then no L4 narrate, title, coach, hint or summary contains "threat-weighted"

    Scenario: L7 copy names territory, shares and heads in plain outcomes
      Given lesson L7
      Then L7 has at least two narrate steps
      And those strings mention territory, shares and heads
      And none of them match the speed-formula pattern

    Scenario: Narrate with focus does not cover the focused arrow
      Given an L0 narrate step whose focus is the home stack
      When the overlay layout is computed at a phone-width viewport
      Then the overlay card's box does not contain the home stack's screen centroid
