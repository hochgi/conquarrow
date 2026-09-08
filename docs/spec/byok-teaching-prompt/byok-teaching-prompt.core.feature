# language: en
# Overview: docs/spec/byok-teaching-prompt/byok-teaching-prompt.md
# Adapter only — BYOK teaching prompt, not a game rule

Feature: BYOK teaching prompt is curated rules and user-prompt facts
  As a local BYOK seat
  I want a SPEC-faithful system prompt and a user prompt that does not order T0
  So that a 3-stack can spend tempo instead of peeling count=1 because Prefer on_target

  Background:
    Given a GeometryPort and a RulesPort
    And docs/byok-teaching.md is the teaching file
    And playLlmBotTurn is still the live BYOK turn protocol

  Rule: System prompt is the teaching file

    Scenario: buildSystemPrompt includes the teaching file body
      Given seat me and reasoning true
      When buildSystemPrompt runs
      Then the result contains the full teaching file text
      And the result contains "speed(N) = 1 + floor(log₂ N)"
      And the result contains "On a split, both parts inherit"
      And the result contains "spent"
      And the result contains "majority"
      And the result contains "speed 0"
      And the result contains "follows the grain"
      And the result contains "3-in / 3-out"
      And the result contains "girth is 3"
      And the result contains "unbounded"
      And the result contains "one seat remains"
      And the result contains "starvation"
      And the result contains "risk heads"
      And the result contains "2^k"
      And the result contains '"moves"'
      And the result contains "endTurn"
      And the result contains "seat " and me
      And the result does not contain "Domination needs shares"

    Scenario: Teaching file does not teach domination as a win
      When the teaching file is read
      Then it contains "one seat remains"
      And it contains "starvation"
      And it does not match domination in any case
      And it does not contain "§11"
      And it does not contain "even-odd"
      And it does not contain "evaporation front"

    Scenario: Close vs cut example has two after snapshots
      When the teaching file is read
      Then it contains "Close vs cut"
      And it contains "Before"
      And it contains "After close"
      And it contains "After cut"
      And buildSystemPrompt includes those four labels

    @superseded-P63
    Scenario: T1 tempo example prefers the lump index not peel-and-pass
      When the teaching file is read
      Then it contains "T1 tempo"
      And it contains "[0]" and "count=1"
      And it contains "[1]" and "count=2"
      And it contains "[2]" and "count=3"
      And it teaches [2] or continuing after [1], not [0] plus endTurn
      And buildSystemPrompt includes that example

  Rule: User prompt is facts, not orders

    Scenario: T1-shaped user prompt has no via count= and no Prefer on_target
      Given makeMatch R=7 homeOffset=5 playerCount=3 spawnerSeed=1
      And me is the active player
      And offer is legalMoves steps
      And chooseMove on that state returns a step S
      When buildUserPrompt runs with geometry, state, me, offer, rules
      Then the prompt does not contain "via count="
      And the prompt does not match /prefer /i
      And the prompt does not contain "TARGETS"
      And the prompt contains "Shares="
      And the prompt contains "trailLen="
      And the prompt contains a baseline line for S's offer index
      And that index is not required to be 0
      And the baseline is labelled suggestion only

    Scenario: Phase line stays facts when shares are 0 or the trail is long
      Given a playing GameState whose active player is the BYOK seat
      And offer is legalMoves steps
      When buildUserPrompt runs
      Then the phase line is "Shares=" n ", trailLen=" n "."
      And the prompt does not contain "do NOT home_mill"
      And the prompt does not contain "prefer homeward"

    Scenario: on_target may tag a row without ordering it
      Given a playing GameState whose active player is the BYOK seat
      And syncTargetLocks returns a nonempty list
      And some offer step would be tagged on_target
      When buildUserPrompt runs with those locks as targets
      Then LEGAL_MOVES may contain "on_target"
      And the prompt does not contain "via count="
      And the prompt does not match /prefer /i
      And the prompt does not contain "TARGETS"

    Scenario: Empty offer omits the baseline paragraph
      Given makeMatch R=7 homeOffset=5 playerCount=3 spawnerSeed=1
      And me is the active player
      When buildUserPrompt runs with an empty offer and rules
      Then the prompt does not contain "weak one-ply baseline"

  Rule: Posted completions and P61 protocol

    Scenario: playLlmBotTurn posts the new prompts and still applies a lump
      Given a ready ByokConfig
      And an injected fetch that returns mocked chat/completions JSON
      And a constructed board whose offer includes a count=3 step at index i
      And the mock reply is {"moves":[i],"endTurn":true}
      When playLlmBotTurn runs
      Then fetch was called once
      And the posted system prompt contains the teaching file body
      And the posted system prompt does not contain "Domination needs shares"
      And the posted user prompt does not contain "via count="
      And the posted user prompt does not match /prefer /i
      And the applied moves are that count=3 step then endTurn
      And llmHits is 1
