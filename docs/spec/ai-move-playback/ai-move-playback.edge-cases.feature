# language: en
# Overview: docs/spec/ai-move-playback/ai-move-playback.md
# Cancel, online, purity

Feature: Local AI move playback — cancel and seams
  As the web adapter
  I want playback to stop when the chair leaves and never invent a clock
  So that lobby, unmount, and Strict Mode cannot keep applying after cancel

  Background:
    Given a RulesPort
    And a start GameState
    And an injected sleep and a cancelled flag

  Rule: Cancel stops leftover applies

    Scenario: Cancel before first apply leaves start unchanged
      Given a planned list of two legal moves
      And cancelled is already true
      When applyMovesSequentially runs
      Then onApplied is never called
      And sleep is never called
      And the returned state is the start state

    Scenario: Cancel during a gap does not apply later moves
      Given a planned list of three legal moves
      And cancelled becomes true after the first onApplied, during the first sleep
      When applyMovesSequentially runs
      Then onApplied was called once
      And the second and third moves are not applied

  Rule: No local playback chair when it is not a local AI turn

    Scenario: Online play has no local AI chair
      Given a playing GameState whose active player is marked AI
      And play is online
      Then localAiChairKey is null

    Scenario: Winner has no local AI chair
      Given a GameState whose winner is set
      And the active player is an AI seat
      And play is not online
      Then localAiChairKey is null

    Scenario: Human seat has no local AI chair
      Given a playing GameState whose active player is not an AI seat
      And play is not online
      Then localAiChairKey is null

  Rule: Purity / adapter seams

    Scenario: Sleep is injected; helper does not call a clock
      Then packages/web/src/botPlayback.ts does not mention Date.now, Math.random, or setTimeout

    Scenario: Equal start and moves yield equal intermediate states
      Given the same start GameState and the same planned list
      When applyMovesSequentially runs twice with a recording sleep
      Then both runs produce the same sequence of after-states
