# language: en
# Overview: docs/spec/online-library-identity/online-library-identity.md
# ADR 0002, packet P46

Feature: Library row identity — boundaries
  As the operator
  I want names and times without leaking Google identity
  So that a family list is readable and the cheap-async store stays tiny

  Background:
    Given ADR 0002 is accepted
    And Google ID tokens verify against a fake verifier in tests
    And S3 is a fake store

  Rule: Privacy and fallbacks

    Scenario: Library seats omit sub, email, and userHash
      Given a started game with humans A and B bound
      When GET /my-games with A's bearer
      Then no library seat includes userHash
      And the body does not contain a Google sub
      And the body does not contain an email

    Scenario: Empty display name falls back to Player letter
      Given a started game with humans A and B bound
      And B's profile displayName is "   "
      When GET /my-games with A's bearer
      Then B's chair is labelled Player B

    Scenario: given_name wins over name
      Given A's Google token has given_name Gilad and name "Gilad Hoch"
      When GET /my-games with A's bearer
      Then A's profile displayName is Gilad

    Scenario: Display name longer than 40 characters is truncated
      Given A's Google token has given_name of 41 "x" characters
      When GET /my-games with A's bearer
      Then A's profile displayName is 40 "x" characters

  Rule: Missing time and parse

    Scenario: Pre-P46 meta omits startedAt
      Given a started game whose meta.json has no startedAt
      When GET /my-games with A's bearer
      Then that row has no startedAt field
      And formatLibraryStartedAt of undefined is undefined

    Scenario: Persist of state.json keeps startedAt on meta
      Given a started game whose meta.json startedAt is 2026-08-27T09:10:00.000Z
      When a persist writes state.json
      Then that game's meta.json startedAt is still 2026-08-27T09:10:00.000Z

    Scenario: Missing seats fails the library parse
      Given a /my-games body whose game row has status and gameNumber but no seats
      When the adapter parses that body
      Then parseMyGames returns undefined

    Scenario: Missing seatIndex fails the library parse
      Given a /my-games body whose game row has seats but no seatIndex
      When the adapter parses that body
      Then parseMyGames returns undefined
