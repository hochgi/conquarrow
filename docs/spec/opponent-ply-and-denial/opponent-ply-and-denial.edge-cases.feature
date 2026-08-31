# language: en
# Overview: docs/spec/opponent-ply-and-denial/opponent-ply-and-denial.md
# Adapter only — budgets, depth, purity, frozen online greedy

Feature: Opponent ply and denial — boundaries and seams
  As the web adapter
  I want one ply, a hard reply budget, and no nested search
  So that the node cap holds and greedy-v1 stays a fair shuttle baseline

  Background:
    Given a GeometryPort and a RulesPort
    And seat Bot is to move

  Rule: Depth, reach, and whose chair

    Scenario: Inner reply search does not run opponent ply
      Given a complete Bot terminal with a reachable enemy
      When that enemy's chooseTurnBeamWithBudget runs as a reply
      Then withReplies is false
      And no nested reply search runs

    Scenario: Unreachable enemies are skipped
      Given an enemy group whose grain distance to all of Bot's arrows exceeds distCap
      When chooseTurnBeam plans for Bot
      Then no reply search runs for that enemy
      And exposure for Bot is 0 when every enemy is out of cap

    Scenario: The reply does not apply intervening endTurns
      Given the next chair is B and the reachable threat is C
      When a reply for C is constructed
      Then the reply start state's activePlayer is C
      And no endTurn was applied to pass B

    Scenario: Enemy economy is not modelled
      Given a reachable enemy sitting on an open spawner share
      When their reply search runs
      Then the reply start state has the same accumulators as Bot's terminal

  Rule: Budgets and ranking seams

    Scenario: One enemy reply respects REPLY_MAX_APPLIES
      Given a counted RulesPort
      When a reply search runs for one enemy
      Then successful apply count inside that search is at most REPLY_MAX_APPLIES
      And a forced terminating endTurn may apply over that cap

    Scenario: Reply applies across a bot turn stay within REPLY_TURN_APPLIES
      Given a counted RulesPort
      When chooseTurnBeam runs with withReplies true
      Then the sum of apply counts inside all replies is at most REPLY_TURN_APPLIES
      And the bot's own search applies remain at most MAX_APPLIES

    Scenario: Exhausted reply budget still returns a legal plan
      Given REPLY_TURN_APPLIES is tight enough that some completes get no reply
      When chooseTurnBeam runs
      Then the returned plan is a legal turn ending in endTurn or a handoff
      And skipped completes rank by unreplied evaluate

    Scenario: Incomplete beam slots are not reply-scored
      Given an incomplete plan still on Bot's chair
      When the beam ranks incompletes
      Then their order uses unreplied evaluate then planKey

  Rule: Safe plans and self-mobility

    Scenario: The bot declines a takeable stack when a safe equal plan exists
      Given two Bot plans that tie on unreplied evaluate
      And the first leaves a Bot 2-stack a reachable enemy 2-stack can attack this reply
      And the second does not
      When chooseTurnBeam ranks them
      Then the second plan is preferred

    Scenario: The bot prefers two exits over one when an enemy can reach
      Given a Bot group with three legal exits and the same group boxed to zero
      And an enemy is grain-reachable
      When replyScore runs on both terminals
      Then the mobile terminal has the higher replyScore

  Rule: Purity, frozen online, head-to-head

    Scenario: Map insertion order does not change exposure or the plan
      Given a constructed reply position and a Map-order shuffle of groups trails and territory
      When exposure and chooseTurnBeam run on both
      Then both exposures are equal
      And both plans are equal

    Scenario: Reply search uses no clock and no RNG
      Given the web modules that implement replies and exposure
      Then they do not mention Date Math.random or performance.now

    Scenario: pagesHeuristic still calls chooseMove
      Given packages/online-api/src/pagesHeuristic.ts
      Then it does not contain chooseTurnBeam

    Scenario: beam-v1 still beats greedy-v1 on the shuttle head-to-head
      Given the committed P53 baseline heuristic turn-starts
      When both chooseTurnBeam and chooseTurnGreedy re-plan each
      Then beam-v1's shuttle rate is below greedy-v1's
      And beam-v1's shuttle rate is below 10 percent
      And beam-v1's share of count greater than 1 exceeds greedy-v1's
