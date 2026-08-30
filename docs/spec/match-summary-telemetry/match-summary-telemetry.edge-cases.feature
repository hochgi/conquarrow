# language: en
# Overview: docs/spec/match-summary-telemetry/match-summary-telemetry.md
# Heuristic boundaries, persistence, App restore, purity

Feature: Match summary telemetry — close vs cut, load, seams
  As the web adapter
  I want closes and cuts to stay honest playtest proxies
  So that claiming your own trail is not reported as a cut, and a stub App cannot ship

  Background:
    Given a MatchLog
    And two GameStates, before and after

  Rule: The cut proxy ignores the closer's own trail

    Scenario: Own-trail claim on close is not a cut
      Given player A's territory count increased
      And player A's trail is smaller after than before
      And no other player's trail shrank
      When foldMatchSummary runs on a one-step batch
      Then closes is 1
      And cuts is 0

    Scenario: Close and enemy cut in one batch count both
      Given player A's territory count increased
      And player B's trail is smaller after than before
      And B's territory count did not increase
      When foldMatchSummary runs on a one-step batch
      Then closes is 1
      And cuts is 1

    Scenario: Owner-swap that grows B is a close
      Given one arrow moved from A's territory to B's
      And no trail shrank
      When foldMatchSummary runs on a one-step batch
      Then closes is 1
      And cuts is 0

    Scenario: New trail is not a cut
      Given player A had no trail before
      And player A has a non-empty trail after
      And territory counts are unchanged
      When foldMatchSummary runs on a one-step batch
      Then cuts is 0
      And closes is 0

    Scenario: firstCloseAt is sticky
      Given firstCloseAt is already 2
      And this batch also grows territory
      When foldMatchSummary runs
      Then firstCloseAt stays 2
      And closes increments by 1

  Rule: Format omits idle fields

    Scenario: The format is the four counters and nothing between them
      Given firstCloseAt is unset
      Then formatMatchSummary contains no counter between "end-turns" and "closes"
      And it does not contain "first close"

  Rule: Persistence

    Scenario: Load of a log missing summary uses empty counters
      Given a stored JSON match log with no summary field
      When loadLastMatchLog runs
      Then the returned log has emptyMatchSummary counters

    Scenario: Load of malformed JSON returns undefined
      Given stored text that is not JSON
      When loadLastMatchLog runs
      Then the result is undefined

    Scenario: Serialize includes summary
      Given a log whose summary has 1 close
      Then serializeMatchLog JSON has summary.closes equal to 1

  Rule: App wiring and seams

    Scenario: App still mounts Board and Hud
      Then packages/web/src/App.tsx contains a Board element and a Hud element
      And it does not contain "App restore incomplete"
      And packages/web/src/AppMain.tsx does not exist

    Scenario: Online record folds when before is known
      Given App.tsx's online submit path
      Then that path passes before into record along with the applied moves

    Scenario: Equal fold inputs yield equal summaries
      Given two before/after pairs that differ only by Map insertion order
      And the same moves and the same starting summary
      Then both folded summaries are deeply equal

    Scenario: Fold helper has no clock or random
      Then packages/web/src/matchLog.ts foldMatchSummary does not mention Date.now or Math.random

    Scenario: Rules-core is unchanged
      Then these tests import no apply from rules-core to fold the summary
      And packages/rules-core is not imported by matchLog.ts
