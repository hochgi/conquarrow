# language: en
# Overview: docs/spec/close-and-spawner-value/close-and-spawner-value.md
# Adapter only — local heuristic close value, not a game rule

Feature: Closing and spawner value — walk home at a rate, then toward production
  As a local heuristic seat
  I want close value to be loot per turn, gated by a campaign vertex
  So that I bank a share instead of painting empty dirt, and I take the
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

    @superseded-P55
    Scenario: An enemy two arrows from the trail raises exposure
      Given two GameStates that differ only by one enemy group's arrow
      And in the threatened state that group is grain distance 2 from Bot's trail
      And in the quiet state no enemy group is within distCap of Bot's trail
      When exposure runs for Bot on both
      Then the threatened exposure is strictly greater than the quiet exposure
      And the quiet exposure is 0

    @superseded-P55
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

  Rule: Campaign target aims the leave at production

    Scenario: campaignTarget prefers a contested vertex over a monopolised nearer one
      Given a constructed board where Bot monopolises a nearer home-adjacent spawner vertex
      And a farther centre vertex is a spawner Bot owns fewer than 3 shares of
      When campaignTarget runs for Bot
      Then the result is the contested farther vertex
      And the result is not the monopolised nearer vertex

    Scenario: After a 0-share home close the departing exit walks toward campaignTarget
      Given the 6-seat generated opening
      And the active seat has completed one 0-share home mill close
      And that seat holds more than 3 territory arrows
      And that seat's trail is empty
      And every own group stands on own territory
      When chooseTurnBeam runs
      Then some step lands on an arrow that is not that seat's territory
      And the first departing step strictly reduces grain distance to campaignTarget
        or lands on a shortest grain path to it

    Scenario: On a quiet board a 1-turn dirt close loses to a 3-turn campaign-share walk
      Given exposure is 0
      And Bot can close a 1-turn 0-share 3-arrow loop that does not hit or advance campaignTarget
      And Bot can walk 3 turns to border one unowned share of campaignTarget
      When chooseTurnBeam runs
      Then the plan does not terminate as that 0-share loop
      And the plan is not a quiet dirt-close complete

    Scenario: Under fire the 1-turn empty loop is the P54 corridor again
      Given the same constructed board as the quiet dirt-close case
      And an enemy group is grain-reachable to Bot's open trail
      And exposure is greater than 0
      When preferClose ranks the 1-turn 0-share loop against the 3-turn one-share walk
      Then the 1-turn loop is preferred
      And the 1-turn loop's gated close value is the P54 rate, not 0

    Scenario: approach_spawner ranks departing exits toward campaignTarget
      Given Bot has a legal departing exit that strictly reduces grain distance to campaignTarget
      And a legal departing exit that is closer to some other unowned spawner and farther from campaignTarget
      When collectFindings runs for Bot
      Then an approach_spawner finding exists whose goal is a border of campaignTarget
      And no higher-ranked approach_spawner finding aims at the farther-from-campaign spawner
