# language: en
# Overview: docs/spec/close-and-spawner-value/close-and-spawner-value.md
# Adapter only — seams, mill, purity, frozen online greedy

Feature: Closing and spawner value — boundaries and seams
  As the web adapter
  I want close value bounded, deterministic, and swappable at exposure
  So that P55 can replace the proxy without re-deriving survival, and
  greedy-v1 stays a fair shuttle baseline

  Background:
    Given a GeometryPort and a RulesPort
    And seat Bot is to move

  Rule: Survival and the P55 seam

    Scenario: Zero exposure yields survival 1 at every horizon
      Given exposure is 0
      When survival is evaluated at turnsToClose 1, 2, and 6
      Then each result is 1

    Scenario: Closing this turn is undiscounted
      Given exposure is positive
      When survival is evaluated at turnsToClose 1
      Then the result is 1

    Scenario: turnsToClose uses speed
      Given grain distance 4 and a 2-stack
      When turnsToClose runs
      Then the result is 2
      And a 1-stack at the same distance yields 4

    Scenario: A zero-share land bridge still has arrow loot
      Given a candidate close with 0 shares and 3 arrows
      And turnsToClose is 3
      And exposure is 0
      When ungated closeValue runs
      Then the result equals 25

  Rule: Estimator and homeward reuse

    Scenario: Loot counts trail and homeward path, not fill
      Given Bot's trail includes one open spawner-border arrow
      And the homeward path to territory lays one more non-share arrow
      And an unowned spawner-border arrow sits strictly inside the loop but not on trail or path
      When the close_path loot is estimated
      Then shares is 1
      And arrows is the trail-plus-path count excluding the landing
      And the interior border is not counted

    Scenario: Homeward distance is distanceToTerritory
      Then findings close_path distance uses botEvaluate distanceToTerritory
      And findings.ts does not contain a second grain-to-territory function body

    Scenario: Beyond distCap there is no close_path
      Given Bot has a trail tip whose distanceToTerritory exceeds distCap
      When collectFindings runs for Bot
      Then no close_path finding exists from that tip

  Rule: Mill, claims, and move shape

    Scenario: Visiting a border is still not claim_share
      Given Bot has a legal step onto an unclaimed spawner-border arrow
      And applying that step does not raise Bot's share count
      When collectFindings runs for Bot
      Then that step is not a claim_share finding

    Scenario: close_path strides the homeward exit
      Given a 2-stack on trail with a distance-reducing exit legal at count 1 and count 2
      When collectFindings runs for Bot
      Then the close_path move from that stack has count 2

    Scenario: Immediate close outranks close_path
      Given Bot has a legal one-step close
      And Bot also has a multi-step close_path from another group
      When bestFindingMove runs
      Then the returned move is the one-step close

    Scenario: close_path outranks approach_spawner in kind order
      Given bestFindingMove's kind list
      Then close_path appears after attack and before approach_spawner

  Rule: Purity, frozen greedy, frozen Pages

    Scenario: Close-value code mentions no clock or RNG
      Then botClose.ts and the close_path branch do not mention Date, Math.random, or performance.now

    Scenario: Map insertion order does not change exposure or the plan
      Given a constructed close_path position
      And a second GameState equal except groups, trails, spawners, and territory Maps were rebuilt with shuffled insertion
      When exposure, campaignTarget, and chooseTurnBeam run on both
      Then both exposures are equal
      And both campaign targets are equal
      And both move lists are deeply equal

    Scenario: pagesHeuristic still calls chooseMove
      Then packages/online-api/src/pages-heuristic.ts still imports chooseMove
      And it does not import chooseTurnBeam

    Scenario: greedy-v1 still never passes while a step exists
      Given a playing GameState with at least one legal step for Bot
      When chooseMove runs
      Then the returned move is a step

  Rule: Measuring stick stays relative

    Scenario: P53 shuttle head-to-head remains the CI assertion
      Given the committed P53 baseline heuristic turn-starts
      When chooseTurnBeam and chooseTurnGreedy each plan them
      Then beam-v1's shuttle rate is below greedy-v1's and below 10 percent
      And beam-v1's share of steps with count greater than 1 exceeds greedy-v1's

    Scenario: pnpm bots still reports closes without gating them
      Given the default bots seed set
      When the bots report runs
      Then the table still includes closes per 100 turns and firstCloseAt
      And no committed test asserts an absolute threshold on those two columns

  Rule: Campaign gate, weights, and quiet dirt

    Scenario: A quiet dirt close gates to zero
      Given a candidate close with 0 shares
      And hitsCampaign is false
      And advancesCampaign is false
      And exposure is 0
      When the dirt-gated close value is computed
      Then the result equals 0

    Scenario: Under fire a dirt close keeps the P54 rate
      Given a candidate close with 0 shares and 3 arrows
      And hitsCampaign is false
      And advancesCampaign is false
      And turnsToClose is 1
      And exposure is greater than 0
      When the dirt-gated close value is computed
      Then the result equals ungated closeValue of 0 shares, 3 arrows, 1 turn, that exposure

    Scenario: A 0-share close that advances the campaign keeps the P54 rate
      Given a candidate close with 0 shares and 3 arrows
      And hitsCampaign is false
      And advancesCampaign is true
      And turnsToClose is 3
      And exposure is 0
      When the dirt-gated close value is computed
      Then the result equals 25

    Scenario: Quiet-board dirt close_path is omitted from findings
      Given Bot has a trail tip whose close_path is a quiet dirt close
      And exposure is 0
      When collectFindings runs for Bot
      Then no close_path finding exists from that tip

    Scenario: BotDrive weights are all 1
      Then BOT_DRIVE shareLoot is 1
      And BOT_DRIVE arrowLoot is 1
      And BOT_DRIVE campaignPull is 1
      And BOT_DRIVE bankUnderFire is 1

    Scenario: campaignTarget is undefined when every spawner is monopolised
      Given Bot owns all three shares of every spawner vertex
      When campaignTarget runs for Bot
      Then the result is undefined

    Scenario: campaignTarget ties break on vertex id
      Given two spawner vertices with equal force, equal missing own shares, and equal grain distance from Bot's nearest group
      And Bot owns fewer than 3 shares of each
      When campaignTarget runs for Bot
      Then the result is the vertex with the lesser id

    Scenario: After the first home close the plan is not a dirt-only close
      Given the 6-seat generated opening
      And the active seat has completed one 0-share home mill close
      And a campaign-advancing complete exists inside the beam
      When chooseTurnBeam runs
      Then the plan is not a quiet dirt-close complete
