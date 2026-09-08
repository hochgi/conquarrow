# language: en
# Overview: docs/spec/byok-thinking-teach/byok-thinking-teach.md
# Adapter only — stats fold, salvage accounting, purity, one thinking contract

Feature: BYOK thinking-teach — token totals, salvage, sync, unchanged seams
  As the web adapter
  I want token totals and last-JSON salvage without a second POST or a prefer-order
  So that playtest JSON shows whether 4096 bound and whether teaching drifted

  Background:
    Given a GeometryPort and a RulesPort
    And docs/byok-teaching.md is the teaching file

  Rule: Token totals and old logs

    Scenario: Missing usage and finish_reason yield zero token fields without throwing
      Given a ready ByokConfig
      And a playing GameState whose active player is the BYOK seat
      And an injected fetch whose chat/completions JSON has no usage and no finish_reason
      And the mock content is a usable batch with endTurn true
      When playLlmBotTurn runs
      Then promptTokens is 0
      And completionTokens is 0
      And lengthOuts is 0
      And the fold does not throw

    Scenario: Old match log without new fields loads and fold treats them as 0
      Given a MatchLog whose byokStats has only llmHits, llmFallbacks, and lastError
      When withByokStats adds a delta with promptTokens 3, completionTokens 5, lengthOuts 1, salvageParses 1, maxTokens 4096
      Then aggregate promptTokens is 3
      And aggregate completionTokens is 5
      And aggregate lengthOuts is 1
      And aggregate salvageParses is 1
      And aggregate maxTokens is 4096
      And llmHits still adds as before

    Scenario: finish_reason length increments lengthOuts and can still be a hit
      Given a ready ByokConfig
      And a playing GameState whose active player is the BYOK seat
      And an injected fetch whose choice finish_reason is length
      And the content is an essay then a usable batch whose mapped prefix is nonempty and endTurn true
      When playLlmBotTurn runs
      Then lengthOuts is 1
      And llmHits is 1
      And llmFallbacks is 0

    Scenario: Salvage increments only when whole-string parse failed and a nested batch succeeded
      Given parseMoveBatch
      When the text is {"moves":[1],"endTurn":true}
      Then it parses as that batch and is not salvage
      When the text is essay then {"moves":[1],"endTurn":true}
      Then it parses as that batch and is salvage
      When playLlmBotTurn runs with the essay-then-batch content and a nonempty legal prefix
      Then salvageParses is 1
      And llmHits is 1
      When playLlmBotTurn runs with whole-string {"moves":[i],"endTurn":true}
      Then salvageParses is 0

    Scenario: maxTokens on the aggregate is the max of previous and delta
      Given a MatchLog whose byokStats maxTokens is 64
      When withByokStats adds a delta with maxTokens 4096
      Then aggregate maxTokens is 4096
      When withByokStats then adds a delta with maxTokens 64
      Then aggregate maxTokens is still 4096

  Rule: Salvage skip, length-out fallback, share omit

    Scenario: A CoT example object that is not a batch is skipped if a later usable batch exists
      Given parseMoveBatch
      When the text is {"thought":true} then {"moves":[2],"endTurn":true}
      Then the result is moves [2] and endTurn true
      When the text is {"moves":[0.5],"endTurn":true} then {"moves":[2],"endTurn":true}
      Then the result is moves [2] and endTurn true
      When the text is thinking ANSWER 2 with no object
      Then the result is unusable

    Scenario: Length-out plus unusable text is a fallback
      Given a ready ByokConfig
      And a playing GameState whose active player is the BYOK seat
      And an injected fetch whose choice finish_reason is length
      And the content has no usable batch object
      When playLlmBotTurn runs
      Then lengthOuts is 1
      And llmFallbacks is 1
      And llmHits is 0
      And fetch was called once

    Scenario: A step that gains 0 shares omits a share tag
      Given a playing GameState whose active player is the BYOK seat
      And a legal step whose apply does not raise that seat's share count
      When annotateMove or formatLegalMoves prints that row
      Then the row does not contain "share+"
      And the row does not contain a bare share tag

  Rule: Seams, purity, teaching sync, one thinking contract

    Scenario: Pages still chooseMove, opponent unscored, parse prompt and stats fold stay pure
      Then packages/online-api/src/pages-heuristic.ts imports chooseMove
      And it does not import chooseTurnBeam
      And it does not import playLlmBotTurn
      And opponent.ts chooseMove scoring is not edited by this packet
      And packages/web/src/byokBot.ts does not call chooseTurnBeam or evaluate to build the prompt or a share tag
      And parseMoveBatch, prompt builders, byokCompletionBody, and withByokStats do not mention Date.now, Math.random, or performance.now
      And lastError and byokStats do not contain an API key, raw content, or reasoning_content

    Scenario: Teaching sync keeps P62 locks and drops the Play [2] assertion
      When the teaching file is read from disk without fetch
      And buildSystemPrompt runs
      Then the system prompt contains the full teaching file text
      And it contains "speed(N) = 1 + floor(log₂ N)"
      And it contains "On a split, both parts inherit"
      And it contains "majority" and "speed 0"
      And it contains "follows the grain"
      And it contains "3-in / 3-out"
      And it contains "girth is 3"
      And it contains "unbounded"
      And it contains "one seat remains"
      And it contains "starvation"
      And it contains '"moves"'
      And it contains "endTurn"
      And it does not match domination in any case
      And it does not contain "§11"
      And it does not contain "even-odd"
      And it does not contain "evaporation front"
      And it does not contain "Play [2]"
      And it does not contain "L0"
      And docs/spec/byok-teaching-prompt T1 Play [2] scenario is tagged @superseded-P63

    Scenario: No per-completion rows, HUD graph, or evaluate score
      Then ByokRunStats has no per-completion array field
      And packages/web/src/Hud.tsx does not chart promptTokens or lengthOuts
      And withByokStats does not call evaluate
      And greedy-v1 chooseMove stays frozen

    Scenario: One live thinking contract — P62 thinking-off is superseded
      When byokCompletionBody is built for reasoning true
      Then enable_thinking is true and max_tokens is 4096
      When byokCompletionBody is built for reasoning false
      Then enable_thinking is false and max_tokens is 64
      Then docs/spec/byok-teaching-prompt "Token budgets and thinking-off stay P61" is tagged @superseded-P63
      And no remaining test pins enable_thinking false on a reasoning-true live-turn body
      And SPEC.md section 1 still contains one docs/byok-teaching.md pointer labelled non-normative
      And this packet does not add a second SPEC.md teaching pointer
