# language: en
# Overview: docs/spec/combat/combat.md
# SPEC §6.2, §11 items 6, 10, 37, 38

Feature: Contact combat — stepping onto an enemy-occupied arrow
  As the rules engine
  I want a step onto an enemy group to resolve deterministic losses
  So that shadowing stays legal and contact is the only fight

  Background:
    Given a fixture board behind GeometryPort
    And a game state of occupancy, trails and territory
    And it is player A's turn

  Rule: The only combat trigger is stepping onto an enemy group

    Scenario: Stepping onto an enemy-occupied arrow is an attack
      Given a group of player B's with D heads stands on arrow e1
      And a group of player A's has heads ≥ 2 and can step onto e1 with count A ≤ heads − 1
      When player A steps that count onto e1
      Then contact combat resolves between A and D
      And the step costs one of player A's allowance

    Scenario: Two stacks that merely point into the same point do not fight
      Given a head of player A's and a head of player B's both stand on in-arrows of point P
      And player A steps onto an empty out-arrow of P
      When the step resolves
      Then neither group loses a head to combat
      # §11 item 37: contested-point combat is withdrawn. Shadowing survives.

    Scenario: Not stepping declines advancing and fights nothing
      Given a head of player A's stands beside an enemy-occupied arrow
      When player A leaves it standing and ends the turn
      Then both groups' head counts are unchanged
      # No step is forced (§6.2), so standing beside an enemy fights nothing.

  Rule: Stay-behind on attack

    Scenario: A lone head cannot attack
      Given player A has exactly 1 head on arrow from1
      And arrow e1 holds an enemy group
      When player A would step that head onto e1
      Then the step is refused
      And legalMoves does not offer that count

    Scenario: An attack that would empty from is refused
      Given player A has N ≥ 2 heads on arrow from1
      And arrow e1 holds an enemy group
      When player A steps all N onto e1
      Then the step is refused
      # Stay-behind: count ≤ heads − 1.

  Rule: Threat-weighted floor losses — fight to wipe

    Scenario Outline: Equal stacks favour the attacker
      Given a defender of <D> heads on arrow e1
      And an attacker with heads = <A> + 1 leaves one behind and steps <A> heads onto e1
      When combat resolves
      Then the attacker has <A_left> heads remaining on e1
      And the defender has <D_left> heads remaining
      And the attacker occupies e1
      And one head remains on the attacker's source

      Examples:
        | A | D | A_left | D_left |
        | 1 | 1 | 1      | 0      |
        | 2 | 2 | 1      | 0      |
        | 3 | 3 | 2      | 0      |
        | 4 | 4 | 2      | 0      |

    Scenario: A moderately larger attacker may take zero floor loss
      Given a defender of 3 heads on arrow e1
      And an attacker with 6 heads leaves one behind and steps 5 onto e1
      When combat resolves
      Then the attacker's loss may be 0 after flooring
      And the defender is wiped
      And the attacker lands with 5 heads
      # Accepted PoC (§6.2): do not add min-1.

    Scenario: A wiped attacker does not land and does not mark trail
      Given losses that reduce the attacker's stepping heads to 0
      And the defender still has heads remaining
      And the attacker left a stay-behind on from
      When combat resolves
      Then the attacker does not occupy the destination
      And the destination is not marked in the attacker's trail
      And the stay-behind remains on from
      And the defender remains on that arrow with their remaining heads
      # §11 item 38.

    Scenario: A wiped defender yields the arrow to the attacker
      Given losses that reduce the defender to 0
      And the attacker has heads remaining
      When combat resolves
      Then the attacker occupies the destination with their remaining heads
      And the destination is marked as the attacker's trail
      And no group of the defender remains on that arrow

  Rule: Combat then cut on the same step

    Scenario: Contact on a trail arrow resolves combat before evaporation
      Given arrow e1 holds a group of player B's and is in player B's trail
      And player A's step onto e1 crosses player B's trail at the point transited
      And player A leaves a stay-behind
      When the step resolves
      Then combat losses are applied first
      And then player B's trail evaporates from the cut
      # Trail is independent of heads (§6.1a).
