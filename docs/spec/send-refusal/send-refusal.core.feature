# language: en
# Overview: docs/spec/send-refusal/send-refusal.md
# Packet P100 — a refused Send says why and keeps the route, happy path

Feature: A Send that sends nothing says why and keeps the route
  As a player tapping Send in an online game
  I want a refused Send to tell me why and leave my route drawn
  So that a tap is never silently lost

  Rule: Each guard has its own reason (D1)

    Scenario Outline: A guard refuses with its reason and no request
      Given an online game where <guard>
      When the player submits a move
      Then the outcome is "<reason>"
      And no POST was made

      Examples:
        | guard                              | reason        |
        | the move list is empty             | no-moves      |
        | a submit is in flight              | sending       |
        | a replay batch is queued           | replaying     |
        | the board has a winner             | game-over     |
        | another seat is to move            | not-your-turn |
        | the route left the game            | no-game       |
        | the token has expired              | signed-out    |

  Rule: No outcome but sent is silent (D2)

    Scenario: Every outcome other than sent has a note
      When the note is read for each outcome
      Then only "sent" has no note

  Rule: The route survives a refusal (D3)

    Scenario: A refused Send restores the drawn route
      Given a drawn route of one step
      When the player taps Send
      And the submit settles as "not-your-turn"
      Then the route phase is back with the same draft and no pending moves
