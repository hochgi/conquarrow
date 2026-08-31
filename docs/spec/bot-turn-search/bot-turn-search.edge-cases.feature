# language: en
# Overview: docs/spec/bot-turn-search/bot-turn-search.md
# Adapter only — determinism, budget, frozen greedy, seams

Feature: Bot turn search — budget, determinism, and frozen greedy-v1
  As the web adapter
  I want beam-v1 bounded, deterministic, and unable to invent a clock
  So that replays match and the UI never janks, while greedy-v1 stays a fair baseline

  Background:
    Given a GeometryPort and a RulesPort
    And seat Bot is to move

  Rule: Shuttle rate on the committed baseline

    Scenario: beam-v1 shuttles under 10 percent of baseline heuristic turns
      Given the committed P53 baseline match log
      And each heuristic seat's turn-start reconstructed by replay
      When chooseTurnBeam plans each of those turn-starts
      Then the fraction of those plans that contain a shuttle is below 10 percent

    Scenario: beam-v1 uses count greater than 1 more than greedy-v1 on those turns
      Given the same reconstructed heuristic turn-starts
      When chooseTurnBeam and chooseTurnGreedy each plan them
      Then beam-v1's share of steps with count greater than 1 is materially larger than greedy-v1's

  Rule: Determinism

    Scenario: Same state yields the same plan twice
      Given a playing GameState whose active player is Bot
      When chooseTurnBeam runs twice
      Then both move lists are deeply equal

    Scenario: Map insertion order does not change the plan
      Given a playing GameState whose active player is Bot
      And a second GameState equal except groups and territory Maps were rebuilt with shuffled insertion
      When chooseTurnBeam runs on both
      Then both move lists are deeply equal

    Scenario: Equal evaluate completes break on planKey
      Given two complete plans with the same evaluate score and different planKeys
      When the search compares them
      Then it picks the smaller planKey

  Rule: Node cap and horizon

    Scenario: Search apply count never exceeds MAX_APPLIES
      Given a playing opening on the generated tiling
      When chooseTurnBeam runs
      Then the search's successful rules.apply count is at most 2000

    Scenario: Hitting the cap still returns a valid deterministic plan
      Given a position whose search would exceed MAX_APPLIES at the default budget
      And MAX_APPLIES is stubbed low enough to fire
      When chooseTurnBeam runs twice
      Then both plans are equal
      And each plan is a legal sequence from the start state
      And each plan ends with endTurn or a move that hands the seat or ends the match

    Scenario: MAX_PLAN stops extension
      Given Bot can legally take more than MAX_PLAN minus 1 steps
      When chooseTurnBeam runs
      Then the returned plan has length at most MAX_PLAN
      And it terminates

    Scenario: endTurn is considered even when it is not among the BRANCH steps
      Given a position with more than BRANCH legal steps
      And passing evaluates strictly better than any one-step extension
      When chooseTurnBeam runs
      Then the plan is only endTurn

  Rule: greedy-v1 stays frozen; findings do not decide the beam

    Scenario: greedy-v1 still never passes while a step exists
      Given a playing GameState with at least one legal step for Bot
      When chooseMove runs
      Then the returned move is a step

    Scenario: greedy-v1 still short-circuits on a legal finding
      Given bestFindingMove returns a legal step M
      When chooseMove runs
      Then the returned move is M

    Scenario: Findings order beam expansion but do not short-circuit it
      Given findings rank a shuttle first
      And a count=2 homeward close of the same stack evaluates higher
      When chooseTurnBeam runs
      Then the plan strides
      And the plan does not contain that shuttle

  Rule: Purity and hexagonal seams

    Scenario: Search and evaluate mobility mention no clock or RNG
      Then the new chooseTurn and mobility code does not mention Date, Math.random, or performance.now

    Scenario: pagesHeuristic still calls chooseMove
      Then packages/online-api/src/pages-heuristic.ts still imports chooseMove
      And it does not import chooseTurnBeam

    Scenario: Winner set yields an empty plan
      Given a GameState whose winner is set
      When playBotTurn runs for Bot
      Then the returned moves are empty

  Rule: Mobility term

    Scenario: Boxing an enemy raises evaluate by the scaled exit-head product
      Given an otherwise identical pair of states
      And in the boxed state enemy E's 3-stack has 0 legal exits
      And in the open state that stack has 3 legal exits
      When evaluate runs with rules on both, for Bot
      Then the boxed score exceeds the open score by MOBILITY_SCALE times 9

    Scenario: Boxing yourself lowers evaluate
      Given Bot's only group has 3 legal exits
      And a second state where that group has 0 legal exits and nothing else changed
      When evaluate runs with rules on both, for Bot
      Then the boxed-self score is lower by MOBILITY_SCALE times heads times 3
