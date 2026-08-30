# language: en
# Overview: docs/spec/match-summary-telemetry/match-summary-telemetry.md
# Adapter only — playtest counters, not a game rule

Feature: Match summary telemetry — counters and the over line
  As a playtester finishing a match
  I want a one-line count of steps, closes, and cuts
  So that I can review the game without opening the JSON

  Background:
    Given a MatchLog with an empty summary
    And two GameStates, before and after

  Rule: Move kinds accumulate

    Scenario: New log starts at zero counters
      When createMatchLog runs
      Then steps, endTurns, closes, and cuts are 0
      And firstCloseAt is unset

    Scenario: A step increments steps
      Given a batch of one step
      And after equals before
      When foldMatchSummary runs
      Then steps is 1
      And endTurns, closes, and cuts stay 0

    Scenario: An end-turn increments end-turns
      Given a batch of one endTurn
      And after equals before
      When foldMatchSummary runs
      Then endTurns is 1
      And steps stay 0

  Rule: Territory and trail proxies

    Scenario: Territory gain is a close
      Given player A's territory count is higher after than before
      And no trail shrank
      And a batch of one step
      When foldMatchSummary runs
      Then closes is 1
      And cuts is 0
      And firstCloseAt is the movesLoggedBefore index

    Scenario: Enemy trail shrink without that player gaining territory is a cut
      Given player B's trail is smaller after than before
      And no player's territory count increased
      And a batch of one step
      When foldMatchSummary runs
      Then cuts is 1
      And closes is 0
      And firstCloseAt stays unset

    Scenario: firstCloseAt is the batch-start index
      Given the log already holds 4 moves
      And this batch of one step grows A's territory
      When appendMovesWithSummary runs
      Then firstCloseAt is 4
      And the log now holds 5 moves

  Rule: Format and HUD gating

    Scenario: Format is the locked one-line string
      Given a summary of 12 steps, 3 end-turns, 1 close, 0 cuts
      And firstCloseAt is 7
      Then formatMatchSummary is "12 steps · 3 end-turns · 1 closes · 0 cuts · first close @ move 7"

    Scenario: Empty list is a no-op
      Given a non-empty summary
      When foldMatchSummary is called with an empty moves list
      Then the summary is unchanged
      And appendMovesWithSummary leaves the log unchanged

    Scenario: Match over shows the summary line
      Given victory.kind is over
      And a summary of 2 steps, 1 end-turn, 0 closes, 0 cuts
      Then matchSummaryLine equals "2 steps · 1 end-turns · 0 closes · 0 cuts"

    Scenario: In play the summary line is unset
      Given victory.kind is playing
      And a non-zero summary
      Then matchSummaryLine is undefined
