# language: en
# Overview: docs/spec/decision-api-advisor/decision-api-advisor.md
# Adapter only: edge cases of the decision-API advisor (ADR 0006).

Feature: Decision-API advisor edge cases

  Background:
    Given a GeometryPort and a RulesPort
    And seat B is a BYOK seat with a scripted fetch and a ready advisor

  Rule: Every failure mode is silent

    Scenario Outline: A broken advisor answer leaves the completion unadvised
      Given B's advisor responds with <response>
      When B plays one seat-turn with a usable model reply
      Then the chat prompt is the plain prompt
      And advisorFailures is 1 and advisorLastError is "<reason>"
      And no advisor record is kept and llmFallbacks is 0

      Examples:
        | response                                          | reason                                 |
        | a thrown network error "boom"                     | fetch failed: boom                     |
        | an abort from the 10 s timeout                    | fetch failed: <the abort message>      |
        | HTTP 429                                          | HTTP 429 from https://api.typesafe.ai/v1/systemone |
        | HTTP 200 with body "not json"                     | response was not JSON                  |
        | HTTP 200 with {"answers":{}}                      | missing answers.move.probabilities     |
        | HTTP 200 with probabilities {"m0":"x","zz":0.9}   | no usable probabilities                |

    Scenario: An offer over the choice cap is never sent
      Given B's offer has 256 rows
      When B's completion is prepared
      Then no advisor request is made
      And advisorFailures is 1 and advisorLastError is "offer too large (256 > 255)"

    Scenario: A failed advisor never triggers the greedy fallback
      Given B's advisor answers HTTP 503 on every call
      And the model reply is usable on every call
      When B plays one seat-turn
      Then the moves equal those B plays with the advisor off against the same model replies

  Rule: Reading the answer

    Scenario: Ties go to the lowest index
      Given B's advisor answers m0=0.2, m1=0.4, m2=0.4
      Then top is 1

    Scenario: Missing or non-finite options read as zero
      Given a 3-row offer and B's advisor answers m0=0.7, m2="NaN"
      Then the probabilities are [0.7, 0, 0] and top is 0
      And the advised rows end " advisor=0.70", " advisor=0.00", " advisor=0.00"

    Scenario: The reply's model is optional
      Given B's advisor answers without a top-level "model"
      Then the record's model is B's configured advisor model

  Rule: Records describe the model's pick truthfully

    Scenario: An unusable model reply records picked null
      Given B's advisor answers usably
      And the model replies with text that holds no usable batch
      When B plays one seat-turn
      Then the advisor record has picked null
      And the turn falls back to greedy-v1 as it does today

    Scenario: An end-turn-only reply records picked null
      Given B's advisor answers usably
      And the model replies {"moves":[],"endTurn":true}
      Then the advisor record has picked null

  Rule: Configuration persists and stays local

    Scenario: An older seat plan loads with the advisor off
      Given a saved seat plan whose BYOK seat has no "advisor" field
      When the seat plan is loaded
      Then that seat's advisor equals DEFAULT_ADVISOR

    Scenario: An advisor config survives save and load
      Given a seat plan whose BYOK seat has advisor enabled true, base URL, key and model set
      When the plan is saved and loaded
      Then the advisor fields are equal

    Scenario: A log without advice is unchanged
      Given a BYOK turn with zero advisor records
      When its records are added to the match log
      Then the log has no "advisorRecords" key
      And the summary line has no "advisor agreed" part

  Rule: Keys never leak

    Scenario: No key appears in records, logs or errors
      Given B's seat key "sk-seat-SECRET" and advisor key "ts-adv-SECRET"
      And B's advisor fails once with HTTP 401 and succeeds once
      When B plays one seat-turn and its records are logged
      Then neither key appears in the serialized match log, advisorLastError or any chat prompt
      And the advisor key appears only in advisor request headers
