# language: en
# Overview: docs/spec/spectated-camera-grouping/spectated-camera-grouping.md
# Web adapter only. No game rule is read or written by anything here.

Feature: Spectated camera grouping
  As a player watching a turn this client did not drive
  I want the camera to frame a run of moves once and then hold perfectly still
  So that a turn reads as a few deliberate shots rather than a dribble of nudges

  Background:
    Given a viewport 800 by 600
    And a safe box of 0.72, a floor of 30 and a ceiling of 56
    And playback speed 1 and reduced motion off

  Rule: A run of moves that fits the safe box is framed once

    Scenario: Three neighbouring moves become one group
      Given a turn whose beats are at (0,0) (1,0) (2,0) (3,0) (4,0) (5,0)
      When the turn is planned
      Then there is 1 camera group
      And that group holds every beat of the turn

    Scenario: The camera does not move inside a group
      Given a turn whose beats are at (0,0) (1,0) (2,0) (3,0)
      When the turn is played
      Then the camera runs 1 movement in total
      And the camera is not moved between the moves of a group

    Scenario: A group is centred on the midpoint of its beats
      Given a turn whose beats are at (2,4) (2,4) (6,8) (6,8)
      When the turn is planned
      Then the only group's target is centred at (4,6)

    Scenario: A tight group is framed no closer than the ceiling
      Given a turn whose beats are at (0,0) (0,0)
      When the turn is planned
      Then the only group's display scale is 56

  Rule: A turn too wide for one shot costs the fewest shots the box allows

    Scenario: A spread turn needs two groups
      Given a turn whose beats are at (0,0) (1,0) (2,0) (30,0) (31,0) (32,0)
      When the turn is planned
      Then there are 2 camera groups
      And no partition of that turn into fewer groups fits the safe box at the floor

    Scenario: The moves are balanced across the groups, not stuffed into the first
      Given a turn whose beats span far enough to need exactly 2 groups
      And a greedy prefix at the floor would take 5 moves then 1
      When the turn is planned
      Then neither group holds 5 beats
      And the worse-framed group's display scale is higher than it would be under the greedy prefix

  Rule: Grouping never spans a turn

    Scenario: Two turns in one replay window are planned apart
      Given a replay window of a turn, an endTurn, and a second turn
      And every beat of both turns fits the safe box together at the floor
      When the window is planned
      Then each turn is planned on its own
      And no camera group holds beats from both turns

    Scenario: endTurn contributes nothing to a group
      Given a turn whose moves are a step, a step, and an endTurn
      When the turn is planned
      Then there are 2 beats in total
      And the group's target ignores the endTurn

  Rule: One camera movement per group, then stillness

    Scenario: A group boundary is a single merged tween followed by a hold
      Given a turn planned into 2 camera groups
      When the turn is played
      Then each group runs exactly 1 camera movement
      And that movement lasts the summed ease-out and ease-in duration
      And the group holds before its first move plays

    Scenario: Local playback and online replay use the same plan
      Given a turn of beats at (0,0) (1,0) (20,0) (21,0)
      When the turn is planned for local bot playback
      And the same turn is planned for online replay
      Then both plans are identical
