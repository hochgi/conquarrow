# language: en
# Overview: docs/spec/tutorial-mobile-copy/tutorial-mobile-copy.md
# Packet P44 — adapter follow-up to P43. No SPEC.md edit.

Feature: Reach the intended arrow on a phone, then send without hunting
  As a new player on a coarse pointer
  I want taps to hit the lit stack, the rail to send itself when nothing is left to decide, and copy that names consequences
  So that first contact is the lesson, not the chrome

  Background:
    Given the real tiling, a RulesPort, and the P43 tutorial module
    And lesson L0 is on the grain, whose opening is makeMatch folded through apply
    And fine pointers use lattice point-in-polygon with padding 0
    And coarse pointers use 24 CSS px of screen-space padding

  Rule: Hit testing expands only for coarse pointers, only among candidates

    Scenario: Fine pointer inside a polygon selects that arrow
      Given candidate arrows include a0
      And the click sits inside a0's lattice polygon
      When hitArrow runs with padding 0
      Then the hit is a0

    Scenario: Coarse pointer within padding of a single candidate selects it
      Given candidate arrows include only a0
      And the tap sits outside a0's polygon but within 24 CSS px of it in screen space
      When hitArrow runs with padding 24
      Then the hit is a0

    Scenario: Coarse overlapping candidates prefer the nearest centroid
      Given candidate arrows include a0 and a1 whose padded regions both contain the tap
      And a0's lattice centroid is closer to the tap's lattice point than a1's
      When hitArrow runs with padding 24
      Then the hit is a0

    Scenario: Coarse padding never selects outside the candidate list
      Given a0 is under the tap within 24 CSS px
      And the candidate list is only a1, which is far from the tap
      When hitArrow runs with padding 24
      Then there is no hit

  Rule: A finished single-exit rail sends without a second tap

    Scenario: Single-exit expect with one allowed carry auto-Sends
      Given an expect rail whose exits are exactly e0 and whose carryAllow is [2] or omitted
      And the learner has selected the rail source
      When the learner clicks e0
      Then the ordinary send path runs
      And the expect step completes without a further Send tap

    Scenario: Multi-exit expect still requires Send after the first exit
      Given an expect rail whose exits are e0 then e1
      And the learner has selected the rail source
      When the learner clicks e0
      Then the draft includes e0
      And send has not run
      And the coach names the Send control

    Scenario: Off-rail coach appears in the stage banner and the HUD
      Given an L0 expect step with coach C
      When the learner clicks an off-rail own stack
      Then the stage banner body is C
      And the HUD coach is C

    Scenario: Entering expect pans the source on-screen
      Given the session has just advanced onto an expect step whose from is a0
      And the route draft is empty
      And a0 is outside the viewport
      When the host applies expect-entry pan
      Then a0 is inside the viewport

  Rule: Copy names consequences, not the formula

    Scenario: L0 narrate strings contain no log or floor formula
      Given lesson L0
      Then no L0 narrate, title, coach or summary matches the speed-formula pattern

    Scenario: L0 states the doubling rule in plain language
      Given lesson L0
      Then some narrate string says that three heads take two steps
      And some narrate string says that doubling a stack adds a step

    Scenario: Expect title is visible while the expect step is current
      Given the L0 session is on its expect step
      When the stage banner is computed
      Then the banner title is that step's title

    Scenario: Coach that requires Send names the Send control
      Given an expect rail for which auto-Send does not apply
      Then that step's coach names Send

  Rule: P43 regressions stay green

    Scenario: The golden path still validates for every lesson
      Given all shipped lessons
      When each golden path replays through the engine
      Then every lesson validates

    Scenario: Narrate Next and end Done still advance
      Given the L0 session is on a narrate step
      When Next is pressed
      Then the session advances
      And when the end summary is dismissed the session completes L0

    Scenario: Engine refusals still surface under the coach
      Given a decorated idle click the engine refuses
      Then the snapshot carries the same refusal as the undecorated mode
      And the snapshot also carries the coach line
