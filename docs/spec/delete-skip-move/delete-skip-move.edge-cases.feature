# language: en
# Overview: ./delete-skip-move.md — P51, deletion. No behavioural delta.

Feature: Skip deletion — edges
  As the owner of a persisted match archive
  I want a log that names a deleted move kind to fail loudly
  So that a stale replay is never silently reinterpreted

  Background:
    Given a GameState and a RulesPort

  Rule: A persisted skip is rejected, never translated

    Scenario: A move record naming skip fails to decode
      Given a persisted move record of kind skip on a1
      When the record is decoded
      Then decoding fails
      And no move is produced

    Scenario: The rejection is the decoder's ordinary failure, not a new shape
      Given a persisted move record of kind skip on a1
      And a persisted move record of an unknown kind
      When each record is decoded
      Then both fail the same way

    Scenario: A log containing a skip does not replay
      Given a persisted move log whose second entry is a skip
      When the log is replayed
      Then the replay is refused
      And the entries before the skip are not applied as a partial match

    Scenario: A step record still decodes
      Given a persisted move record of kind step from a1 to a2 with count 1
      When the record is decoded
      Then a step from a1 to a2 with count 1 is produced

  Rule: Applying a deleted kind is not a silent no-op

    Scenario: An object shaped like a skip is not accepted by apply
      Given a value with kind skip and a valid arrow
      When it is applied to a live state
      Then the state is not returned unchanged
      And the attempt is refused

  Rule: Re-recorded replays are identical

    Scenario: Removing a skip from a fixture changes no final state
      Given a shipped replay fixture whose move list contained a skip
      When the fixture is replayed without that entry
      Then the final state is the one the fixture recorded
      # A differing final state is a defect to report, not a fixture to adjust.

    Scenario: Removing several skips changes no final state
      Given a shipped replay fixture whose move list contained skips by both seats
      When the fixture is replayed without those entries
      Then the final state is the one the fixture recorded

  Rule: Consumers that filtered skip are unaffected

    Scenario: Auto-pass still triggers only on the absence of a step
      Given A has stacks but no legal step
      When auto-pass is evaluated
      Then end turn is applied

    Scenario: A bot's offered moves are unchanged wherever a step exists
      Given a state whose legal moves include a step
      When the moves are rendered
      Then they are the same moves the bot was shown before this packet
      # byokBot filtered kind !== 'skip' while any step existed, so nothing it saw
      # changes here. On a stepless board it now sees endTurn alone rather than a
      # skip per movable group — the model could only pass either way.
