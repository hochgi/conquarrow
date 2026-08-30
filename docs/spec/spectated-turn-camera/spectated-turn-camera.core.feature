# language: en
# Overview: docs/spec/spectated-turn-camera/spectated-turn-camera.md
# Web adapter only. No game rule is read or written by anything here.

Feature: Spectated-turn camera
  As a player waiting while an AI seat takes its turn
  I want the camera to follow each move and then put me back where I was
  So that an opponent's turn is something I can watch rather than miss

  Background:
    Given a viewport 800 by 600 lattice-mapped at scale 48
    And playback speed 1 and reduced motion off

  Rule: A spectated seat is one nobody at this keyboard drives

    Scenario Outline: Local seat kinds
      Given a local match that is not a tutorial
      When a <kind> seat is to move
      Then isSpectatedSeat is <spectated>

      Examples:
        | kind      | spectated |
        | heuristic | true      |
        | byok      | true      |
        | human     | false     |

    Scenario: A hot-seat human who is not you is still not spectated
      Given a local hot-seat match with human seats A and B
      And A is the seat at this keyboard
      When B is to move
      Then isSpectatedSeat is false

    Scenario: Every seat of an all-bot match is spectated
      Given a local match whose three seats are all heuristic
      Then isSpectatedSeat is true for each of them

  Rule: The camera is locked for the replay window only

    Scenario: Locked while the decided moves replay
      Given a spectated seat with auto-focus on
      When the replay window is open
      Then the camera is locked

    Scenario: Free while the seat is still deciding
      Given a spectated seat with auto-focus on
      When no replay window is open
      Then the camera is not locked

    Scenario: Auto-focus off releases the camera
      Given a spectated seat with auto-focus off
      When the replay window is open
      Then the camera is not locked

  Rule: Only a step earns a hop

    Scenario: A step names its two arrows
      Given a step move from arrow a1 exiting to arrow a2
      Then arrowsOfMove is a1 and a2

    Scenario Outline: Moves that show nothing get no hop
      Given a <kind> move
      Then arrowsOfMove is empty
      And no hop is produced for it

      Examples:
        | kind    |
        | endTurn |

  Rule: A fit frames what it was given and stays inside the zoom clamps

    Scenario: Two nearby arrows are framed together
      Given lattice points (0, 0) and (3, 2)
      When they are fitted
      Then the fit centre is (1.5, 1)
      And both points are inside the fitted viewport
      And the fit is not a hard cut

    Scenario: A tight fit does not zoom past the maximum
      Given two lattice points one unit apart
      When they are fitted
      Then the fit scale is ZOOM.max

    Scenario: A wide fit does not zoom out past the minimum
      Given lattice points (0, 0) and (40, 40)
      When they are fitted
      Then the fit scale is ZOOM.min

  Rule: A hop bridges the previous beat and the upcoming move

    Scenario: The bridging beat frames both, the move beat frames one
      Given a previous beat at lattice points (0, 0) and (1, 0)
      And an upcoming move at lattice points (6, 0) and (7, 0)
      When hop targets are computed
      Then the bridging fit contains all four points
      And the move fit contains only the two move points
      And the move fit centre is (6.5, 0)
      And the hop is not a hard cut

    Scenario: The first hop of a window bridges from the saved camera centre
      Given a saved camera centred on (0, 0)
      And an upcoming move at lattice points (5, 1) and (6, 1)
      When hop targets are computed with the saved centre as the previous beat
      Then the bridging fit contains (0, 0)
      And the bridging fit contains (5, 1) and (6, 1)

    Scenario: A seat boundary holds longer
      Given a hop from seat A's last move to seat B's first move
      When the timing is computed
      Then the hold is 400 ms
      And the ease-out is 260 ms and the ease-in is 300 ms

  Rule: Timing scales with the playback speed

    Scenario Outline: Speed divides every duration together
      Given playback speed <speed>
      When the timing of an ordinary hop is computed
      Then the ease-out is <out> ms
      And the ease-in is <in> ms
      And the hold is <hold> ms
      And the move gap is <gap> ms

      Examples:
        | speed | out | in  | hold | gap |
        | 1     | 260 | 300 | 150  | 400 |
        | 2     | 130 | 150 | 75   | 200 |
        | 0.5   | 520 | 600 | 300  | 800 |

    Scenario: Reduced motion hard-cuts but still takes you there
      Given reduced motion on
      When the timing of an ordinary hop is computed
      Then the ease-out is 0 ms and the ease-in is 0 ms
      And the hold is 150 ms and the move gap is 400 ms
      And the hop still produces a move fit

  Rule: Restore puts the player back, and nudges only if the target is off screen

    Scenario: A visible target restores the saved camera untouched
      Given a saved camera centred on (0, 0) at scale 48
      And a target stack whose centroid is (1, 1)
      When the restore target is computed
      Then it equals the saved camera

    Scenario: An off-screen target re-centres at the saved scale
      Given a saved camera centred on (0, 0) at scale 48
      And a target stack whose centroid is (40, 40)
      When the restore target is computed
      Then it is centred on (40, 40)
      And its scale is 48

  Rule: The target stack falls back down a fixed chain

    Scenario: End Turn uses the stack selected at the click
      Given the selection at commit was arrow s1
      And the player still owns a group on s1
      When the target stack is chosen
      Then it is s1

    Scenario: Exhaustion uses the exit of the final step
      Given no selection at commit
      And this turn's step exits were e1 then e2 then e3
      And the player still owns a group on e3
      When the target stack is chosen
      Then it is e3

    Scenario: A dead stack walks back through this turn's exits
      Given the selection at commit was arrow s1
      And this turn's step exits were e1 then e2 then e3
      And the player owns a group on e1 only
      When the target stack is chosen
      Then it is e1
