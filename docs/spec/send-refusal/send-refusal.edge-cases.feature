# language: en
# Overview: docs/spec/send-refusal/send-refusal.md
# Packet P100 — edge cases

Feature: Refusal edge cases

  Rule: The first failing guard wins (D1)

    Scenario: Online not configured outranks everything
      Given every guard fails
      Then the reason is "not-ready"

    Scenario: A finished game outranks another seat's turn
      Given the board has a winner and another seat is to move
      Then the reason is "game-over"

    Scenario: In flight outranks held
      Given a submit is in flight and a submit is held
      Then the reason is "sending"

    Scenario: Every guard passing is no reason
      Given every guard passes
      Then there is no reason

  Rule: illegal shows one sentence (D2)

    Scenario: The host's 422 note is the illegal sentence
      Given a POST answered 422
      Then the host's illegal note equals the note for "illegal"

  Rule: What reached the server clears the route (D3)

    Scenario Outline: An outcome that reached the server clears
      Then the draft decision for "<outcome>" is "clear"

      Examples:
        | outcome      |
        | sent         |
        | illegal      |
        | stale        |
        | forbidden    |
        | failed       |
        | unauthorized |

    Scenario: A restore after the player moved on does nothing
      Given a drawn route that was sent
      And the player clicked the background before the submit settled
      When the shell restores the sent route
      Then the mode is idle with no draft

    Scenario: A restore is one-shot
      Given a sent route that was restored once
      When the shell restores again
      Then the mode is idle with no draft

    Scenario: End turn has nothing to restore
      Given the player requested End turn
      When the shell restores the sent route
      Then the mode is idle with no draft and no pending moves
