# language: en
# Overview: docs/spec/refuse-self-convert/refuse-self-convert.md
# SPEC §6.3, §6.2, §11 item 43

Feature: Refuse self-convert — combat, portions, opponent convert, adapter
  As the rules engine and the board adapter
  I want attacks, remainders, and opponent-caused conversion pinned
  So that a refused walk-in cannot be smuggled through combat or a UI click

  Background:
    Given a board behind GeometryPort
    And a game state of occupancy, trails and territory
    And it is player A's turn

  Rule: Attacks

    Scenario: Unprotected attack onto an enemy stack standing on that enemy's territory is illegal
      Given A's stack-grade fragment, size at least 2
      And exit is B's territory and holds a B group
      And exit is a grain out of from
      When A lists legal moves
      Then no attack step to exit is offered
      When A applies that step anyway
      Then apply refuses before combat
      And defender heads are unchanged

    Scenario: Protected raid may still attack on enemy territory
      Given A's territory-grade trail into B's land
      And exit is B's territory and holds a B group
      And A has a stay-behind
      When A lists legal moves
      Then an attack step to exit is offered
      When A applies it
      Then combat resolves under contact combat as today

    Scenario: Unprotected attack onto an enemy stack on neutral ground is not this rule
      Given A's stack-grade fragment
      And exit is unclaimed and holds a B group
      And exit is a grain out of from
      When A lists legal moves
      Then stay-behind and combat apply
      And the step is not refused for convert

  Rule: Portions and remainders

    Scenario: Every count is omitted
      Given a size-16 stack-grade fragment
      And an enemy-territory grain out of from
      When A lists legal moves
      Then legalMoves contains no step to that out at any count 1 through 16

    Scenario: Leaving a sentry on the fragment does not license the advance
      Given size 16 on stack-grade trail
      And count 15 onto B's territory
      When A lists legal moves
      Then that step is still omitted
      When A applies it anyway
      Then apply refuses
      # Protection is the trail's grade, not the remainder.

  Rule: Opponent-caused conversion unchanged

    Scenario: Cut demotion of a raider already inside still converts
      Given B stands on A's territory with a territory-grade trail
      And A's step cuts that trail so the remaining grade is not territory
      When the step resolves
      Then B's group converts to A intact
      # encirclement.core "Cutting a raider's territory-grade trail…"

    Scenario: Closure around an unprotected garrison still converts
      Given A's closure claims an arrow occupied by B with no territory-grade trail
      When the closure commits
      Then that group is owned by A after commit
      # encirclement.core / P05b seam

    Scenario: Not stepping still does not convert an authored encircled group
      Given an authored state where B is already encircled on A's territory
      When A steps nothing and ends the turn
      Then the groups, territory and trails are unchanged
      # encirclement.edge "Not stepping does not itself convert…"

  Rule: Purity / port agreement

    Scenario: Refused apply does not mutate the input state
      Given a self-convert step against state S0
      When apply throws
      Then S0's groups, trails, and territory are unchanged

    Scenario: Equal illegal inputs throw equal messages
      Given two equal copies of a self-convert setup
      When apply of the same step is attempted on each
      Then both throw ContractViolation
      And both messages are identical
      And the message is "step onto enemy territory without a territory-grade trail would convert"

    Scenario: Every remaining legalMoves step applies without throw
      Given a stack-grade fragment neighbouring enemy land
      When A lists legal moves
      Then every offered move applies without throw
      # Existing movement invariant; this fixture puts the filter in the pool.

  Rule: Adapter clicks and hover seams

    Scenario: Clicking a refused target drafts nothing and does not apply
      Given a refused convert exit while the unprotected stack is selected
      When the player clicks that exit
      # Was "no portion picker opens" until P34 retired the picker outright, which
      # made the step vacuous. What is still worth asserting is that the click does
      # nothing and costs nothing: the refused exit is not in the route phase's
      # clickable set (P34's edge cases assert that membership directly), so the
      # click refuses and the open draft survives it.
      Then the route phase survives the click with the same source
      And the draft is unchanged
      And apply is not called

    Scenario: Unclaimed grain out from the same fragment is ordinary reach
      Given A's stack-grade fragment is selected
      And exit is unclaimed and a grain out of from
      Then exit is ordinary reach
      And there is no convert tooltip for exit

    Scenario: No convert tooltip when no stack is selected
      Given no stack is selected
      And the cursor hovers an arrow that would be a refused convert target if selected
      Then there is no convert tooltip
      And spawner hover is unchanged

    Scenario: Convert tooltip wins over spawner hover
      Given the unprotected stack is selected
      And the refused convert exit also borders a spawner
      When the player hovers that exit
      Then the convert tooltip is shown
      And a spawner tooltip is not stacked with it

    Scenario: Hud help may mention the refusal; the tooltip string stays locked
      Given the HUD help text
      Then any mention of the refusal does not replace the convert tooltip
      And the convert tooltip remains
        "Would convert. This is their territory, and you have no trail home."
