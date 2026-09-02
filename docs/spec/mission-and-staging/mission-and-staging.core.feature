# language: en
# Overview: docs/spec/mission-and-staging/mission-and-staging.md
# Adapter only — local heuristic mission menu and staging, not a game rule

Feature: Mission and staging — search only the job, paint only as a step
  As a local heuristic seat
  I want beam-v1 to expand on-mission plans and to score a 0-share close
    only when it drops remaining path to the campaign vertex
  So that a staging loop beats a threatened share-kite, and replies run
    only on finalists

  Background:
    Given a GeometryPort and a RulesPort
    And seat Bot is to move
    And KITE_RATIO is 2

  Rule: Contest after the first home paint

    Scenario: Generated opening after a 0-share home close lists contest and still leaves toward V
      Given the 6-seat generated opening
      And the active seat has completed one 0-share home mill close
      And that seat holds more than 3 territory arrows
      And that seat's trail is empty
      And every own group stands on own territory
      And origin exposure is 0
      When missionsOf runs for that seat
      Then the mission list is only contest
      When chooseTurnBeam runs
      Then some step lands on an arrow that is not that seat's territory
      And the first departing step strictly reduces grain distance to campaignTarget
        or lands on a shortest grain path to it

  Rule: Sideways dirt still loses; staging is the exception

    Scenario: Quiet 1-turn 0-share loop that does not drop remainingPath loses to a walk toward V
      Given a quiet constructed board
      And campaignTarget V is defined
      And Bot can close a 1-turn 0-share loop that does not drop remainingPath versus origin
      And Bot can walk 3 turns toward an unowned share of V
      When chooseTurnBeam runs
      Then the plan is not that 0-share loop
      And the plan is not isSidewaysDirt when a contest-advancing complete existed

    Scenario: Staging close beats a threatened kite
      Given a quiet constructed board
      And campaignTarget V is defined
      And outbound remainingPath is at least 1
      And Bot can close a 1-turn 0-share loop that strictly drops remainingPath to V
      And Bot can walk to occupy a share of V whose kiteLength is at least KITE_RATIO times outbound
      And an enemy group grain-reaches that walk's projected trail within REPLY_DIST
      When chooseTurnBeam runs
      Then the plan is a staging close
      And the plan is not isThreatenedKite

    Scenario: Unthreatened share walk may take the kite
      Given the same geography as the staging-versus-threatened-kite board
      And no enemy group is within REPLY_DIST of that walk's projected trail
      When chooseTurnBeam runs
      Then the plan may occupy a share of V or walk toward V
      And staging is not required

  Rule: Bank, cut, and deny

    Scenario: Under fire the menu starts with bank and a 1-turn land-bridge is allowed
      Given Bot has an open trail
      And origin exposure is greater than 0
      And a 1-turn land-bridge that empties the trail is legal
      And a contest walk toward V is also legal
      When missionsOf runs for Bot
      Then the mission list starts with bank
      And contest is not listed
      When chooseTurnBeam runs
      Then the plan serves bank
      And the plan is not the contest walk when a bank-serving complete existed

    Scenario: A legal cut beats sideways dirt on a quiet board
      Given origin exposure is 0
      And Bot's trail is empty
      And collectFindings at origin contains a cut whose move is legal
      And a 1-turn 0-share loop that does not drop remainingPath is legal
      When missionsOf runs for Bot
      Then cut is listed
      When chooseTurnBeam runs
      Then some enemy trail is smaller than at origin
      And the plan is not that sideways dirt complete

    Scenario: Deny occupies the boxed enemy's open exit
      Given origin exposure is 0
      And enemy E has a 1-stack
      And two of that stack's exits are Bot territory
      And the remaining exit O is open
      And Bot has a 2-stack that can occupy O this turn
      And no competing immediate claim_share is available
      When missionsOf runs for Bot
      Then deny is listed
      And bank is not listed
      When chooseTurnBeam runs
      Then some step of the plan has exit O

  Rule: Determinism and P53 still hold

    Scenario: chooseTurnBeam twice on equal inputs returns byte-identical plans
      Given a playing GameState whose active player is Bot
      When chooseTurnBeam runs twice on that state
      Then the two move lists are byte-identical

    Scenario: P53 stride construction still strides and shuttle rate still holds
      Given Bot has a fresh 2-stack on its own trail
      And a two-arrow run home is legal at count 2 both steps
      And the second arrow is Bot territory so the landing is a close
      And shuttling the pair would not land
      And the close terminal evaluates higher than the shuttle and than passing
      When chooseTurnBeam runs
      Then the plan contains two consecutive count=2 steps along that run
      And the plan does not contain a shuttle
      Given the committed P53 baseline heuristic turn-starts
      When chooseTurnBeam and chooseTurnGreedy each plan them
      Then beam-v1's shuttle rate is below greedy-v1's
      And beam-v1's shuttle rate is below 10 percent of those turns
      And beam-v1's share of steps with count greater than 1 exceeds greedy-v1's
