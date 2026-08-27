# language: en
# Overview: docs/spec/online-game-library/online-game-library.md
# ADR 0002, packet P45

Feature: Online game library — boundaries
  As the operator
  I want library status cheap, caller-private, and fail-closed
  So that a family playtest can find the right match without a Dynamo scan

  Background:
    Given ADR 0002 is accepted
    And Google ID tokens verify against a fake verifier in tests
    And S3 is a fake store
    And GIS, fetch, WebSocket, and sessionStorage are fakes in the shell tests

  Rule: Elimination and unwon terminals

    Scenario: Eliminated seat while the match continues is lost
      Given a started 3-seat game with humans A and B bound
      And state is persisted with no winner, B in lostPlayers, and A to move
      When GET /my-games with B's bearer
      Then that game's status is lost
      When GET /my-games with A's bearer
      Then that game's status is your-turn

    Scenario: Terminal unwon board reports lost for a lost caller
      Given a started 3-seat game with humans A and B bound
      And state is persisted with no winner and both A and B in lostPlayers
      When GET /my-games with A's bearer
      Then that game's status is lost
      And that game's status is not waiting

  Rule: Legacy meta and listing cost

    Scenario: Unstamped meta classifies from state.json
      Given a started game whose meta.json has seats and no library summary
      And state.json has A to move and no winner
      When GET /my-games with A's bearer
      Then that game's status is your-turn
      And fake S3 gained no new keys
      And fake S3 keys were not overwritten

    Scenario: GET /my-games does not write S3
      Given a started game with a stamped library summary
      When GET /my-games with A's bearer
      Then the response is 200
      And fake S3 gained no new keys
      And fake S3 keys were not overwritten

  Rule: Sort and membership

    Scenario: Rows sort by status then group then newest game number
      Given A's /my-games would include
        | groupHash | gameNumber | status    |
        | Gbbb      | 000001     | your-turn |
        | Gaaa      | 000002     | lost      |
        | Gaaa      | 000001     | won       |
        | Gbbb      | 000002     | waiting   |
      When GET /my-games with A's bearer
      Then the started rows are in order Gbbb/000001, Gbbb/000002, Gaaa/000001, Gaaa/000002

    Scenario: Open lobby tokens stay on lobbies not as game statuses
      Given A has an open lobby token T and a started game 000001
      When GET /my-games with A's bearer
      Then lobbies lists T
      And games lists 000001 with a status
      And no game row uses T as a gameNumber

    Scenario: Other user's games are omitted
      Given a started game bound to A and B
      When GET /my-games with C's bearer
      Then games does not list that groupHash
      And the body does not contain a Google sub

    Scenario: Missing bearer is 401
      When GET /my-games without a bearer
      Then the response is 401

  Rule: Active heuristic and missing chair

    Scenario: Heuristic to move is waiting for every human
      Given a started 3-seat game with humans A and B and one heuristic
      And state is persisted with the heuristic seat to move and no winner
      When GET /my-games with A's bearer
      Then that game's status is waiting
      When GET /my-games with B's bearer
      Then that game's status is waiting

    Scenario: Caller with no chair on the game is waiting
      Given a started game listed under A's group pointer whose seats do not bind A
      When GET /my-games with A's bearer
      Then that game's status is waiting

  Rule: Adapter and shell chrome

    Scenario: Malformed status fails the library parse
      Given a /my-games body whose game row status is "open"
      When the adapter parses that body
      Then parseMyGames returns undefined

    Scenario: Missing status fails the library parse
      Given a /my-games body whose game row has groupHash and gameNumber only
      When the adapter parses that body
      Then parseMyGames returns undefined

    Scenario: Sign-out clears the library
      Given A is signed in and GET /my-games has listed a game
      When A signs out
      Then the adapter myGames is undefined

    Scenario: Local mode does not offer My games
      Given A is signed in
      And lobby mode is Local
      Then the shell does not offer the My games control

    Scenario: Unsigned Online does not offer My games
      Given lobby mode is Online
      And the player has no session token
      Then the shell does not offer the My games control

    Scenario: Finished library row still opens the game
      Given A is signed in
      And GET /my-games lists group G game 000001 with status won
      When A opens that row
      Then the hash is #/g/G/000001
      And the adapter GETs that game

    Scenario: Lost beats your-turn when the vanished seat is still named active
      Given a started game with humans A and B bound
      And state is persisted with no winner, A in lostPlayers, and activePlayer A
      When GET /my-games with A's bearer
      Then that game's status is lost
      And that game's status is not your-turn
