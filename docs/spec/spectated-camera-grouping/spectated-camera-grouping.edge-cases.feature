# language: en
# Overview: docs/spec/spectated-camera-grouping/spectated-camera-grouping.md
# Web adapter only. No game rule is read or written by anything here.

Feature: Spectated camera grouping — edge cases
  As the person who has to trust this camera on a real board
  I want the degenerate turns, the boundaries and the ties pinned down
  So that a plan is never ambiguous, never empty-handed and never jittery

  Background:
    Given a viewport 800 by 600
    And a safe box of 0.72, a floor of 30 and a ceiling of 56
    And playback speed 1 and reduced motion off

  Rule: A turn with nothing to look at asks for nothing

    Scenario: An empty move list plans nothing
      Given a turn with no moves
      When the turn is planned
      Then there are no camera groups

    Scenario: A turn of nothing but endTurn plans nothing
      Given a turn whose only move is an endTurn
      When the turn is planned
      Then there are no camera groups
      And the camera runs no movement

    Scenario: A turn of one move is one group
      Given a turn whose beats are at (3,3)
      When the turn is planned
      Then there is 1 camera group
      And that group holds 1 beat

    Scenario: A beat whose arrows share a centroid is not a division by zero
      Given a turn whose beats are at (5,5) (5,5)
      When the turn is planned
      Then the only group's display scale is 56
      And the only group's target is centred at (5,5)

  Rule: A move the camera had no choice about showing is never cropped

    Scenario: A lone move too wide for the safe box zooms out past the floor
      Given a turn whose only beat spans from (0,0) to (40,0)
      When the turn is planned
      Then there is 1 camera group
      And the only group's display scale is below 30
      And the only group's display scale is at least 24

    Scenario: A lone move beyond the fit cap is cut to, not flown to
      Given a turn whose only beat spans from (0,0) to (200,0)
      When the turn is planned
      Then the only group is marked as a hard cut
      When the turn is played
      Then the camera jumps to that group's target with no tween

  Rule: Turns are split at endTurn, and never merged

    Scenario: A trailing run with no endTurn is its own turn
      Given a replay window of a step, an endTurn, and a step
      When the window is split into turns
      Then there are 2 turns

    Scenario: The same seat's consecutive turns are not merged
      Given a seat that moves twice in a row while the other seats hold only spawner shares
      And both turns' beats would fit the safe box together at the floor
      When the window is planned
      Then each turn has its own camera groups
      And the second turn's first group is a fresh camera beat

    Scenario: Two turns that would fit together are still planned apart
      Given two turns whose beats are all at (0,0) (1,0)
      When the window is planned
      Then there are 2 plans
      And neither plan holds a beat from the other turn

  Rule: A movement too small to see is not made

    Scenario: A near-identical next group leaves the camera untouched
      Given the camera sits at a group target
      And the next group's target differs by 1% of the shorter viewport side and 1% in scale
      When the next group is reached
      Then the camera is not moved

    Scenario: A pan just past the threshold is made
      Given the camera sits at a group target
      And the next group's target differs by 6% of the shorter viewport side in pan
      When the next group is reached
      Then the camera moves to that target

    Scenario: A scale change just past the threshold is made even with no pan
      Given the camera sits at a group target
      And the next group's target has the same centre and a scale ratio of 1.10
      When the next group is reached
      Then the camera moves to that target

    Scenario: Suppression does not accumulate drift
      Given the camera sits at a group target
      And three consecutive groups are each suppressed against the camera as it stands
      When all three are reached in turn
      Then the camera is not moved at all
      And each suppression is measured against the camera's actual position

  Rule: The allocation is exact, total and single-valued

    Scenario: Every beat lands in exactly one group, in play order
      Given any turn with at least one beat
      When the turn is planned
      Then the groups are contiguous and non-empty
      And concatenating the groups reproduces the turn's beats in order

    Scenario: Two identical turns plan identically
      Given a turn whose beats are at (0,0) (9,0) (18,0) (27,0)
      When the turn is planned twice
      Then both plans are identical

    Scenario Outline: Ties break on the earliest split, not the evenest
      Given a turn of <n> beats whose every split into <k> groups scores the same
      When the turn is planned
      Then the group sizes are <sizes>

      Examples:
        | n | k | sizes   |
        | 4 | 2 | 1,3     |
        | 6 | 3 | 1,1,4   |
        | 6 | 2 | 1,5     |

    Scenario: Zoom above the ceiling does not buy the allocation anything
      Given a turn where one candidate split frames a group far above the ceiling
      And another split frames both groups between the floor and the ceiling
      When the turn is planned
      Then the split whose worst group is better framed is chosen

    Scenario: A group may be infeasible at the floor when k cannot be reduced
      Given a turn whose every single move is too wide for the safe box at the floor
      When the turn is planned
      Then there is one camera group per move
      And each group is framed below the floor rather than merged

  Rule: Timing follows the preferences, not the plan

    Scenario: Reduced motion cuts instead of tweening but keeps the reading time
      Given reduced motion on
      When a group boundary is reached
      Then the group tween lasts 0 ms
      And the hold and the move gap keep their values

    Scenario Outline: Playback speed scales the tween, the hold and the gap together
      Given playback speed <speed>
      When a group boundary is reached at a turn boundary
      Then the group tween lasts <tween> ms
      And the hold lasts <hold> ms
      And the move gap lasts <gap> ms

      Examples:
        | speed | tween | hold | gap |
        | 0.5   | 1120  | 800  | 800 |
        | 1     | 560   | 400  | 400 |
        | 2     | 280   | 200  | 200 |

    Scenario Outline: An unusable stored speed is put in range, never thrown on
      Given a stored playback speed of <stored>
      When a group boundary is reached
      Then the speed used is <used>

      Examples:
        | stored   | used |
        | 0.1      | 0.5  |
        | 99       | 3    |
        | Infinity | 3    |
        | NaN      | 1    |
