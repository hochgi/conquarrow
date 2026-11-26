# language: en
# Overview: docs/spec/send-self-heal/send-self-heal.md

Feature: Edge cases of the Send self-heal

  Rule: A hold heals only on a valid session

    Scenario: /me 401 keeps the hold
      Given a hold and a usable token
      When /me answers 401
      Then the outcome is "held" and nothing is posted

    Scenario: /me for another user drops the hold
      Given a hold made by alice
      When /me answers bob
      Then the outcome is "held-dropped"

    Scenario: The held POST is refused again with 401
      Given a hold at version 4 and the board at 4
      When the held POST answers 401
      Then the outcome is "unauthorized" and the hold stays

    Scenario: A poll heals the hold and App reads the outcome once
      Given a hold at the board's version
      When a poll runs
      Then the held moves are posted
      And takeHealOutcome returns "held-sent" once, then nothing

  Rule: The watchdog waits for a real stall

    Scenario: A batch within the stall timeout still refuses
      Given a batch was taken 1 ms short of replayStallMs ago
      When the player taps Send
      Then the outcome is "replaying"

    Scenario: After a flush the next Send goes through
      Given a stalled batch was flushed and App installed the snapshot
      When the player taps Send again
      Then the moves are posted

    Scenario: A poll flushes a stalled batch
      Given a stalled batch
      When a poll runs
      Then nothing is queued or in flight

    Scenario: The stall timeout is configurable
      Given replayStallMs is 5 seconds
      Then a batch untouched for 5 seconds is stalled

  Rule: The not-your-turn re-check

    Scenario: A newer version after the re-check answers stale
      Given the server says it is the caller's turn at a newer version
      Then the outcome is "stale" and nothing is posted

    Scenario: Still another seat's turn
      Given the re-check still says another seat is to move
      Then the outcome is "not-your-turn" and /me and the game were read once each
