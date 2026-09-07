# language: en
# Overview: docs/spec/byok-batch-turn/byok-batch-turn.md
# Adapter only — win, caps, not-ready, runner, probe, purity

Feature: BYOK batch turn — win, caps, seams, purity
  As the web adapter
  I want empty prefix to be the only greedy fallback, and never to honour endTurn on an illegal tail
  So that a truncated or shuttle-heavy reply cannot skip the re-prompt or silently call beam-v1

  Background:
    Given a GeometryPort and a RulesPort
    And an injected fetch that returns mocked chat/completions JSON

  Rule: Mid-batch win and completion caps

    Scenario: Mid-batch win stops without endTurn and is not a fallback
      Given a constructed board where one legal offer step sets winner
      And the mock reply is {"moves":[win, extra],"endTurn":true} with win that index
      When playLlmBotTurn runs
      Then the applied moves are that winning step only
      And endTurn was not applied
      And extra was not applied
      And fetch was called once
      And llmHits is 1
      And llmFallbacks is 0
      And the returned state's winner is set

    Scenario: Eighth completion warns; sixty-four completions then still active force endTurn
      Given a constructed board on which nonempty prefixes can be applied for many completions
      And each mock reply is a one-step batch with "endTurn": false
      When playLlmBotTurn runs
      Then console.warn fired once when the 8th completion was issued
      And that warning is not a fallback
      And fetch was called at most 64 times
      And if the seat was still active with no winner after those completions, endTurn was forced
      And llmFallbacks is 0

  Rule: not-ready, runner, lobby probe

    Scenario: not-ready config calls playBotTurn beam-v1 not the batch protocol
      Given a ByokConfig that is not ready
      And a playing GameState whose active player is the BYOK seat
      When playLlmBotTurn runs
      Then the returned moves equal playBotTurn on that state
      And fetch was not called
      And chooseMove was not used as the empty-prefix remainder
      And llmHits is 0
      And llmFallbacks is 0
      And lastError is byok not ready

    Scenario: useTurnRunner true still does not call the runner
      Given a ready ByokConfig with useTurnRunner true and a turnRunnerUrl
      And a playing GameState whose active player is the BYOK seat
      And the mock reply is a listed pass {"moves":[],"endTurn":true}
      When playLlmBotTurn runs
      Then fetch was not called with a /v1/pick URL
      And fetch was called with a chat/completions request
      And llmHits is 1

    Scenario: testByokConnection still accepts a move-0 probe
      Given a ready ByokConfig
      And the mock reply is {"move":0,"why":"probe"}
      When testByokConnection runs
      Then the probe is ok
      And the request is not the batch contract

  Rule: Determinism, Pages, greedy remainder after a good prefix

    Scenario: Same state and same mock replies yield byte-identical Move lists
      Given a playing GameState whose active player is the BYOK seat
      And a fixed sequence of mock batch replies
      When playLlmBotTurn runs twice
      Then both returned Move lists are byte-identical
      And the offer order is legalMoves step order
      And packages/web/src/byokBot.ts chooser paths do not mention Date.now, Math.random, or performance.now

    Scenario: Pages heuristic still imports chooseMove
      Then packages/online-api/src/pages-heuristic.ts imports chooseMove
      And it does not import chooseTurnBeam
      And it does not import playLlmBotTurn

    Scenario: HTTP failure is empty prefix with no extract retry
      Given a ready ByokConfig
      And a playing GameState whose active player is the BYOK seat
      And fetch rejects or returns a non-OK HTTP status
      When playLlmBotTurn runs
      Then the remaining seat-turn is the greedy-v1 plan from that state
      And fetch was called once
      And there was no second extract-retry POST
      And llmFallbacks is 1
      And lastError contains no API key

    Scenario: Unusable second completion after a good prefix falls back once
      Given a playing GameState whose active player is the BYOK seat
      And the first mock reply applies a nonempty prefix with "endTurn": false
      And a legal step still remains
      And the second mock reply is unusable JSON
      When playLlmBotTurn runs
      Then the prefix steps are in the applied list
      And the remainder after the prefix equals greedy-v1 from that post-prefix state
      And fetch was called twice
      And chooseTurnBeam was not called
      And llmHits is 0
      And llmFallbacks is 1

    Scenario: Empty offer forces endTurn without a POST
      Given a playing GameState whose active player is the BYOK seat
      And legalMoves offers no step
      When playLlmBotTurn runs with a ready config
      Then the applied moves are endTurn only
      And fetch was not called
      And llmHits is 1
      And llmFallbacks is 0
