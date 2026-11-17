# language: en
# Overview: docs/spec/online-reliability/online-reliability.md
# Packet P95 — web edge cases

Feature: The client's reliability edges

  Background:
    Given an online game route for group G, game 1
    And A is signed in and seated, and it is A's turn
    And A's client is showing version 4

  Scenario: A refusal is not retried
    Given the POST is answered 409
    When A submits End turn
    Then exactly one POST is sent

  Scenario: Retries are bounded
    Given every POST is rejected by the network
    When A submits End turn
    Then exactly three POSTs are sent, all with one submit id
    And the outcome is "failed"

  Scenario: A 403 is reported as not your seat
    Given the POST is answered 403
    When A submits End turn
    Then the outcome is "forbidden"
    And the note says the seat is not A's to move

  Scenario: A held submit is dropped on sign-out
    Given A's End turn is held after a 401
    When A signs out
    Then the submit is no longer pending

  Scenario: The poll sends nothing while a submit is in flight
    Given A's End turn POST has not been answered
    When the poll runs
    Then no version read is sent

  Scenario: The poll at the displayed version does nothing more
    Given the version read answers version 4
    When the poll runs
    Then no snapshot or log is read

  Scenario: A token near expiry prompts once
    Given A's token expires in two minutes
    When the page becomes visible twice
    Then GIS is prompted once

  Scenario: The heartbeat pings an open socket
    When the heartbeat runs
    Then the socket is sent {"action":"ping"}

  Scenario: A wake during a submit is left to the reconcile
    Given A's End turn POST has not been answered
    When a wake for version 5 arrives
    Then no snapshot is read until the POST is answered

  # Pins from the P95 mutation review.
  Rule: Pins from the P95 mutation review

    Scenario: Retries wait longer each time
      Given every POST of A's End turn is rejected
      When A submits
      Then the client waits SUBMIT_RETRY_MS, then twice that, between attempts

    Scenario: A held submit resends only what the 401 stopped, from the version it reached
      Given A's first step is answered with version 5 and her second with 401
      When a credential arrives
      Then only the second step is resent, with its own submit id and If-Match version 5

    Scenario: A credential that arrives on another route drops the held submit
      Given A's End turn is held after a 401
      And A has left the game page
      When a credential arrives
      Then nothing is posted and nothing is pending

    Scenario: Opening another game drops the held submit; reopening its own keeps it
      Given A's End turn is held after a 401
      When A reopens the same game, then opens another
      Then the submit is pending after the first and not after the second

    Scenario: A token far from expiry is not refreshed
      Given A's token expires in an hour
      When the page becomes visible
      Then GIS is not prompted

    Scenario: A token exactly the lead away from expiry is refreshed
      Given A's token expires in exactly REAUTH_LEAD_MS
      When the page becomes visible
      Then GIS is prompted once

    Scenario: A token with no readable expiry is not refreshed
      Given A's token is not a JWT
      When the page becomes visible
      Then GIS is not prompted

    Scenario: The poll and resume keep an open socket
      When the poll runs and the page becomes visible
      Then no second socket is opened

    Scenario: A late close of a replaced socket does not forget the new one
      Given a credential replaced A's socket
      When the old socket reports its close
      Then the heartbeat still pings the new socket

    Scenario: The heartbeat with no socket sends nothing
      Given A's socket has closed
      When the heartbeat runs
      Then nothing is sent

    Scenario: The poll does nothing while a submit is held
      Given A's End turn is held after a 401
      When the poll runs
      Then the version is not read

    Scenario: The poll does nothing when the version read fails or says nothing
      When the version read answers 500, then 200 with no numeric version
      Then no snapshot is read

    Scenario: The poll does nothing signed out
      Given A has signed out
      When the poll runs on a game route
      Then the version is not read

# Lobby sign-in is P97, in online-reliability.signin.*.feature.
# It does not share this file's game-route Background.
