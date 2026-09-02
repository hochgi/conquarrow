# language: en
# Overview: docs/spec/mission-and-staging/mission-and-staging.md
# Adapter only — local heuristic mission menu and staging, not a game rule

Feature: Mission and staging — edges
  As a local heuristic seat
  I want the mission filter to degrade to a legal turn, and to refuse a
    threatened kite without inventing a move
  So that a missing findings rank cannot freeze the chair, and Pages
    stays on chooseMove

  Background:
    Given a GeometryPort and a RulesPort
    And seat Bot is to move
    And KITE_RATIO is 2

  Rule: Missing V, empty filter, kite without staging

    Scenario: Undefined campaign target does not invent a second campaign
      Given a constructed board where Bot monopolises every spawner vertex
      And origin exposure is 0
      When campaignTarget runs for Bot
      Then the result is undefined
      When missionsOf runs for Bot
      Then remainingPath is CAMPAIGN_DIST_CAP plus 1
      And the mission list does not name a vertex other than contest
      When chooseTurnBeam runs
      Then the plan is a legal turn ending in endTurn
      And a quiet 0-share close that does not drop remainingPath has gated close value 0

    Scenario: Empty on-mission filter falls back to unfiltered selectBranch
      Given a parent incomplete whose selectBranch on-mission filter is empty
      When chooseTurnBeam expands that parent
      Then unfiltered selectBranch fires for that parent only
      And the returned plan is a legal turn ending in endTurn

    Scenario: Threatened kite with no staging complete returns the least-kite plan
      Given contest is listed
      And a threatened kite complete exists in the beam
      And no staging close complete exists in the beam
      And a non-kite contest walk or pass exists in the beam
      When chooseTurnBeam runs
      Then the plan is not isThreatenedKite
      And the plan is that non-kite contest walk or pass
      Given contest is listed
      And every contest complete in the beam is a threatened kite
      And no staging close complete exists in the beam
      When chooseTurnBeam runs
      Then the plan is the complete with smallest kiteLength then smaller planKey
      And the plan is a legal turn the beam already adopted
      And the system does not invent a move

    Scenario: Enemy-reachable short 0-share close is not staging
      Given a quiet constructed board
      And Bot can close a 1-turn 0-share loop that drops remainingPath to V
      And an enemy group grain-reaches that loop's projected trail within REPLY_DIST
      When isStagingClose runs on that complete
      Then the result is false
      Given the same loop
      And origin exposure is greater than 0
      And Bot has an open trail
      When missionsOf runs for Bot
      Then the mission list starts with bank
      When chooseTurnBeam runs
      Then a 1-turn land-bridge may keep the P54 corridor rate

  Rule: Insertion order, replies, Pages, frozen greedy

    Scenario: Map insertion shuffle does not change missionsOf or the plan
      Given a constructed mission position
      When state.groups, state.territory, and state.trails are rebuilt with shuffled insertion
      And missionsOf and chooseTurnBeam each run on both orders
      Then the two mission lists are equal
      And the two plans are byte-identical

    Scenario: Pages still imports chooseMove not chooseTurnBeam
      Given packages/web/src/pages-heuristic.ts
      Then the file imports chooseMove
      And the file does not import chooseTurnBeam

    Scenario: Only finalists fold enemy replies and reply applies stay capped
      Given a live chooseTurnBeam with withReplies true
      And at least two adopted completes
      And missions lists one kind
      When chooseTurnBeam plans for Bot
      Then foldEnemyReply runs only for the finalist set
      And completes that are not finalists do not call foldEnemyReply
      And their replyScore equals evaluate of the terminal
      And summed rules.apply calls inside replies stay at most REPLY_TURN_APPLIES
      And nested enemy search runs with withReplies false

    Scenario: greedy-v1 output on P53 baseline positions is unchanged
      Given the committed P53 baseline heuristic turn-starts
      When chooseTurnGreedy plans them
      Then each plan equals the frozen greedy-v1 plan for that position
