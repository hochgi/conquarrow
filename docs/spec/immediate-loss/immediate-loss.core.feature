# language: en
# Overview: docs/spec/immediate-loss/immediate-loss.md
# SPEC §9 loss timing, §11 item 44 (resolved by dissolution)

Feature: A loss resolves on the move that causes it
  As a player who has just made the winning move
  I want the match to end on that move
  So that the game never asks me to keep playing a decided position

  Background:
    Given a GameState with players A, B and C, a GeometryPort and a RulesPort
    And each player owns territory, a spawner share and heads

  Rule: The deciding move ends the match

    # Not "B and C are already lost" — a lost seat owns nothing, and if both were
    # lost A has already won, which makes the step irrelevant.
    Scenario: A closure taking the last enemy territory wins on that step
      Given B is already lost
      And C's last territory lies inside a loop A can close in one step
      When A takes that step
      Then the winner is A
      And the resolution itself applies no move
      # "And no further move is applied" stood here and was a stronger claim than
      # the engine makes: `legalMoves` never consults `winner`, so a crowned seat
      # keeps its remaining allowance and `apply` accepts the steps. No adapter
      # reaches it — `App.tsx` locks input on `winner !== undefined` — but the core
      # is not total on it. Opened as SPEC §11 item 46 rather than decided here.

    Scenario: The losing seat's pieces are gone in the state that step returns
      Given A is one step from taking C's last territory
      When A takes that step
      Then C holds no heads
      And C has no trail marks
      And C owns no territory

    Scenario: A lost seat never takes another turn
      Given A takes the step that costs C its last territory
      When play continues to what would have been C's turn
      Then C has no legal move
      And the turn passes without applying anything

    Scenario: The winner is set before the turn is ended
      Given A is one step from winning
      When A takes that step
      Then the winner is set
      And the winner was set without an end of turn

  Rule: Losses resolve after every kind of move

    Scenario Outline: Each move kind resolves losses
      Given a player who will hold no territory once <move> is applied
      When <move> is applied
      Then that player is lost in the state it returns

      Examples:
        | move        |
        | a step      |
        | an end turn |

    Scenario: A mid-turn loss leaves the mover's allowance alone
      Given A has allowance for three steps
      And A's first step costs C its last territory
      When A takes that step
      Then C is lost
      And A still has allowance for two steps

    Scenario: A mid-turn loss changes the board the mover sees
      Given A has allowance remaining
      And A's step costs C its last territory
      When A takes that step
      Then C's heads are absent from the board A now moves on

  Rule: Timing moved, outcomes did not

    Scenario: The same seats are lost over a whole match
      Given a match log that loses three seats
      When the log is replayed
      Then the same three seats are lost
      And each is lost on the move that caused it rather than at the next boundary

    Scenario: The reported playtest log is a P47 prefix golden
      Given the match log conquarrow-match-2026-08-20T142811-462Z
      When it is replayed
      Then the replay refuses at move 233
      And the adapter still records D as the winner of that session
      And the fold never reaches the deciding move
      # P47 extra evaporation; P28 then refuses the recorded step. The
      # deciding-win claim is the scenario above (three seats lost on a
      # hand-authored match), not this log.

    Scenario: A starvation loss still waits for the boundary
      Given a player has been destitute for one round short of the threshold
      When that player takes a step
      Then that player is not lost
      When the round closes
      Then that player is lost

    Scenario: Streaks advance only at a boundary
      Given a destitute player
      When several steps are applied without ending a round
      Then that player's starvation streak is unchanged

    Scenario: The boundary still accrues before it resolves
      Given a headless player owning a share whose accumulator crosses a head this round
      When the round closes
      Then that player holds a head
      And that player is not lost

  Rule: Some seat is always alive

    Scenario: Every seat opens owning a share
      Given a freshly set up match
      Then every player owns at least one spawner share

    Scenario: A vacated arrow is never a share
      Given a player becomes lost
      Then no arrow that player vacated borders a spawner

    Scenario: Territory changes hands rather than becoming unowned by a claim
      Given a closure claims enemy territory
      Then every claimed arrow has an owner

    Scenario: Some player owns a share in every state of a replay
      Given a match log that loses several seats
      When the log is replayed
      Then some player owns a spawner share in every state along the way

    Scenario: At least one seat is never lost
      Given a match log that loses several seats
      When the log is replayed
      Then at least one player is not lost in every state along the way
