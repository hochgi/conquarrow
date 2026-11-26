# language: en
# Overview: docs/spec/online-auth-invites/online-auth-invites.md
# ADR 0002, packet P17

Feature: Online auth, invites, and library
  As a Google-signed-in player
  I want to form a 3- or 6-seat lobby and Start a group
  So that two humans can meet online without a local hot-seat

  Background:
    Given ADR 0002 is accepted
    And Google ID tokens verify against a fake verifier in tests
    And S3 is a fake store

  Rule: Identity

    Scenario: GET /me returns userHash for a valid bearer
      Given a valid Google ID token whose sub is "alice-sub"
      When GET /me with that bearer
      Then the response is 200
      And the body userHash is truncate16 of SHA-256 of "alice-sub"
      And the body does not contain sub

  Rule: Create and peek

    Scenario: Creator opens a 3-seat lobby with two humans
      Given a valid Google ID token for user A
      When POST /invites with seats creator, human, heuristic
      Then the response is 201
      And the body includes an invite token
      And seat 0 is human bound to A's userHash
      And seat 1 is human unbound
      And seat 2 is heuristic
      And fake S3 holds conquarrow/invites/<token>.json
      And fake S3 holds A's lobby pointer for that token
      And fake S3 holds no group or game objects

    Scenario: Unauthenticated GET shows an open invite
      Given an open invite created by A with seats human, human, heuristic
      When GET /invites/:token without a bearer
      Then the response is 200
      And the body shows those three seats and A's binding
      And the body does not contain a Google sub

  Rule: Accept and Start

    Scenario: Second human accepts the next unbound chair
      Given an open 3-seat invite by A with seats human, human, heuristic
      And a valid Google ID token for user B
      When POST /invites/:token/accept with B's bearer
      Then the response is 200
      And B occupies seat 1
      And fake S3 holds B's lobby pointer for that token

    Scenario: Open lobby appears on the seated users' /my-games
      Given A created an open invite and B has accepted
      When GET /my-games with A's bearer
      Then the response is 200
      And the body lists that token as an open lobby
      When GET /my-games with B's bearer
      Then the body lists that token as an open lobby

    Scenario: Start materialises group and game meta for both humans
      Given an open 3-seat invite with humans A and B bound and one heuristic
      When POST /invites/:token/start with A's bearer
      Then the response is 200
      And groupHash is truncate16 of SHA-256 of A's and B's userHashes sorted joined by newline
      And game number 000001 exists under that group
      And game meta seats match the invite
      And fake S3 has no state.json and no log.jsonl
      When GET /my-games with A's bearer
      Then the body lists that group and game 000001
      And the body does not list the token as an open lobby
      When GET /my-games with B's bearer
      Then the body lists that group and game 000001
