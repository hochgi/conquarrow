# language: en
# Overview: docs/spec/spectated-turn-camera/spectated-turn-camera.md
# Boundaries, interactions and recovery. Pure-module level only — the rAF tween
# runner in App is deliberately untested (see the overview).

Feature: Spectated-turn camera — edge cases
  As the person who has to trust this camera
  I want the fled seat, the dead stack, the corrupt preference and the pause
  So that no boundary produces a jump, a throw, or an unreproducible pick

  Background:
    Given a viewport 800 by 600
    And playback speed 1 and reduced motion off

  Rule: Contexts where spectating is off entirely

    Scenario: The tutorial owns its own camera
      Given a tutorial is running
      When a heuristic seat is to move
      Then isSpectatedSeat is false

    Scenario: Online is out of scope until P49
      Given an online match
      When a heuristic seat is to move
      Then isSpectatedSeat is false

    Scenario: Tutorial wins even over an online heuristic seat
      Given a tutorial is running and the match is flagged online
      When a heuristic seat is to move
      Then isSpectatedSeat is false

  Rule: A seat that has fled the field is cut to, not dollied to

    Scenario: A bridging fit past the cap hard-cuts to the move
      Given a previous beat at lattice point (0, 0)
      And an upcoming move at lattice points (60, 60) and (61, 60)
      When hop targets are computed
      Then the hop is a hard cut
      And no bridging fit is produced
      And the move fit is centred on (60.5, 60)

    Scenario: A fit exactly at the cap radius is not a hard cut
      Given a bounds whose padded half-diagonal is exactly 24 lattice units
      When it is fitted
      Then it is not a hard cut

    Scenario: A fit one step past the cap radius is a hard cut
      Given a bounds whose padded half-diagonal exceeds 24 lattice units
      When it is fitted
      Then it is a hard cut

  Rule: Degenerate geometry is well defined

    Scenario: A single point still fits
      Given a single lattice point (2, -3)
      When it is fitted
      Then the fit is centred on (2, -3)
      And the fit scale is within the zoom clamps
      And nothing divides by zero

    Scenario: A move whose from and exit share a centroid still fits
      Given both move points at (4, 4)
      When hop targets are computed
      Then a move fit centred on (4, 4) is produced

    Scenario: No upcoming arrows means no hop at all
      Given an empty set of upcoming move points
      When hop targets are computed
      Then no hop is produced

    Scenario: An empty previous beat produces no bridging beat
      Given an empty previous beat
      And an upcoming move at lattice points (5, 0) and (6, 0)
      When hop targets are computed
      Then no bridging fit is produced
      And the move fit is centred on (5.5, 0)

    Scenario: Negative lattice coordinates fit the same as positive ones
      Given lattice points (-7, -9) and (-4, -6)
      When they are fitted
      Then the fit centre is (-5.5, -7.5)
      And both points are inside the fitted viewport

  Rule: Sequential opponents restore once, at the end

    Scenario: No restore between two spectated seats
      Given seat B and seat C are both spectated and move back to back
      When B's moves are exhausted and C is to move
      Then the saved camera is not restored
      And the camera hops from B's last move to C's first move

    Scenario: Restore when control returns to this client
      Given seat B and seat C have both finished their spectated turns
      When the human seat is to move
      Then the saved camera is restored exactly once

    Scenario: The camera is free while the next seat is deciding
      Given seat B's replay window has closed and seat C is deciding
      Then the camera is not locked

  Rule: Pause holds; it does not free the camera

    Scenario: The lock survives a pause
      Given a spectated seat with auto-focus on and the replay window open
      When bots are paused
      Then the camera is still locked

    Scenario: The toggle is the escape hatch, not the pause
      Given a spectated seat with the replay window open and bots paused
      When auto-focus is turned off
      Then the camera is not locked

  Rule: The target stack chain bottoms out safely

    Scenario: Nothing from this turn survived, so the lowest owned arrow wins
      Given the selection at commit was s1
      And this turn's step exits were e1 then e2
      And the player owns groups on arrows z9 and a2 and m5 only
      When the target stack is chosen
      Then it is a2

    Scenario: The pick is reproducible whatever order the owned set was built in
      Given two owned sets with the same arrows inserted in different orders
      When the target stack is chosen from each
      Then both picks are the same arrow

    Scenario: A player with no units gets no target
      Given the selection at commit was s1
      And this turn's step exits were e1 then e2
      And the player owns no group
      When the target stack is chosen
      Then there is no target stack
      And the restore target equals the saved camera

    Scenario: A turn of nothing but skips contributes no exits
      Given a turn whose only moves were skips and an endTurn
      And no selection at commit
      And the player owns a group on arrow k1 only
      When the target stack is chosen
      Then it is k1

    Scenario: A target exactly on the nudge margin counts as off screen
      Given a saved camera under which the target centroid lands on the 16 percent margin
      When the restore target is computed
      Then it is re-centred on the target

  Rule: Preferences are total and clamped

    Scenario: A missing key gives the defaults
      Given no stored preferences
      When preferences are parsed
      Then auto-focus is on and the playback speed is 1

    Scenario Outline: Malformed storage falls back rather than throwing
      Given stored preferences of <raw>
      When preferences are parsed
      Then auto-focus is on and the playback speed is 1
      And nothing throws

      Examples:
        | raw            |
        | ""             |
        | "not json"     |
        | "[]"           |
        | "{\"autoFocus\":\"yes\"}" |

    Scenario Outline: Speed is clamped into range
      Given a stored playback speed of <stored>
      When preferences are parsed
      Then the playback speed is <speed>

      Examples:
        | stored | speed |
        | 0.1    | 0.5   |
        | 9      | 3     |
        | 2.5    | 2.5   |
        | NaN    | 1     |

    Scenario: Round-tripping preferences preserves them
      Given preferences with auto-focus off and speed 2.5
      When they are serialized and parsed back
      Then auto-focus is off and the playback speed is 2.5

  Rule: The camera changes nothing about the game

    Scenario: A spectated replay applies the same moves as an unspectated one
      Given a decided turn of moves for a heuristic seat
      When it is replayed with the camera on and again with it off
      Then both runs apply the same moves in the same order
      And both runs reach the same final state
