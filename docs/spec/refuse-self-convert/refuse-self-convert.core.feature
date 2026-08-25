# language: en
# Overview: docs/spec/refuse-self-convert/refuse-self-convert.md
# SPEC §6.3, §4, §11 item 43

Feature: Refuse self-convert — unprotected entry onto foreign territory is illegal
  As a player whose stack stands on marked trail
  I want a step onto enemy territory refused unless I have a trail home
  So that I cannot convert myself by walking in, and I can still raid from home

  Background:
    Given a board behind GeometryPort
    And a game state of occupancy, trails and territory
    And it is player A's turn

  Rule: Unprotected entry onto foreign territory is illegal

    Scenario: Stack-grade fragment cannot step onto enemy territory
      Given A's stack stands on A's stack-grade trail
      And that trail has no path to A's territory
      And exit is B's empty territory and a grain out of from
      When A lists legal moves from that stack
      Then no step with that exit is offered
      When A applies step(from, exit, count) anyway
      Then the step is refused with a contract violation
      And the message is "step onto enemy territory without a territory-grade trail would convert"
      And occupancy, trails, and territory are unchanged

    Scenario: Unmarked stack on neutral cannot step onto enemy territory
      Given A's stack stands on a neutral arrow with no A trail on it
      And exit is B's empty territory and a grain out of from
      When A lists legal moves from that stack
      Then no step with that exit is offered
      When A applies that step anyway
      Then the step is refused with a contract violation
      And occupancy, trails, and territory are unchanged

    Scenario: Occupied marks that do not reach home are stack-grade and do not protect
      Given A's stack stands on arrows that are A's trail but do not reach A's territory
      Then anchorGrade of from for A is stack
      And a grain out that is B's territory is omitted from legalMoves
      And apply of that step is refused with a contract violation
      # A stack on marks cannot be dormant; dormant is headless. Pin the grade
      # so nobody "protects" via dormant.

  Rule: Territory-grade and home still raid

    Scenario: Territory-grade trail into enemy land remains legal and does not convert
      Given A's head stands on A's trail that reaches A's territory
      And exit is B's empty territory and a grain out of from
      When A steps onto exit
      Then the group on exit is still A's
      And exit is in A's trail
      And exit is still B's territory
      # Existing trails.core "Stepping into enemy territory marks trail" — that
      # fixture already authors a home feeder so the trail is territory-grade.

    Scenario: Stepping off own territory onto enemy territory remains legal
      Given from is A's territory and holds A's stack
      And exit is B's empty territory and a grain out of from
      When A steps onto exit
      Then the group on exit remains A's
      And exit is in A's trail
      # New trail departs home → territory-grade.

    Scenario: Coming home onto own territory is not this refusal
      Given A's stack-grade fragment has a grain out that is A's territory
      When A lists legal moves
      Then a step onto that out is offered
      # Closure / claim walk stay P05b + P42; this packet does not touch them.

  Rule: Neutral is not the trap

    Scenario: Stack-grade step onto unclaimed ground remains legal
      Given A's stack-grade fragment
      And exit is unclaimed and a grain out of from
      When A lists legal moves
      Then a step onto that out is offered
      When A applies it
      Then apply accepts
      And the group remains A's

  Rule: The board teaches the refused grain exit

    Scenario: Grain-adjacent enemy territory from an unprotected selected stack is a refused target
      Given A's stack-grade fragment is selected on from
      And exit is B's territory and a grain out of from
      Then exit is not in reachFrom
      And the refused-convert helper lists exit
      And hovering it shows cursor not-allowed
      And hovering it shows a tooltip whose text is exactly
        "Would convert. This is their territory, and you have no trail home."

    Scenario: Protected raid: the same grain out is ordinary reach
      Given A's territory-grade trail into B's land is selected on from
      And exit is B's empty territory and a grain out of from
      Then exit is ordinary reach
      And the refused-convert helper does not list exit
      And there is no convert tooltip for exit
