# language: en
# Overview: docs/spec/byok-teaching-prompt/byok-teaching-prompt.md
# Adapter only — sync, baseline omit, purity, seams

Feature: BYOK teaching prompt — sync, omit, purity, unchanged seams
  As the web adapter
  I want the teaching file to stay SPEC-faithful and the baseline to stay a suggestion
  So that a stale domination sentence or a T0 order cannot return through a side door

  Background:
    Given a GeometryPort and a RulesPort
    And docs/byok-teaching.md is the teaching file

  Rule: Sync, load, determinism

    Scenario: Teaching file and system prompt stay in lockstep
      When the teaching file is read from disk without fetch
      And buildSystemPrompt runs
      Then the system prompt contains the full teaching file text
      And a teaching file that dropped "speed(N) = 1 + floor(log₂ N)" would fail this suite
      And a teaching file that dropped "starvation" would fail this suite
      And a teaching file that introduced "domination" would fail this suite

    Scenario: Same state yields the same baseline index
      Given makeMatch R=7 homeOffset=5 playerCount=3 spawnerSeed=1
      And me is the active player
      And offer is legalMoves steps
      When buildUserPrompt runs twice
      Then both prompts contain the same baseline index
      And that index is chooseMove's step under movesEqual

    Scenario: Baseline is omitted when it cannot name an offer index
      Given makeMatch R=7 homeOffset=5 playerCount=3 spawnerSeed=1
      And me is the active player
      And offer is legalMoves steps
      When buildUserPrompt runs without a RulesPort
      Then the prompt does not contain "weak one-ply baseline"
      When buildUserPrompt runs with rules and an offer that does not include chooseMove's step
      Then the prompt does not contain "weak one-ply baseline"

  Rule: HTTP dialect, SPEC pointer, frozen neighbours

    @superseded-P63
    Scenario: Token budgets and thinking-off stay P61
      When byokCompletionBody is built for a ready config
      Then temperature is 0
      And reasoning max_tokens is 512
      And fast max_tokens is 64
      And thinking is off

    Scenario: SPEC.md §1 points at the teaching file as non-normative
      When SPEC.md is read
      Then section 1 contains "docs/byok-teaching.md"
      And that pointer is labelled non-normative
      And that pointer says the teaching file must not add a game rule

    Scenario: Pages heuristic still imports chooseMove
      Then packages/online-api/src/pages-heuristic.ts imports chooseMove
      And it does not import chooseTurnBeam
      And it does not import playLlmBotTurn

    Scenario: chooseTurnBeam is not the baseline
      Then packages/web/src/byokBot.ts does not call chooseTurnBeam to build the user prompt
      And opponent.ts chooseMove scoring is not edited by this packet
      And docs/spec/bot-turn-search/ is not edited by this packet
      And docs/spec/byok-batch-turn/ is not edited by this packet

    Scenario: Prompt builder stays pure
      Then packages/web/src/byokBot.ts prompt builders do not mention Date.now, Math.random, or performance.now

    Scenario: formatTargetsForPrompt may exist but is not concatenated live
      Given a playing GameState whose active player is the BYOK seat
      And syncTargetLocks returns a nonempty list
      When buildUserPrompt runs with those locks as targets
      Then the live user prompt does not contain "TARGETS"
      And formatTargetsForPrompt still exists for its own tests
