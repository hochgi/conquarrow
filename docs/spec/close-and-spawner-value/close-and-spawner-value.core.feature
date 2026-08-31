# language: en
# Overview: docs/spec/close-and-spawner-value/close-and-spawner-value.md
# Adapter only — local heuristic close value, not a game rule

Feature: Closing and spawner value — walk home at a rate
  As a local heuristic seat
  I want close value to be loot per turn, discounted by cut risk
  So that I bank a share instead of milling a pinwheel, and I take the
  fast close when extending is not worth the extra turns

  Background:
    Given a GeometryPort and a RulesPort
    And seat Bot is to move
    And SHARE_VALUE_S is 100
    And ARROW_VALUE_A is 25

  Rule: The rate decides fast versus big

    Scenario: A 2-turn one-share close beats a 6-turn two-share close
      Given exposure is 0
      And two candidate closes with equal arrows
      And the first banks 1 share in 2 turnsToClose
      And the second banks 2 shares in 6 turnsToClose
      When closeValue ranks them
      Then the 2-turn close is preferred

    Scenario: A 3-turn two-share close beats a 2-turn one-share close
      Given exposure is 0
      And two candidate closes with equal arrows
      And the first banks 1 share in 2 turnsToClose
      And the second banks 2 shares in 3 turnsToClose
      When closeValue ranks them
      Then the 3-turn close is preferred

    Scenario: Three shares in one closure beat three one-share closures
      Given exposure is 0
      And equal turnsToClose
      And equal total arrows
      And one candidate claims 3 shares
      And the other is the sum of three candidates that each claim 1 share
      When closeValue ranks them
      Then the three-share closure is preferred
      And shareTerm of 3 is greater than 3 times shareTerm of 1

  Rule: close_path walks home

    Scenario: A trail tip emits close_path toward own territory
      Given Bot has a group on Bot's trail
      And distanceToTerritory from that group is between 1 and distCap inclusive
      And a legal step from that group strictly reduces that distance
      When collectFindings runs for Bot
      Then a close_path finding exists from that group
      And that finding's move strictly reduces distanceToTerritory
      And that finding's goal is a Bot-territory arrow

    Scenario: beam-v1 takes the homeward close_path
      Given Bot has a trail tip whose close_path landing is two grain steps away
      And that landing is a legal close
      And no competing immediate claim_share or cut is available
      When chooseTurnBeam runs
      Then some prefix of the plan reduces distanceToTerritory to 0
      And the plan does not contain a shuttle

  Rule: The mill guard is a close, not a skip

    Scenario: A group standing on an open share emits close_path not approach
      Given Bot has a group standing on an unowned spawner-border arrow
      And that arrow is on Bot's trail
      And a sibling border of the same vertex is also unowned
      And a legal step from the group reduces distanceToTerritory
      When collectFindings runs for Bot
      Then a close_path finding exists from that group
      And no approach_spawner finding exists from that group

    Scenario: beam-v1 banks the share instead of hopping to a sibling
      Given Bot has a group standing on an unowned spawner-border arrow
      And a sibling border is a legal exit
      And a homeward exit is also legal
      When chooseTurnBeam runs
      Then the first step from that group is not onto the sibling border
      And the first step from that group reduces distanceToTerritory

  Rule: Exposure flips the same comparison

    Scenario: An enemy two arrows from the trail raises exposure
      Given two GameStates that differ only by one enemy group's arrow
      And in the threatened state that group is grain distance 2 from Bot's trail
      And in the quiet state no enemy group is within distCap of Bot's trail
      When exposure runs for Bot on both
      Then the threatened exposure is strictly greater than the quiet exposure
      And the quiet exposure is 0

    Scenario: Threatened, the 2-turn close beats the 3-turn two-share close
      Given a 2-turn one-share close and a 3-turn two-share close with equal arrows
      And exposure is the threatened value from an enemy at grain distance 2
      When closeValue ranks them
      Then the 2-turn close is preferred

  Rule: Live chooser is still the beam

    Scenario: playBotTurn still plans with beam-v1
      Given a playing GameState whose active player is Bot
      When playBotTurn runs for Bot
      Then the returned moves equal chooseTurnBeam on that state
