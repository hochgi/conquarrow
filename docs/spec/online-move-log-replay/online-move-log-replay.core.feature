# language: en
# Overview: docs/spec/online-move-log-replay/online-move-log-replay.md
# ADR 0002, packet P49

Feature: Serving the move log and replaying a remote turn
  As a signed-in player seated in an online game
  I want the opponent's turn to play out move by move on my board
  So that online feels the same as local — camera, effects, and match log

  Background:
    Given ADR 0002 is accepted
    And Google ID tokens verify against a fake verifier in tests
    And S3 is a fake store
    And the heuristic chooser is injected
    And PostToConnection is a fake sink

  Rule: Log lines carry the version their batch produced

    Scenario: A human move stamps one line with the new version
      Given an all-human 3-seat started game with A to move at version 0
      When A posts a legal step with If-Match "0"
      Then the response is 200
      And log.jsonl holds exactly one line stamped version 1
      And that line's move is A's step

    Scenario: A heuristic burst stamps every line with the same version
      Given a started 3-seat game with seats human, heuristic, human and A to move at version 0
      And the heuristic chooser always endTurns
      When A posts an endTurn with If-Match "0"
      Then the response is 200
      And every line appended by that request is stamped version 1
      And the appended lines are A's endTurn followed by the heuristic seat's moves in order

    Scenario: The opening burst is stamped version 0
      Given a started 3-seat game with seats heuristic, human, human and no state.json
      And the heuristic chooser always endTurns
      When B GETs the game
      Then the response is 200
      And every line in log.jsonl is stamped version 0

  Rule: GET the log since a version

    Scenario: Moves since the caller's version are served in order
      Given an all-human 2-seat started game at version 3
      And log.jsonl holds stamped batches for versions 0, 1, 2 and 3
      When A GETs the log since version 1
      Then the response is 200
      And the body from is 1
      And the body to is 3
      And the body reports no gap
      And the body moves are the version 2 batch followed by the version 3 batch

    Scenario: A caller already at the current version gets nothing to replay
      Given an all-human 2-seat started game at version 3
      When A GETs the log since version 3
      Then the response is 200
      And the body to is 3
      And the body reports no gap
      And the body moves are empty

    Scenario: A non-member may not read the log
      Given an all-human 2-seat started game at version 3
      And C is signed in and bound to no seat in this game
      When C GETs the log since version 0
      Then the response is 403
      And the response carries no moves

  Rule: A remote turn replays move by move

    Scenario: A wake replays the opponent's turn instead of swapping the snapshot
      Given this client is seated at seat 0 of an online game and displays version 4
      And the server holds version 5, produced by three moves from seat 1
      When a stateChanged for version 5 arrives
      Then the client fetches the log since version 4
      And the three moves are applied one at a time in log order
      And each applied move produces effects and a match-log entry
      And the displayed baseline becomes 5

    Scenario: The camera follows each replayed move
      Given this client is seated at seat 0 of an online game and displays version 4
      And auto-focus is on
      And the server holds version 5, produced by two steps from seat 1
      When a stateChanged for version 5 arrives
      Then the replay window opens on the first replayed move
      And a hop is performed for each replayed step
      And the camera is restored once control returns to this client

    Scenario: An online seat that is not ours is spectated
      Given an online game whose seat to move is bound to another user
      Then that seat is spectated

    Scenario: Our own online seat is not spectated
      Given an online game whose seat to move is bound to this client's user
      Then that seat is not spectated

    Scenario: A server-run heuristic seat online is spectated
      Given an online game whose seat to move is a heuristic seat
      Then that seat is spectated

  Rule: Cold start shows the current position

    Scenario: Opening a game from a fresh load installs the snapshot
      Given this client displays nothing and the server holds version 7
      When the client opens the game from its hash route
      Then the snapshot for version 7 is installed
      And no moves are fetched
      And the displayed baseline becomes 7
