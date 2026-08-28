# language: en
# Overview: docs/spec/bot-pause/bot-pause.md
# Adapter only — local bot pause, not a game rule

Feature: Hold local bot seats without ending the match
  As a player watching local heuristic or BYOK seats
  I want to pause their decisions, and have all-bot matches pause when I leave the tab
  So that an unattended tab cannot burn quota overnight

  Background:
    Given a local match with at least one non-human seat

  Rule: Pause is offered on local vs-bot

    Scenario: Pause is offered on a local vs-bot match that is not over
      Given vsBot is true
      And play is not online
      And the match has no winner
      And this is not the tutorial
      Then pauseOffered is true
      And the Pause button label is Pause

    Scenario: Manual pause holds bots until Resume
      Given pauseOffered is true
      And manual is false
      When the operator clicks Pause
      Then botsHeld is true
      And pauseKind is manual
      And the button label is Resume

    Scenario: Resume releases a manual hold
      Given manual is true
      And the tab is focused
      When the operator clicks Resume
      Then botsHeld is false
      And pauseKind is running
      And the button label is Pause

    Scenario: All-bot unfocused tab is idle-paused
      Given every seat is heuristic or byok
      And manual is false
      And the watching tab is not focused
      Then idlePaused is true
      And botsHeld is true
      And pauseKind is idle
      And the button label is Pause

    Scenario: Mixed match does not idle-pause on blur
      Given at least one human seat
      And the watching tab is not focused
      And manual is false
      Then idlePaused is false
      And botsHeld is false
      And pauseKind is running
