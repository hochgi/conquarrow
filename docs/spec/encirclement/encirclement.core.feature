# language: en
# Overview: docs/spec/encirclement/encirclement.md
# SPEC §6.3, §11 items 9, 28, 40

Feature: Encirclement — convert heads inside enemy territory
  As the rules engine
  I want enemy stacks without a territory-grade trail to convert when inside my land
  So that closure and demotion capture intact forces rather than chipping them

  Background:
    Given a board behind GeometryPort
    And a game state of occupancy, trails and territory
    And it is player A's turn

  Rule: Closure converts enclosed enemy stacks intact

    Scenario: Closing around a lone enemy head converts it
      Given player B has 1 head on an arrow that player A's closure will claim
      And that head has no territory-grade trail for B
      When player A completes the closure
      Then that arrow is player A's territory
      And the group on it is owned by A with 1 head
      And its spent equals the speed of 1 head

    Scenario Outline: Stacks convert intact
      Given player B has <N> heads on an arrow that player A's closure will claim
      And that stack has no territory-grade trail for B
      When player A completes the closure
      Then the group on that arrow is owned by A with <N> heads

      Examples:
        | N |
        | 1 |
        | 2 |
        | 3 |

    Scenario: Converted stack drops spent and merge override
      Given player B's encircled stack had spent > 0 or a merge override
      When it converts
      Then spent equals the speed of that stack's heads
      And no merge override remains
      # §11 item 40.

  Rule: Territory grade protects; lesser grades do not

    Scenario: A territory-grade trail into enemy land does not convert
      Given player B stands on player A's territory
      And B's trail from that arrow reaches B's own territory
      When an apply resolves without cutting that trail
      Then the group remains owned by B

    Scenario: A stack-grade raider inside enemy territory converts
      Given player B stands on player A's territory
      And B's trail is stack grade only
      When an apply resolves
      Then the group converts to A

    Scenario: A head with no trail on enemy territory converts
      Given player B stands on player A's territory with no trail for B
      When an apply resolves
      Then the group converts to A

  Rule: Cut demotion then conversion on the same step

    Scenario: Cutting a raider's territory-grade trail inside enemy land converts them
      Given player B stands on player A's territory with a territory-grade trail
      And player A's step cuts that trail so the remaining grade is not territory
      When the step resolves
      Then combat or cut effects apply first
      And then the group converts to A
      # P33: conversion then wipes victim trail from converted arrows (item 40).
