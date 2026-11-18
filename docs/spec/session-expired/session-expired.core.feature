# language: en
# Overview: docs/spec/session-expired/session-expired.md
# Packet P98 — expired sign-in, happy path

Feature: An expired sign-in looks signed out, and a refused create can be recovered
  As a player whose Google sign-in has lapsed
  I want the lobby to show Sign in, and a create I already asked for to finish after I sign in
  So that an expired token is not a spinner that vanishes

  Background:
    Given the lobby route is open
    And the clock is frozen
    And the host store holds no ID token

  Rule: A usable token is the only signed-in bit (D1)

    Scenario: An expired token reports signed out and offers the chooser
      Given player A's stored token expired one hour ago
      When the host is asked whether A is signed in
      Then the host reports signed out
      And the token is gone
      And session expired is clear
      And the session-expired note is absent
      And the chooser slot is offered

    Scenario: A token one minute from expiry reports signed in
      Given player A's stored token expires in one minute
      When the host is asked whether A is signed in
      Then the host reports signed in
      And the token is still stored
      And the chooser slot is not offered

  Rule: A 401 on create is retried once after the next credential (D3)

    Scenario: A create answered 401 is retried once and then shows the link
      Given player A is signed in with a token an hour from expiry
      And the seat plan is two Players and the invite name is valid
      And POST /invites for that plan answers 401
      And the next credential's POST /invites answers 201 with an invite token
      And GET /my-games for A answers 200 with no games
      When A creates an invite
      Then the promise resolved
      And create is not pending
      And the invite link is absent
      And the create note is absent
      And session expired is set
      And the host reports signed out
      And the token is gone
      And the session-expired note is offered
      And the chooser slot is offered
      And GIS prompt was called once
      When A's new Google credential arrives
      Then the host reports signed in
      And session expired is clear
      And the invite link is shown
      And exactly two POST /invites were sent
      And exactly one GET /my-games was sent

  Rule: Empty is a successful library read (D5)

    Scenario: A library of zero games is empty, not failed
      Given player A is signed in with a token an hour from expiry
      And GET /my-games for A answers 200 with no games
      When A refreshes My games
      Then the library is not failed
      And session expired is clear
      And My games is empty
      And the load-failed note is absent

  Rule: The seat-plan sentence matches the rule (D7)

    Scenario: One Player and one Agent does not show the seat-plan note
      Given player A is signed in
      And the seat plan is one Player and one Agent
      Then the seat-plan note is absent
