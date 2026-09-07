# language: en
# Overview: docs/spec/byok-batch-turn/byok-batch-turn.md
# Adapter only — local BYOK batch turn, not a game rule

Feature: BYOK commits an ordered step batch per completion
  As a local BYOK seat
  I want one completion to name several legalMoves-step indices and whether to endTurn
  So that a 3-stack can send a lump as one count instead of peeling singletons

  Background:
    Given a GeometryPort and a RulesPort
    And a ready ByokConfig
    And an injected fetch that returns mocked chat/completions JSON
    And playLlmBotTurn is the live BYOK turn protocol

  Rule: One completion can commit a lump

    Scenario: Constructed T2 3-stack accepts a mocked count=3 lump
      Given a constructed T2 board whose active seat has a 3-stack on arrow -5,6,0
      And count=3 from -5,6,0 onto -4,6,0 is in the offer
      And the mock reply is {"moves":[i],"endTurn":true} with i that count=3 index
      When playLlmBotTurn runs
      Then the applied moves are that step with count=3 then endTurn
      And fetch was called once
      And the posted user prompt numbers steps with global [i] grouped by from
      And the posted user prompt does not say pick one index
      And the posted system prompt asks for a moves index array and an endTurn flag
      And the posted system prompt still contains the 2^k lump tempo guidance
      And the posted system prompt does not claim the adapter rejects a shuttle
      And endTurn is not a numbered offer index
      And llmHits is 1
      And llmFallbacks is 0

    Scenario: Three mocked count=1 indices still apply — singletons are not hidden
      Given the same constructed T2 board
      And three sequential count=1 indices from -5,6,0 onto -4,6,0 stay legal when applied in order
      And the mock reply is {"moves":[i1,i2,i3],"endTurn":true} with those indices
      When playLlmBotTurn runs
      Then the applied moves are those three count=1 steps then endTurn
      And fetch was called once
      And the adapter did not rewrite them into one count=3 step

    Scenario: Lump then 2-way split from the landing — leftover inherits spent
      Given an opening-style board whose active seat can send count=3 onto a landing arrow
      And after that lump two different count=1 exits from the landing are legal
      And the leftover head on the landing cannot take a second tile because it inherited spent
      And the first mock reply is {"moves":[lump],"endTurn":false} with lump the count=3 index
      And the second mock reply is {"moves":[a,b],"endTurn":true} with a and b those two count=1 indices
      When playLlmBotTurn runs
      Then the applied moves are the lump, then the two count=1 steps on different exits, then endTurn
      And a leftover head remains on the landing
      And that leftover did not take a second tile
      And fetch was called twice
      And llmHits is 1

  Rule: Pass and empty-prefix fallback

    Scenario: Empty moves with endTurn true is a listed pass
      Given a playing GameState whose active player is the BYOK seat
      And the mock reply is {"moves":[],"endTurn":true}
      When playLlmBotTurn runs
      Then the applied moves are endTurn only
      And fetch was called once
      And llmHits is 1
      And llmFallbacks is 0

    Scenario: Empty moves with endTurn false is empty prefix
      Given a playing GameState whose active player is the BYOK seat
      And the mock reply is {"moves":[],"endTurn":false}
      When playLlmBotTurn runs
      Then the remaining seat-turn is the greedy-v1 plan from that state
      And fetch was called once
      And chooseTurnBeam was not called
      And llmHits is 0
      And llmFallbacks is 1

    Scenario: Illegal tail ignores endTurn and re-prompts
      Given a playing GameState whose active player is the BYOK seat
      And the offer has a legal step at index L
      And after applying that step a legal step still remains
      And the first mock reply is {"moves":[L, 99],"endTurn":true}
      And the second mock reply is a listed pass {"moves":[],"endTurn":true}
      When playLlmBotTurn runs
      Then the first applied move is the step at L
      And index 99 was not applied
      And lastError names the illegal index 99
      And fetch was called twice
      And the first completion's endTurn true was not honoured
      And llmHits is 1

    Scenario: Prefix that exhausts steps forces endTurn even when the flag is false
      Given a playing GameState whose active player is the BYOK seat
      And a mock batch whose whole moves array leaves no legal step
      And that reply has "endTurn": false
      When playLlmBotTurn runs
      Then the applied moves end with endTurn
      And fetch was called once
      And llmHits is 1
      And llmFallbacks is 0

  Rule: Batch order, seat-turn stats, unusable JSON

    Scenario: Two different froms in one moves array keep array order
      Given a playing GameState with legal steps from two different from arrows
      And the mock reply lists those two indices in an order that is not first-seen-from order
      And "endTurn" is true
      When playLlmBotTurn runs
      Then the two steps are applied in the array order
      And fetch was called once

    Scenario: Three completions of one successful seat-turn count as one hit
      Given a playing GameState whose active player is the BYOK seat
      And three successive mock replies each apply a nonempty prefix
      And only the third has "endTurn": true
      When playLlmBotTurn runs
      Then fetch was called three times
      And llmHits is 1
      And llmFallbacks is 0

    Scenario: Unusable JSON is empty prefix with no extract retry
      Given a playing GameState whose active player is the BYOK seat
      And the mock reply is prose that is not the batch JSON object
      When playLlmBotTurn runs
      Then the remaining seat-turn is the greedy-v1 plan from that state
      And fetch was called once
      And there was no second extract-retry POST
      And llmFallbacks is 1
      And llmHits is 0

    Scenario: P53 shuttle/stride inventory is not rewritten
      Then docs/spec/bot-turn-search/ is not edited by this packet
      And greedy-v1 output on P53 baseline positions is unchanged
      And chooseTurnBeam constructions stay the P53 contract
