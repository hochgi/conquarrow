# language: en
# Overview: docs/spec/send-self-heal/send-self-heal.md
# Packet P104 — a stuck Send heals itself

Feature: A stuck Send heals itself
  As a player online
  I want a Send that was blocked by stale client state to recover by itself
  So that a reload is never the only fix

  Rule: A held submit is sent when the session is valid and the board has not moved

    Scenario: A Send finds a hold at the same version
      Given a submit was held by a 401 at version 4
      And the session token is usable again
      When the player taps Send
      Then the adapter reads /me and the game
      And posts the held moves with their ids and If-Match "4"
      And the outcome is "held-sent"

    Scenario: A hold whose board moved on is dropped and says so
      Given a submit was held at version 4
      And the server is at version 6
      When the player taps Send
      Then nothing is posted
      And the outcome is "held-dropped"

  Rule: A stalled replay cannot block Send forever

    Scenario: A batch that never finished is flushed after the stall timeout
      Given a replay batch was taken and never displayed
      And replayStallMs have passed with no progress
      When the player taps Send
      Then the queue is cleared and the latest game is read
      And nothing is posted
      And the outcome is "stale"

  Rule: not-your-turn is checked once more before it is final

    Scenario: The re-check finds the caller to move
      Given the adapter thinks another seat is to move
      And the server says it is the caller's turn at the same version
      When the player taps Send
      Then the moves are posted
