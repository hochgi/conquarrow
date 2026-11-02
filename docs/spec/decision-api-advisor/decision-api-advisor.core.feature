# language: en
# Overview: docs/spec/decision-api-advisor/decision-api-advisor.md
# Adapter only: a decision API advises a BYOK seat (ADR 0006). Not a game rule.

Feature: A decision API advises a BYOK seat
  As a player who runs a BYOK seat
  I want an optional decision API to rank each offer before the seat's model chooses
  So that advised and unadvised play can be compared from match logs

  Background:
    Given a GeometryPort and a RulesPort
    And seat B is a BYOK seat with a scripted fetch
    And a position where B has an offer of n rows, 2 ≤ n ≤ 255

  Rule: Off changes nothing

    Scenario: With the advisor off the seat behaves exactly as today
      Given B's advisor config has enabled false and a filled base URL, key and model
      When B plays one seat-turn
      Then no request goes to a "/systemone" URL
      And every chat request body equals the one a config without advisor sends
      And the turn has advisorRecords [] and advisorFailures 0

  Rule: On, one choice question per completion

    Scenario: The advisor is asked once before each chat completion
      Given B's advisor is ready with base URL "https://api.typesafe.ai/v1" and model "jev-latest"
      And the scripted model reply spends the offer over 2 completions
      When B plays one seat-turn
      Then the requests alternate "/systemone", "/chat/completions", "/systemone", "/chat/completions"
      And the advisor requests carry "Authorization: Bearer <advisor key>"
      And the chat requests carry "Authorization: Bearer <seat key>"

    Scenario: The question names the offer rows in engine order
      Given B's advisor is ready
      When B's advisor request body is built for an offer of n rows
      Then its keys are exactly "model", "state" and "questions"
      And "questions" has the single key "move" with type "choice"
      And "criteria" keys are "m0" through "m<n-1>" in that order
      And each criteria description equals that row's text in the plain prompt without its "[i] " prefix
      And "state" is the system prompt, a blank line, then the plain prompt up to the "LEGAL_MOVES" line

  Rule: The prompt shows probabilities in engine order

    Scenario: An advised prompt carries the legend and a probability on every row
      Given B's advisor answers m0=0.1, m1=0.6, m2=0.3 for a 3-row offer
      When B's prompt is built for that completion
      Then the line after the "LEGAL_MOVES" header is the advisor legend
      And row [0] ends " advisor=0.10", row [1] ends " advisor=0.60", row [2] ends " advisor=0.30"
      And removing the legend line and the suffixes gives back the plain prompt

    Scenario: The top pick is the argmax
      Given B's advisor answers m0=0.1, m1=0.6, m2=0.3
      When the answer is read
      Then top is 1

  Rule: Failure is silence

    Scenario: A failing advisor leaves the completion unadvised and the turn plays on
      Given B's advisor answers HTTP 500
      When B plays one seat-turn with a usable model reply
      Then the chat prompt is the plain prompt
      And the turn has advisorFailures 1 and advisorLastError "HTTP 500 from https://api.typesafe.ai/v1/systemone"
      And the turn has llmFallbacks 0 and no advisor record

  Rule: Every advised completion leaves a record

    Scenario: The record carries the advisor's view and the model's pick
      Given B's advisor answers m0=0.1, m1=0.6, m2=0.3 with model "jev-1.14.0"
      And the model replies {"moves":[1],"endTurn":true}
      When B plays one seat-turn
      Then the turn has one advisor record
      And the record has seat B, turnMoveIndex 0, model "jev-1.14.0", offerSize 3, top 1, picked 1
      And the record's probabilities are [0.1, 0.6, 0.3]

    Scenario: The match log places records at absolute move indices
      Given a match log with 7 moves logged
      And a BYOK turn whose records have turnMoveIndex 0 and 2
      When the turn's records are added with movesBefore 7
      Then the log's advisorRecords have at 7 and 9, in that order

    Scenario: The summary line counts agreement
      Given a finished match whose log has 4 advisor records, 3 with picked equal to top
      When the summary line is formatted
      Then it ends " · advisor agreed 3/4"

  Rule: The toggle is in the lobby and keeps its fields

    Scenario: Unchecking the advisor hides its fields but keeps them
      Given a local BYOK seat with the advisor checked and base URL, key and model filled
      When the player unchecks "Advisor (decision API)"
      Then the three advisor inputs are hidden
      And the seat plan's advisor has enabled false with base URL, key and model unchanged

    Scenario: The dev relay forwards the advisor
      Given B's seat config has an empty proxy URL under Vite dev
      When B's advisor is asked
      Then the POST goes to "/__byok" with header "X-Arrows-Byok-Upstream: https://api.typesafe.ai/v1/systemone"
      And "https://api.typesafe.ai/v1/systemone" passes isAllowedByokUpstream
