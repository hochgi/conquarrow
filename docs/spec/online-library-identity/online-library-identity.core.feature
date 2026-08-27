# language: en
# Overview: docs/spec/online-library-identity/online-library-identity.md
# ADR 0002, packet P46

Feature: Library row identity
  As a Google-signed-in player
  I want each My games row to show who I am playing, when it started, and my colour
  So that two waiting 000001 matches are not identical

  Background:
    Given ADR 0002 is accepted
    And Google ID tokens verify against a fake verifier in tests
    And S3 is a fake store
    And GIS, fetch, WebSocket, and sessionStorage are fakes in the shell tests

  Rule: Opponents distinguish groups

    Scenario: Two groups both numbered 000001 differ on the vs-line
      Given A is bound with B and a heuristic in group G1 game 000001
      And A is bound with C and a heuristic in group G2 game 000001
      And B's profile displayName is Shalev
      And C's profile displayName is Dana
      When GET /my-games with A's bearer
      Then both started rows have gameNumber 000001
      And one vs-line is "Shalev · AI"
      And the other vs-line is "Dana · AI"

    Scenario: Unnamed humans use Player letters
      Given a started 3-seat game with humans A and B and one heuristic
      And neither human has a profile
      When GET /my-games with A's bearer
      Then A's chair is labelled Player A with you true
      And B's chair is labelled Player B with you false
      And the heuristic chair is labelled AI
      And the vs-line is "Player B · AI"

    Scenario: Profile name labels the other human
      Given a started 3-seat game with humans A and B and one heuristic
      And B's profile displayName is Shalev
      When GET /my-games with A's bearer
      Then the vs-line is "Shalev · AI"

  Rule: Colour and time

    Scenario: Caller's seatIndex is their chair
      Given a started game where B occupies seat 1
      When GET /my-games with B's bearer
      Then that row's seatIndex is 1
      And libraryRowTint of 1 is Player B's board fill

    Scenario: Start stamps startedAt onto game meta
      Given the adapter clock is 2026-08-27T09:10:00.000Z
      When A Starts a bound lobby
      Then that game's meta.json startedAt is 2026-08-27T09:10:00.000Z
      When GET /my-games with A's bearer
      Then that row's startedAt is 2026-08-27T09:10:00.000Z
      And formatLibraryStartedAt of that value is "27 Aug 2026, 09:10 UTC"

    Scenario: Shell first line stays status and game number
      Given a library row with status waiting, gameNumber 000001, vs-line "Shalev · AI"
      Then formatLibraryRow of waiting and 000001 is "Open (waiting) · 000001"
      And libraryVsLine of those seats is "Shalev · AI"
