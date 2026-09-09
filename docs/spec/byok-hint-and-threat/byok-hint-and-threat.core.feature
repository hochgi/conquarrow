# language: en
# Overview: docs/spec/byok-hint-and-threat/byok-hint-and-threat.md
# Adapter only — BYOK prompt facts and plan echo, not a game rule

Feature: BYOK tags are hints, threat line names the lead, baseline names the lump close
  As a local BYOK seat
  I want tags treated as outcomes, a facts threat line, a lump-close baseline, and a plan echo
  So that a count=3 close on the offer is named and a mill-only leftover is not advertised

  Background:
    Given a GeometryPort and a RulesPort
    And docs/byok-teaching.md is the teaching file
    And docs/design/fixtures/P64-hit12-hit15.json is the recorded-offer fixture
    And playLlmBotTurn is still the live BYOK turn protocol

  Rule: Teaching file — tags are hints, plan, locks

    Scenario: Teaching file contains the tags-are-hints paragraph and every P62/P63 lock
      When the teaching file is read
      Then it contains "tags" and "not orders"
      And it teaches that on_target loses to an available closes
      And it teaches that on_target loses to an available cut
      And it teaches that on_target loses to an opponent share or territory lead
      And it teaches that on_target loses when trailLen is already at least girth and tipDist is not shrinking
      And it says not to invent a tag
      And it says not to treat borders_spawner as walking past the close
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
      And buildSystemPrompt includes that Close, cut, mill section

    Scenario: Teaching JSON contract includes plan and a Plan section with the Hit 12 contrast
      When the teaching file is read
      Then it contains "## Plan"
      And the JSON contract contains '"plan":"short"'
      And it contains "Hit 12 shape"
      And it contains "Good:" and '"plan":"close the open trail"'
      And it contains "Bad:" and '"moves":[4,0]'
      And it says plan is not an offer index
      And it says a plan cannot create a cut that is not a row
      And it does not match /prefer (split|closes|don’t close|don't close)/i
      And it still contains "Close vs cut" and "After 1-share" and "After 3-share"
      And it does not contain "Play [2]"
      And buildSystemPrompt includes the Plan section

  Rule: Threat line

    Scenario: buildUserPrompt prints one threat line with share lead, longest enemy trail, and offer tags
      Given a playing GameState with seats A, B, C and uneven shares
      And the active player is the BYOK seat B
      And offer is legalMoves steps
      When buildUserPrompt runs
      Then the prompt contains one line starting with "Lead:" after the Shares/tips block
      And that line is before STATE_JSON
      And that line names who leads shares then territory including B
      And that line names the longest enemy trail owner and length or none
      And that line says whether the offer has cut or closes or No cut/contest/deny row

    Scenario: Same state yields the same threat line
      Given a playing GameState whose active player is the BYOK seat
      And offer is legalMoves steps
      When buildUserPrompt runs twice
      Then the two prompts are identical
      And the Lead line is identical

  Rule: Lump-close baseline

    Scenario: Hit 12 shape baseline names a count=3 close not chooseMove count=1
      Given the Hit 12 recorded legal rows from the fixture
      When baselineIndexFromTags runs on those rows
      Then the index is 2 or 8
      And the index is not 0
      And the named row is tagged closes
      And that row's count is 3

    Scenario: Hit 15 shape mill-only offer omits the baseline paragraph
      Given the Hit 15 recorded legal rows from the fixture
      When baselineIndexFromTags runs on those rows
      Then it returns no tagged close or cut index
      And every row is a non-expanding mill
      And a mill baseline naming "[0]" is not the expected sentence

  Rule: Recorded fixtures

    Scenario: Hit 12 full-stack close helper accepts [2] or [8] and rejects [4,0]
      Given the Hit 12 recorded legal rows from the fixture
      When isFullStackClose runs on {"moves":[2],"endTurn":true}
      Then it is true
      When isFullStackClose runs on {"moves":[8],"endTurn":false}
      Then it is true
      When isFullStackClose runs on {"moves":[4,0],"endTurn":false}
      Then it is false
      And the fixture expectedReply plan is "close the open trail"

    Scenario: Hit 15 expected batch is an empty pass
      Given the Hit 15 recorded legal rows from the fixture
      Then the fixture expectedReply moves is []
      And the fixture expectedReply endTurn is true
      And isFullStackClose on that batch is false
      And the fixture expectedReply plan is omitted or empty
      And a mill index is not the expected batch

  Rule: Apply-prefix and seams

    Scenario: Extra keys why and plan do not affect asUsableBatch or apply-prefix
      Given a ready ByokConfig
      And a playing GameState whose active player is the BYOK seat
      And an injected fetch that returns mocked chat/completions JSON
      And the mock reply is {"moves":[i],"endTurn":true,"why":"x","plan":"close the open trail","mission":"nope"}
      When parseMoveBatch runs on that content
      Then the result is that index and endTurn true
      And asUsableBatch does not return why or plan
      When playLlmBotTurn runs on a board where that index is a legal step
      Then the mapped prefix applies that step
      And plan is not an offer index
      When a mock reply is {"moves":[],"endTurn":false,"plan":"still on the trail"}
      Then the remainder is greedy-v1 and llmFallbacks is 1

    Scenario: Pages still chooseMove and chooseTurnBeam is untouched
      Then packages/online-api/src/pages-heuristic.ts imports chooseMove
      And it does not import chooseTurnBeam
      And packages/web/src/byokBot.ts does not call chooseTurnBeam or evaluate to build the prompt, baseline, or a tag
      And chooseMove, chooseTurnGreedy, and chooseTurnBeam bodies are not edited by this packet
      And greedy-v1 stays frozen
