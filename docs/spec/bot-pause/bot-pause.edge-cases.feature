# language: en
# Overview: docs/spec/bot-pause/bot-pause.md
# Adapter only — local bot pause, not a game rule

Feature: Pause edges — online, tutorial, human chair, cancel
  As a player
  I want pause not to freeze the wrong surface
  So that a human can still move, and online or tutorial play is untouched

  Background:
    Given the pause helpers in packages/web/src/botPause.ts

  Rule: Pause is not offered where it cannot help

    Scenario: Online play does not offer Pause
      Given vsBot is true
      And play is online
      Then pauseOffered is false

    Scenario: A finished match does not offer Pause
      Given vsBot is true
      And the match has a winner
      Then pauseOffered is false

    Scenario: Tutorial does not offer Pause
      Given vsBot would otherwise be true
      And this is the tutorial
      Then pauseOffered is false

    Scenario: Hotseat with no bots does not offer Pause
      Given vsBot is false
      Then pauseOffered is false

  Rule: Holds compose without trapping a human

    Scenario: Manual pause outranks idle
      Given all-bot
      And the tab is not focused
      And manual is true
      Then pauseKind is manual
      And the button label is Resume

    Scenario: Returning focus does not clear a click-pause
      Given manual is true
      And the tab is focused
      Then botsHeld is true
      And pauseKind is manual

    Scenario: Empty roster is not all-bot
      Given no seat kinds
      Then isAllBot is false
      And idlePaused is false even if the tab is unfocused

    Scenario: Human chair stays playable while bots are held
      Given a mixed match with a human chair active
      And botsHeld is true
      And botBusy is false
      And the match is not over
      Then turnControlsLocked is false

    Scenario: AI chair stays locked while held
      Given an AI chair is active
      And botsHeld is true
      And botBusy is false
      And the match is not over
      Then turnControlsLocked is true

    Scenario: Online all-bot does not idle-pause on blur
      Given every seat is heuristic or byok
      And play is online
      And the watching tab is not focused
      And manual is false
      Then idlePaused is false
      And pauseKind is running
      Given a playing local AI chair
      And botsHeld is true
      Then the chair key used for playback is null
