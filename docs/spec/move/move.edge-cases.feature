# language: en
# Overview: docs/spec/move/move.md
# SPEC §4 (order is data), §5 (sentries), §11 items 19, 20, 22

Feature: The move DTO — boundaries and the cases that must stay expressible
  As the rules core
  I want the DTO to make illegal shapes unrepresentable and legal play total
  So that no mechanic has to be added later to express something §4 already allows

  Rule: Order is data, because order changes outcomes

    Reinforcing a stack before another commits to a crossing is a legal and
    intended play. So a turn is a sequence, not a set — and a replay that
    reproduced the set would reproduce a different match.

    Scenario: Two turns differing only in order are not equal
      Given two turns containing the same moves in different orders
      When I compare them
      Then they are not equal

    Scenario: A stack may act more than once in a turn
      Given arrow a1 holds 3 heads belonging to player A
      When player A constructs two step moves originating from a1's advance
      Then both moves are well-formed
      And the DTO imposes no limit on how many moves name the same stack
      # Allowance is what limits this, and allowance is P04's business.

    Scenario: A split leaves the remainder able to act
      Given arrow a1 holds 3 heads belonging to player A
      When player A constructs a step move from a1 with count 1
      And player A constructs a further step move from a1 with count 2
      Then both moves are well-formed
      # SPEC §3: on a split both parts inherit `spent`, so only the portion
      # that moved has paid. The DTO must not treat a1 as spent.

    Scenario: A rear group may step onto an arrow the front group laid
      Given player A has stepped a group from arrow a1 to arrow a2
      When player A constructs a step move from a1 to a2 for the heads left behind
      Then the move is well-formed
      # SPEC §6.1a invariant 2: a trail is a set of arrows, so stepping onto one
      # it already holds is legal and adds nothing. A lagging group is ordinary
      # play — it is how a spearhead brings its firebreaks along.

    Scenario: Moves from different stacks may be interleaved
      Given player A holds stacks on arrows a1 and a2
      When player A constructs a move from a1, then from a2, then from a1 again
      Then the turn is well-formed
      And the moves appear in that order
      # A 3-stack at 11/6 does not have to spend its steps consecutively.

  Rule: Declining is the absence of a move

    Nothing compels a step (§4). A stack that stays put is named nowhere in the
    record — there is no move that means *not*, so a turn in which nothing moved
    is a turn holding nothing but its ending. (P51 deleted the kind that used to
    record the decision.)

    Scenario: A turn may be empty but for its ending
      When player A ends the turn without moving anything
      Then the turn is well-formed

  Rule: Illegal shapes are unrepresentable, not merely invalid

    The DTO should make a whole class of bug impossible rather than detectable.

    Scenario Outline: A step cannot be constructed without all three fields
      When I construct a step move omitting the <field>
      Then construction fails

      Examples:
        | field  |
        | source |
        | exit   |
        | count  |

    Scenario: A step's source and exit may not be the same arrow
      Given arrow a1 holds 2 heads belonging to player A
      When player A constructs a step move from a1 to a1
      Then the move is rejected as malformed
      # A step goes somewhere. Staying put is no move at all.

    Scenario: There is no third move variant
      When I enumerate the move variants the DTO admits
      Then there are exactly 2
      And they are step and end-turn

  Rule: Counts at the boundary of a stack

    Scenario Outline: Counts spanning the whole range of a stack are well-formed
      Given arrow a1 holds 6 heads belonging to player A
      When player A constructs a step move from a1 with count <count>
      Then the move is well-formed

      Examples:
        | count | note                                  |
        | 1     | the smallest split                    |
        | 5     | leaving one head behind               |
        | 6     | taking everything, leaving the arrow empty |
      # Well-formed is not legal. §5 requires an anchor left behind when a move
      # creates a join or a split, so some of these counts are moves P04 must
      # reject at a branch point — but every one is a well-formed DTO, and that
      # separation is the point.

    Scenario: Taking every head is well-formed
      Given arrow a1 holds 1 head belonging to player A
      When player A constructs a step move from a1 with count 1
      Then the move is well-formed
      # Moving a lone head off an arrow is the ordinary case, not an edge one.
      # Whether the vacated arrow stays territory is P07's business, not the DTO's.

  Rule: Movement allowance is a whole number of steps

    SPEC §3: speed(N) = 1 + floor(log2 N). This replaced a harmonic curve whose
    fractional remainder banked between turns — exact to compute and impossible
    to read at the table. Nothing carries now, so allowance needs no rational
    arithmetic and no state beyond the group's size.

    Scenario Outline: Every doubling adds one step
      When I compute the movement allowance of a group of <heads>
      Then the allowance is exactly <steps> steps

      Examples:
        | heads | steps | note                                    |
        | 1     | 1     | the floor                               |
        | 2     | 2     | the pair moves as far as two loose heads |
        | 3     | 2     | no gain until the next doubling         |
        | 4     | 3     |                                         |
        | 7     | 3     | the last of its band                    |
        | 8     | 4     |                                         |
        | 15    | 4     |                                         |
        | 16    | 5     |                                         |

    Scenario: Splitting never loses on throughput
      When I compare a group's allowance against splitting it into single heads
      Then the allowance never exceeds the head count
      # §3's founding constraint. It is what keeps stacking a tactical choice
      # rather than a strictly better one, and it holds with equality only at
      # 1 and 2 — which is why the pair is free and the natural atom.

    Scenario Outline: A group size that cannot exist is rejected
      When I compute the movement allowance of a group of <heads>
      Then the computation fails

      Examples:
        | heads |
        | 0     |
        | -1    |
        | 1.5   |
