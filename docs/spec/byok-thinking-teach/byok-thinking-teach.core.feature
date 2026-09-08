# language: en
# Overview: docs/spec/byok-thinking-teach/byok-thinking-teach.md
# Adapter only — BYOK thinking / teaching / stats, not a game rule

Feature: BYOK thinking follows the lobby, teaching shows split and share counts
  As a local BYOK seat
  I want thinking on when Reasoning is checked, facts about split-throughput and share deltas, and last-JSON salvage
  So that a 3-stack can split 2+1 and a pinwheel close is not confused with a 1-share land-bridge

  Background:
    Given a GeometryPort and a RulesPort
    And docs/byok-teaching.md is the teaching file
    And playLlmBotTurn is still the live BYOK turn protocol

  Rule: Thinking follows the lobby flag

    Scenario: Reasoning true posts thinking on and 4096 tokens
      Given a ready ByokConfig with reasoning true
      When byokCompletionBody is built for a live turn
      Then chat_template_kwargs enable_thinking is true
      And extra_body.chat_template_kwargs enable_thinking is true
      And max_tokens is 4096
      And BYOK_REASONING_MAX_TOKENS is 4096
      And temperature is 0
      And response_format is json_object

    Scenario: Reasoning false posts thinking off and 64 tokens
      Given a ready ByokConfig with reasoning false
      When byokCompletionBody is built for a live turn
      Then chat_template_kwargs enable_thinking is false
      And extra_body.chat_template_kwargs enable_thinking is false
      And max_tokens is 64
      And temperature is 0
      And response_format is json_object

    Scenario: testByokConnection stays a thinking-off probe even when reasoning is true
      Given a ready ByokConfig with reasoning true
      And an injected fetch that returns mocked chat/completions JSON
      And the mock reply is {"move":0,"why":"probe"}
      When testByokConnection runs
      Then the probe is ok
      And the request is not the batch contract
      And the posted enable_thinking is false on both kwargs copies
      And posted max_tokens is 64
      And posted max_tokens is not 4096

  Rule: Teaching T1, pinwheel, close-vs-cut

    Scenario: T1 teaches split 2+1 throughput not Play [2] as the only answer
      When the teaching file is read
      Then it contains "T1 tempo"
      And it contains "[0]" and "count=1"
      And it contains "[1]" and "count=2"
      And it contains "[2]" and "count=3"
      And it does not contain "Play [2]"
      And it teaches lump count=3 walks 2 tiles with speed(3)=2
      And it teaches split 2+1 before walking yields 3 tiles
      And it says not to peel three count=1 as three POSTs
      And it does not match /prefer split/i
      And buildSystemPrompt includes that T1 section

    Scenario: Pinwheel example has Before plus After 1-share and After 3-share
      When the teaching file is read
      Then it contains "pinwheel"
      And it contains "Before"
      And it contains "After 1-share"
      And it contains "After 3-share"
      And it contains "apply(state, move)"
      And it shows a 1-share outcome and a 3-share outcome
      And it does not match /prefer the 3-share/i
      And buildSystemPrompt includes those three labels

    Scenario: Close vs cut example is still present
      When the teaching file is read
      Then it contains "Close vs cut"
      And it contains "Before"
      And it contains "After close"
      And it contains "After cut"
      And buildSystemPrompt includes those four labels

  Rule: LEGAL_MOVES row facts

    Scenario: A step that gains 2 shares is tagged share+2 not bare share
      Given a playing GameState whose active player is the BYOK seat
      And a legal step whose apply raises that seat's share count by 2
      When annotateMove or formatLegalMoves prints that row
      Then the row contains "share+2"
      And the row does not contain a bare share tag

    Scenario: Step rows contain left= equal to spd minus spent
      Given a playing GameState whose active player is the BYOK seat
      And offer is legalMoves steps
      When formatLegalMoves prints the offer
      Then every step row contains "left="
      And that K equals the row's spd minus spent

  Rule: Last usable batch, Grok path, unusable, P61 loop

    Scenario: Two batch objects after an essay use the last usable one
      Given a ready ByokConfig
      And a playing GameState whose active player is the BYOK seat
      And an injected fetch that returns mocked chat/completions JSON
      And the mock content is an essay then {"moves":[1],"endTurn":true} then a second usable batch {"moves":[0],"endTurn":true}
      When parseMoveBatch runs on that content
      Then the result is moves [0] and endTurn true
      When playLlmBotTurn runs on a board where index 0 is a legal step
      Then fetch was called once
      And there was no second extract-retry POST

    Scenario: Whole-string JSON still parses and does not increment salvage
      Given a ready ByokConfig
      And a playing GameState whose active player is the BYOK seat
      And an injected fetch that returns mocked chat/completions JSON
      And the mock reply is {"moves":[i],"endTurn":true} as the whole content
      When playLlmBotTurn runs
      Then parseMoveBatch on that content returns that batch
      And salvageParses is 0
      And llmHits is 1

    Scenario: Unusable text with no batch object is empty prefix greedy
      Given a ready ByokConfig
      And a playing GameState whose active player is the BYOK seat
      And an injected fetch that returns mocked chat/completions JSON
      And the mock reply is prose that is not a batch JSON object
      When playLlmBotTurn runs
      Then the remaining seat-turn is the greedy-v1 plan from that state
      And fetch was called once
      And there was no second extract-retry POST
      And llmFallbacks is 1
      And llmHits is 0
      And salvageParses is 0

    Scenario: P61 illegal-tail, empty-prefix, and lump apply stay live
      Given a ready ByokConfig
      And an injected fetch that returns mocked chat/completions JSON
      When a constructed board's offer includes a count=3 lump and the mock is that index with endTurn true
      Then the lump step is applied and llmHits is 1
      When a mock reply is {"moves":[],"endTurn":false}
      Then the remainder is greedy-v1 and llmFallbacks is 1
      When a mock reply is {"moves":[L, 99],"endTurn":true} with L legal and 99 not
      Then L is applied, 99 is not, fetch is more than once, and llmHits is 1
