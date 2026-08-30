# language: en
# Overview: docs/spec/ai-move-playback/ai-move-playback.md
# Adapter only — local AI playback, not a game rule

Feature: Local AI move playback — order with a gap
  As a player watching a local AI seat
  I want each planned move to appear in order with a short pause between them
  So that I can see the sequence of cuts and steps

  Background:
    Given a RulesPort
    And a start GameState
    And an injected sleep and a cancelled flag

  Rule: Playback is sequential

    Scenario: Planned moves apply in listed order
      Given a planned list of three legal moves
      When applyMovesSequentially runs to completion
      Then onApplied is called three times
      And the moves are the planned list in order

    Scenario: Sleep between consecutive moves, not after the last
      Given a planned list of three legal moves
      And gapMs is 400
      When applyMovesSequentially runs to completion
      Then sleep is called twice
      And each sleep is 400
      And there is no sleep after the last onApplied

    Scenario: First move applies before any inter-move sleep
      Given a planned list of two legal moves
      When applyMovesSequentially runs
      Then the first onApplied happens before the first sleep

    Scenario: Empty list is a no-op
      Given an empty planned list
      When applyMovesSequentially runs
      Then onApplied is never called
      And sleep is never called
      And the returned state is the start state

    Scenario: Single-move turn does not sleep
      Given a planned list of one legal move
      When applyMovesSequentially runs to completion
      Then onApplied is called once
      And sleep is never called

  Rule: The chair key starts playback, not occupancy

    Scenario: Local AI chair key is the active AI player
      Given a playing GameState whose active player is an AI seat
      And play is not online
      Then localAiChairKey is that player's id

    Scenario: Occupancy change does not change the chair key
      Given two playing GameStates with the same active AI player
      And they differ only in which arrows hold groups
      Then both chair keys are equal

    Scenario: Playback of a planned turn matches folding apply
      Given a real planned BotTurn from playBotTurn
      When applyMovesSequentially plays that move list from the same start
      Then the returned state equals folding rules.apply over those moves
      And it equals the planner's final state
