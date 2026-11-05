# language: en
# Overview: docs/spec/rational/rational.md
# SPEC §3 (allowance is whole steps, nothing banked — item 20), §7 (force bounds, stacked spawners, reset-on-capture)

Feature: Exact rational arithmetic — boundaries and destructive cases
  As the rules core
  I want the boundary cases pinned before any rule depends on them
  So that a head never appears a turn early or a turn late

  Rule: A tick can never produce two heads

    Worth asserting because it is provable and because the fill loop is much
    simpler if it holds. An accumulator is below 1 before a tick, and the
    largest possible gain is two maximum-force spawners landing together —
    1/3 + 1/3 = 2/3. So the post-tick value is below 5/3, always.

    Scenario: The largest possible gain onto the largest possible holding
      Given an accumulator holding exactly 11/12
      When it gains 1/3 from one spawner
      And it gains 1/3 from a second spawner in the same tick
      Then exactly one head is produced
      And the accumulator holds exactly 7/12

    Scenario: The maximum force is exposed as a comparable ceiling
      Given the maximum spawner force of 1/3
      When a force of 1/2 is compared against it
      Then the force is greater than the maximum
      # P01 owns the constant and the ordering that makes it checkable.
      # Rejecting an over-forced spawner is P08's — a Rational has no idea
      # what a spawner is, and giving it one would be a boundary leak.

  Rule: Reset destroys, carry preserves — and they must not be confused

    This is the one place in the design where progress is destroyed rather than
    carried. Getting it backwards would make border churn profitable, which
    inverts the incentive toward consolidation the economy is built on.

    # Both scenarios below need an accumulator that knows its owner and whether
    # an enemy stands on it. A Rational knows neither, and teaching it would put
    # economy rules inside a numeric DTO. They are specified here because this
    # is where the arithmetic they rely on is pinned, and they are P08's to test.

    @deferred-P08
    Scenario: Capture at the brink loses everything banked
      Given an accumulator holding exactly 11/12
      When the arrow changes owner
      Then the accumulator holds exactly 0
      And no head is produced

    @deferred-P08
    Scenario: A blockade holds the value rather than resetting it
      Given an accumulator holding exactly 11/12
      When an enemy head stands on the arrow without capturing it
      Then the accumulator holds exactly 11/12
      And it does not advance
      # SPEC §7: accrual halts and resumes when the intruder leaves. The
      # rotation still lands on the frozen arrow and that fraction is lost.

  Rule: Zero, whole numbers and normalization

    Scenario Outline: Zero compares equal however it is written
      Given a rational <value>
      When I compare it to zero
      Then they compare equal

      Examples:
        | value |
        | 0/1   |
        | 0/7   |
        | 0/36  |

    # Superseded by item 20: allowance is 1 + floor(log2 N) whole steps and nothing is banked (SPEC §3).
    Scenario: A whole allowance leaves no bank
      Given an allowance of exactly 1/1
      When one whole step is spent
      Then the remaining allowance is exactly 0
      And no fraction is banked

    # Superseded by item 20: allowance is whole steps, never a fraction (SPEC §3).
    Scenario: An allowance below one affords no step
      Given an allowance of exactly 5/6
      When I ask how many whole steps it affords
      Then the answer is 0
      And the allowance is unchanged

    Scenario: Negative rationals are rejected
      When a rational is constructed with a negative value
      Then construction fails
      # Neither allowance nor accrual is ever negative. A signed type would
      # make an underflow bug representable instead of impossible.

    Scenario: A zero denominator is rejected
      When a rational is constructed with denominator 0
      Then construction fails

  Rule: Denominators stay bounded under repeated accrual

    Stacked spawners at 1/9 and 1/12 add over and over across a long match. An
    implementation that does not normalize will grow its denominator without
    bound and eventually lose exactness — which is the same defect as using
    floats, arriving later.

    Scenario: Repeated accrual keeps values normalized
      Given an accumulator gaining 1/9 and 1/12 alternately
      When it has ticked 200 times
      Then every intermediate value was in lowest terms
      And no value required a denominator larger than 36

  Rule: Operations do not mutate their operands

    ADR 0001 forbids input mutation anywhere in the core, and a rational is the
    value most likely to be shared between two accumulators by accident.

    Scenario: Addition leaves both operands unchanged
      Given a rational 1/9 and a rational 1/12
      When I add them
      Then the first operand is still exactly 1/9
      And the second operand is still exactly 1/12

    Scenario: Sorting is stable and order-independent
      Given a collection of rationals with mixed denominators
      When I sort it
      And I sort the same values presented in a different input order
      Then both results are identical
