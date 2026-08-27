# language: en
# Overview: docs/spec/online-game-library/online-game-library.md
# ADR 0002, packet P45

Feature: Online game library statuses
  As a Google-signed-in player
  I want my started games listed as won, lost, waiting, or my turn
  So that I can open the match that actually needs me

  Background:
    Given ADR 0002 is accepted
    And Google ID tokens verify against a fake verifier in tests
    And S3 is a fake store
    And GIS, fetch, WebSocket, and sessionStorage are fakes in the shell tests

  Rule: Caller-relative status

    Scenario: Active human sees your-turn and the other human sees waiting
      Given a started 3-seat game with humans A and B bound and one heuristic
      And state is persisted with A to move and no winner
      When GET /my-games with A's bearer
      Then the response is 200
      And that game's status is your-turn
      When GET /my-games with B's bearer
      Then that game's status is waiting

    Scenario: Winner sees won and the other human sees lost
      Given a started 3-seat game with humans A and B bound
      And state is persisted with winner A
      When GET /my-games with A's bearer
      Then that game's status is won
      When GET /my-games with B's bearer
      Then that game's status is lost

    Scenario: Start before first GET is waiting for both humans
      Given A and B are bound on an open invite
      And POST start has written meta only
      When GET /my-games with A's bearer
      Then that game's status is waiting
      When GET /my-games with B's bearer
      Then that game's status is waiting

  Rule: Persist stamps the summary

    Scenario: Persist writes library fields onto game meta
      Given a started 3-seat game with humans A and B bound
      When a persist writes state.json with A to move and no winner
      Then that game's meta.json includes players, activePlayer A, and lostPlayers
      And that game's meta.json still includes seats
      And that game's meta.json has no winner field

    Scenario: Persist that sets a winner also stamps winner on meta
      Given a started 3-seat game with humans A and B bound
      When a persist writes state.json with winner A
      Then that game's meta.json winner is A
      And that game's meta.json includes players, activePlayer, and lostPlayers

  Rule: Shell list

    Scenario: Signed-in Online offers My games with status labels
      Given A is signed in in Online mode
      And GET /my-games lists one game with status your-turn and number 000001
      Then the shell offers the My games control
      And the My games copy is "My games"
      And libraryStatusLabel of your-turn is "Open (your turn)"
      And the formatted row is "Open (your turn) · 000001"

    Scenario: Opening a library row still resumes the game hash
      Given A is signed in
      And GET /my-games lists group G game 000001 with status waiting
      When A opens that row
      Then the hash is #/g/G/000001
      And the adapter GETs that game

    Scenario: Empty library uses the empty copy
      Given A is signed in in Online mode
      And GET /my-games lists no started games
      Then the empty-library copy is "No games yet"
