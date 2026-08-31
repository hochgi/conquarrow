# language: en
# Overview: docs/spec/opponent-ply-and-denial/opponent-ply-and-denial.md
# Adapter only — local heuristic opponent ply, not a game rule

Feature: Opponent ply and denial — search the enemy's best reply
  As a local heuristic seat
  I want one enemy ply scored after each complete plan
  So that a firebreak, a block, a box, and declining a takeable stack
  fall out of "their best reply got worse" with no denial catalogue

  Background:
    Given a GeometryPort and a RulesPort
    And seat Bot is to move

  Rule: One reachable-enemy reply

    Scenario: Completes rank by replyScore then planKey
      Given two complete Bot plans that differ in replyScore
      When chooseTurnBeam ranks them
      Then the plan with the higher replyScore is preferred
      And when replyScore ties, the smaller planKey is preferred

    Scenario: The threatening seat is searched even when it is not next
      Given a 6-seat GameState whose next chair after Bot is B
      And enemy C has a group within grain-reach of Bot's trail
      And enemy B has no group within grain-reach
      When chooseTurnBeam plans for Bot
      Then a reply search runs for C
      And no reply search runs for B

  Rule: Firebreak and box fall out of the reply

    Scenario: The bot plants a firebreak on the unique cut path
      Given an enemy group two grain steps from Bot's open trail
      And an otherwise identical quiet board with no reachable enemy
      When replyScore runs on both terminals
      Then the threatened replyScore is not greater than the quiet replyScore
      And botEvaluate findings and botClose contain no firebreak identifier

    Scenario: The bot blocks the open exit of a boxable 1-stack
      Given an enemy 1-stack whose one open exit is arrow O
      And its other exits are Bot territory
      And Bot has a 2-stack that can occupy O this turn
      And no competing immediate claim_share or close is available
      When chooseTurnBeam runs
      Then some step in the plan has exit O

    Scenario: After the block, the boxed group has no legal step
      Given the position after Bot occupies O as in the box scenario
      And that enemy is hypothesised as the active chair
      When chooseTurnBeamWithBudget runs for that enemy with withReplies false
      Then the returned plan contains no step
      And the plan is endTurn only

  Rule: Exposure is real trail damage

    Scenario: A reply that evaporates trail raises exposure
      Given Bot has an open trail
      And a reachable enemy whose best reply shrinks that trail
      And an otherwise identical quiet state with no reachable enemy
      When exposure runs for Bot on both
      Then the threatened exposure equals the trail arrows lost
      And the quiet exposure is 0

    Scenario: playBotTurn still plans with beam-v1
      Given a playing GameState whose active player is Bot
      When playBotTurn runs for Bot
      Then the returned moves equal chooseTurnBeam on that state
