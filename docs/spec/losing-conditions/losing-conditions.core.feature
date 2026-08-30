# language: en
# Overview: docs/spec/losing-conditions/losing-conditions.md
# SPEC §9 victory (headline repealed), §8 mandatory starting territory, §7 closure

Feature: A seat that can never claim again is out, and it vanishes
  As a player still contesting a match
  I want a seat that has lost to leave the board
  So that the match ends on the axis it was contested on, not on a stalemate

  Background:
    Given a GameState with players A, B and C, and a GeometryPort and RulesPort
    # P37: "loss is evaluated only when endTurn hands the seat back to the first
    # player" stood here and is repealed — a loss now resolves on the move that
    # causes it. Every scenario below that said "when the round closes" is a
    # boundary case only because its Given makes it one, not because resolution
    # waits. See docs/spec/immediate-loss/immediate-loss.md.

  Rule: Owning no territory is a loss

    Scenario: A player whose last territory is carved away is lost on the carving move
      Given A owns one territory arrow and two heads
      And B closes a loop that claims A's last territory arrow
      When B takes that step
      Then A is lost
      And A has no heads on the board
      And A has no trail marks
      And A owns no territory

    Scenario: A player with heads and no territory is lost
      Given A owns no territory and holds three heads
      When the round closes
      Then A is lost

    Scenario: The vacated territory becomes unowned, not the claimant's
      Given A owns territory, no spawner share and no heads
      When the round closes
      Then those arrows are owned by nobody
      And their accumulators are reset

    Scenario: Losing leaves every other seat untouched
      Given A owns no territory, and B and C each own territory, heads and trails
      When the round closes
      Then B's heads, trails and territory are unchanged
      And C's heads, trails and territory are unchanged

  Rule: Territory but no income starts a clock, not a loss

    Scenario: A destitute player with heads is not lost
      Given A owns territory, holds heads, and owns no spawner share
      When the round closes
      Then A is not lost
      And A's starvation streak is 1

    Scenario: The streak advances each full round
      Given A owns territory and heads and no spawner share
      When four rounds close
      Then A's starvation streak is 4
      And A is not lost

    Scenario: Reaching the threshold loses the seat
      Given the starvation threshold is 5
      And A owns territory and heads and no spawner share
      When five rounds close
      Then A is lost
      And A has no heads on the board

    Scenario: Owning a share again clears the clock
      Given A has a starvation streak of 3
      When A comes to own a spawner share
      And the round closes
      Then A's starvation streak is 0

  Rule: Territory but no units is a loss only without income

    Scenario: No heads and no share is an immediate loss
      Given A owns territory, no spawner share and no heads
      When the round closes
      Then A is lost

    Scenario: No heads but a share stays alive
      Given A owns a spawner share and no heads
      When the round closes
      Then A is not lost
      And A's starvation streak is 0

    Scenario: A headless seat with a share is paid and resumes
      Given A owns a spawner share and no heads
      And that share's accumulator will cross a whole head this round
      When the round closes
      Then A holds one head
      And A is not lost

    Scenario: A headless seat takes no action while it waits
      Given A owns a spawner share and no heads
      When it is A's turn
      Then A has no legal move
      And the turn passes without applying anything

  Rule: Destitution is per seat

    Scenario: Two destitute seats both advance
      Given A and B each own territory and heads and no spawner share
      When the round closes
      Then A's starvation streak is 1
      And B's starvation streak is 1

    Scenario: Neither destitute seat clears the other
      Given A and B are both destitute
      When four rounds close
      Then A's starvation streak is 4
      And B's starvation streak is 4

    Scenario: One seat leaving destitution does not clear the other
      Given A and B are both destitute with a streak of 2
      When B comes to own a spawner share
      And the round closes
      Then B's starvation streak is 0
      And A's starvation streak is 3

    Scenario: Two destitute seats reaching the threshold both go
      Given the starvation threshold is 5
      And A and B are both destitute
      When five rounds close
      Then A is lost
      And B is lost

  Rule: The match ends when one seat remains

    Scenario: Losing the second-to-last seat wins the match
      Given A and B are the only seats not lost
      And B owns no territory
      When the round closes
      Then B is lost
      And the winner is A

    Scenario: No winner while two seats remain
      Given A, B and C are all playing
      And C owns no territory
      When the round closes
      Then C is lost
      And there is no winner

    Scenario: The winner is never chosen by seat order
      Given a six seat match in which one seat starves out
      When that seat is lost
      Then the winner is unset unless exactly one seat remains

  # ~~Rule: Loss resolves at the boundary and nowhere else~~ — **repealed by P37.**
  # This Rule and its three scenarios (*A step does not evaluate loss*, *A convert
  # does not evaluate loss*, and one for the move kind P51 later deleted) asserted the exact
  # opposite of what the engine now does, and their tests were deleted rather than
  # inverted. The replacements live in
  # `docs/spec/immediate-loss/immediate-loss.core.feature` under *A loss resolves
  # on the move that causes it*, and in invariants 1, 2 and 5 of
  # `docs/spec/immediate-loss/immediate-loss.md`.
  #
  # Struck rather than deleted because the trail matters: this was a deliberate
  # P36 decision, made for a stated reason (a boundary is the only place the
  # four-case table is unambiguous), and a real playtest disproved it — the win
  # arrived four moves and three end-turns after the deciding closure. Losing that
  # history would make the reversal look like carelessness rather than evidence.

    Scenario: Capturing a share before the boundary clears the clock
      Given A has a starvation streak of one below the threshold
      And A has come to own a spawner share
      And a spawner will pay that share this round
      When the round closes
      Then A is not lost
      And A's starvation streak is 0
      And A is paid a head on that share

  Rule: The rotation is never rewritten

    Scenario: A lost seat stays in the player list
      Given A is lost
      Then state.players still lists A, in its original position

    Scenario: The player list is never reordered
      Given several seats are lost across many rounds
      Then state.players is unchanged throughout

    Scenario: The round boundary still fires when the first seat is lost
      Given A is the first seat in the player list and A is lost
      When play continues
      Then the round boundary still fires
      And spawners still accrue
