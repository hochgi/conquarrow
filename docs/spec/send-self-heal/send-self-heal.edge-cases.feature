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

    Scenario: A heal GET of the held game answers 404
      Given a hold at version 4 and a usable token
      When the heal reads the held game and it answers 404
      Then nothing is posted
      And the hold is not restored
      And the outcome is "no-game"
      And the lobby says the game was deleted

    Scenario: A poll heals a hold whose game was deleted
      Given a hold at version 4 and a usable token
      When a poll reads the held game and it answers 404
      Then nothing is posted
      And the hold is not restored
      And takeHealOutcome returns nothing

    Scenario: A hold off its game is dropped when no board is loaded
      Given a hold and a usable token
      And the hash is not the held game
      And no board is loaded
      When the player taps Send
      Then the hold is dropped
      And nothing of the hold is posted
      And the outcome is "no-game"

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
      Given a stalled batch was flushed
      And App has not reported that batch displayed
      When the player taps Send again
      Then the moves are posted
      And the outcome is not "replaying"

    Scenario: A flush clears a batch that is still queued
      Given a replay batch was queued and not yet taken
      And replayStallMs have passed with no progress
      When the player taps Send
      Then nothing is queued or in flight
      And the outcome is "stale"

    Scenario: A flush off the game route does not read a game
      Given a stalled batch
      And the hash is not a game
      When the player taps Send
      Then nothing is queued or in flight
      And no game is read
      And the outcome is "stale"

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

    Scenario: The re-check finds the game deleted
      Given the re-check reads the game and it answers 404
      Then the outcome is "no-game"
      And nothing is posted
