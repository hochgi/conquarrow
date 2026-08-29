# language: en
# Overview: docs/spec/online-move-log-replay/online-move-log-replay.md
# ADR 0002, packet P49

Feature: Move-log replay boundaries, backlogs, and recovery
  As a signed-in player seated in an online game
  I want catch-up to be exact or honestly abandoned
  So that I never watch a replay that is archaeology or a fiction

  Background:
    Given ADR 0002 is accepted
    And S3 is a fake store
    And PostToConnection is a fake sink

  Rule: Route argument boundaries

    Scenario Outline: A malformed since is unprocessable
      Given an all-human 2-seat started game at version 3
      When A GETs the log with since "<since>"
      Then the response is 422
      And the response carries no moves

      Examples:
        | since   |
        |         |
        | abc     |
        | 1.5     |
        | -1      |

    Scenario: A since ahead of the server yields no moves and no gap
      Given an all-human 2-seat started game at version 3
      When A GETs the log since version 9
      Then the response is 200
      And the body to is 3
      And the body moves are empty
      And the body reports no gap

    Scenario: An unknown game is not found
      Given fake S3 holds no meta for this group and game
      When A GETs the log since version 0
      Then the response is 404

    Scenario: An unsigned caller is rejected
      Given an all-human 2-seat started game at version 3
      When the log since version 0 is requested with no bearer
      Then the response is 401

  Rule: Gaps are reported, never guessed

    Scenario: A window needing a pre-P49 unstamped line reports a gap
      Given an all-human 2-seat started game at version 3
      And log.jsonl holds unstamped lines for versions 0 through 2 and a stamped batch for version 3
      When A GETs the log since version 1
      Then the response is 200
      And the body reports a gap
      And the body moves are empty

    Scenario: A window entirely inside the stamped tail replays
      Given an all-human 2-seat started game at version 3
      And log.jsonl holds unstamped lines for versions 0 through 2 and a stamped batch for version 3
      When A GETs the log since version 2
      Then the response is 200
      And the body reports no gap
      And the body moves are the version 3 batch

    Scenario: A missing version inside the window reports a gap
      Given an all-human 2-seat started game at version 4
      And log.jsonl holds stamped batches for versions 0, 1, 2 and 4
      When A GETs the log since version 1
      Then the response is 200
      And the body reports a gap
      And the body moves are empty

    Scenario: A missing log file reports a gap
      Given an all-human 2-seat started game at version 3 with no log.jsonl
      When A GETs the log since version 0
      Then the response is 200
      And the body reports a gap
      And the body moves are empty

  Rule: The client falls back rather than inventing a picture

    Scenario: A gap installs the snapshot
      Given this client displays version 1 and the server holds version 6
      And the log reports a gap for that window
      When a stateChanged for version 6 arrives
      Then the snapshot for version 6 is installed
      And no moves are replayed
      And the displayed baseline becomes 6

    Scenario: A failed log request installs the snapshot
      Given this client displays version 5 and the server holds version 6
      And the log request fails
      When a stateChanged for version 6 arrives
      Then the snapshot for version 6 is installed
      And no moves are replayed

    Scenario: A tab becoming visible after an absence installs the snapshot
      Given this client displays version 2 and the tab has been hidden
      And the server now holds version 9
      When the tab becomes visible
      Then the snapshot for version 9 is installed
      And no moves are replayed

  Rule: Backlog — queue and replay everything, in order

    Scenario: A wake arriving mid-replay is queued and replayed after it
      Given this client displays version 4 and a replay of version 5 is in flight
      When a stateChanged for version 6 arrives
      Then the version 5 replay finishes first
      And the version 6 moves are replayed after it
      And no batch is skipped
      And the displayed baseline becomes 6

    Scenario: Two wakes arriving during one replay both play, in arrival order
      Given this client displays version 4 and a replay of version 5 is in flight
      When stateChanged arrives for version 6 and then for version 7
      Then the batches are replayed in the order 5, 6, 7
      And the displayed baseline becomes 7

  Rule: Replay content edge cases

    Scenario: A batch of only endTurn moves commits without a camera hop
      Given this client displays version 4 and the version 5 batch is a single endTurn
      When a stateChanged for version 5 arrives
      Then the endTurn is applied through the commit path
      And no camera hop is performed
      And the displayed baseline becomes 5

    Scenario: A batch that ends the match replays to the win
      Given this client displays version 4 and the version 5 batch ends the match
      When a stateChanged for version 5 arrives
      Then every move of the batch is replayed
      And the final state carries the winner

    Scenario: Local input is refused while a replay is in flight
      Given a replay is in flight and this client's seat is to move in the replayed batch's final state
      When this client attempts a move before the replay finishes
      Then no move is submitted
      And the replay continues to its end

  Rule: Divergence is loud and inert

    Scenario: A replayed state disagreeing with the snapshot is reported and left alone
      Given this client displays version 4 and the server holds version 5
      And replaying the version 5 batch yields a state differing from the version 5 snapshot
      When the replay finishes
      Then the divergence is reported with the group, game and version
      And the replayed state is left in place
      And no message is shown to the player
      And the displayed baseline becomes 5
