# language: en
# Overview: docs/spec/byok-hint-and-threat/byok-hint-and-threat.md
# Adapter only — threat-line ties, plan echo, observation rank, purity

Feature: BYOK hint-and-threat — plan echo, observation rank, unchanged seams
  As the web adapter
  I want a deterministic threat line, a 512-char plan echo, and spawners near my tips
  So that the next POST remembers the close, dirt closes are named, and the dump is not the lex-first centre belt

  Background:
    Given a GeometryPort and a RulesPort
    And docs/byok-teaching.md is the teaching file
    And docs/design/fixtures/P64-hit12-hit15.json is the recorded-offer fixture
    And docs/design/fixtures/P66-hit5-hit9-hit13.json is the recorded-offer fixture

  Rule: Threat line boundaries

    Scenario: Tied shares use state.players as the last sort key
      Given threatLineFromCounts seats A, B, C
      And A and B both have 6 shares and 5 territory
      And C has 5 shares and 4 territory
      And players order is A, B, C
      And me is C
      When threatLineFromCounts runs
      Then the Lead clause names A before B
      When players order is B, A, C
      Then the Lead clause names B before A

    Scenario: No enemy trail prints Longest enemy trail none
      Given threatLineFromCounts with me B and every other seat trailLen 0
      When threatLineFromCounts runs
      Then the line contains "Longest enemy trail: none"

    Scenario: No cut and no closes prints No cut/contest/deny row and does not invent deny
      Given threatLineFromCounts whose offer tags are only borders_spawner
      When threatLineFromCounts runs
      Then the line contains "Offer tags: borders_spawner"
      And the line contains "No cut/contest/deny row"
      And annotateMove does not emit "deny"
      When offer tags are empty
      Then the line contains "No cut/contest/deny row"
      And the line does not contain "Offer tags:"

    Scenario: No shared point with an enemy trail prints the locked vertex phrase
      Given threatLineFromCounts with nearTrail false
      When threatLineFromCounts runs
      Then the line contains "no enemy trail on a legal vertex"
      When nearTrail is true
      Then the line does not contain "no enemy trail on a legal vertex"

    Scenario: An exit that shares a point with an enemy trail is tagged near_trail
      Given a playing GameState whose active player is the BYOK seat
      And an enemy trail arrow whose origin or target equals origin or target of a legal exit
      And that exit is not on the enemy trail
      When annotateMove prints that step
      Then the row contains "near_trail:" and that enemy seat
      And the row does not contain "cut"
      And annotateMove does not call flankVertices for that tag

  Rule: Plan echo

    Scenario: Echoed plan is truncated to PLAN_CAP 512 and newlines become spaces
      Given a stored plan of 90 characters including a newline
      When buildUserPrompt runs for that seat
      Then the prompt contains a line starting with "Plan: "
      And that line sits under the threat line and before STATE_JSON
      And PLAN_CAP is 512
      And the echoed text is at most 512 characters
      And the echoed text contains no newline
      And the newline in the stored plan became a space
      And the line does not contain "prefer"

    Scenario: Missing plan keeps the previous echo; empty or pass clears; clearByokPlans drops it
      Given rememberByokPlan stored "close the open trail" for seat B
      When a usable batch omits the plan key
      Then the next buildUserPrompt still contains "Plan: close the open trail"
      When a usable batch has plan ""
      Then the next buildUserPrompt omits a Plan line
      When rememberByokPlan stored "close the open trail" again
      And a usable batch is {"moves":[],"endTurn":true,"plan":"still going"}
      Then the next buildUserPrompt omits a Plan line
      When rememberByokPlan stored "close the open trail" again
      And clearByokPlans runs
      Then the next buildUserPrompt omits a Plan line
      And App.tsx startMatch calls clearByokPlans
      And the plan map is not written to localStorage or the match log

    Scenario: plan is never an offer index and empty plus endTurn false is still a fallback
      Given a ready ByokConfig
      And a playing GameState whose active player is the BYOK seat
      And an injected fetch that returns mocked chat/completions JSON
      And the mock reply is {"moves":[],"endTurn":false,"plan":"close the open trail"}
      When playLlmBotTurn runs
      Then llmFallbacks is 1
      And apply-prefix did not treat plan as an index
      And the teaching file says not to put indices in plan

  Rule: Observation rank

    Scenario: Spawner dump prefers vertices incident to my groups or legal exits and caps at 12
      Given a playing GameState whose active player is the BYOK seat
      And more than 12 interesting spawners
      And at least one interesting vertex borders a me group arrow or a legal exit
      When snapshotForPrompt runs with this offer
      Then spawnersShown is 12
      And incident interesting vertices appear before other interesting vertices
      And spawners is not a 58-row dump
      And snapshotForPrompt does not call chooseTurnBeam

  Rule: Purity and prompt facts

    Scenario: Prompt builders and helpers stay pure except the existing fetch on play
      Then packages/web/src/byokBot.ts prompt builders, threatLineFromCounts, baselineIndexFromTags, isFullStackClose, annotateMove, the plan store, isDirtClose, isTagChasePlan, and dirtClosesFromRows do not mention Date.now, Math.random, or performance.now
      And lastError and byokStats do not contain an API key, raw content, or reasoning_content

    Scenario: Live user prompt reply line includes plan and does not prefer-order
      Given a playing GameState whose active player is the BYOK seat
      And offer is legalMoves steps
      When buildUserPrompt runs
      Then the prompt contains "Reply with only JSON: {\"moves\":[i,...],\"endTurn\":true|false,\"why\":\"short\",\"plan\":\"short\"}"
      And the prompt does not contain "via count="
      And the prompt does not contain "prefer " case-insensitive
      And the prompt does not contain a TARGETS heading
      And SPEC.md section 1 still contains one docs/byok-teaching.md pointer labelled non-normative

    Scenario: chooseMove stays frozen and a mill baseline is not advertised on Hit 15
      Given the Hit 15 recorded legal rows from the fixture
      Then packages/web/src/opponent.ts still exports chooseMove
      And baselineIndexFromTags returns no index
      And the expected live baseline paragraph is omitted
      And P61 empty-prefix and illegal-tail tests stay the live protocol

  Rule: P66 dirt clause and plan budget boundaries

    Scenario: closes plus share+N on the same row omits the dirt clause
      Given offer rows where one step is tagged closes and share+1
      When dirtClosesFromRows runs
      Then it is false
      When threatLineFromCounts runs with dirtCloses false and offer tags closes
      Then the line does not contain "closes without share+N (dirt)"
      And the line may still contain "Offer tags: closes"

    Scenario: Plan of length 81 is stored whole
      Given a stored plan of 81 characters with no newline
      When buildUserPrompt runs for that seat
      Then the echoed text length is 81
      And the echoed text is the full 81 characters

    Scenario: Plan of length 513 is truncated to 512
      Given a stored plan of 513 characters with no newline
      When buildUserPrompt runs for that seat
      Then the echoed text length is 512
      And the echoed text is the first 512 characters
