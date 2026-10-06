# language: en
# Overview: docs/spec/online-hardening/online-hardening.md
# Packet P69.

Feature: Online hardening — what still works
  As the operator of the online API
  I want the stricter loader and verifier to accept everything they accepted before
  So that hardening does not break a live game or a live client

  Rule: A valid stored position still loads

    Scenario: Every valid stored position loads unchanged
      Given each valid stored position from the round-trip fixtures
      When it is re-read through parsePersistedEnvelope
      Then the loaded state equals the stored one field for field

    Scenario: A pre-P36 position with a retired streak pair still loads
      Given a valid stored position with dominationHolder and a dominationStreak of 3 instead of starvationStreaks
      When it is re-read through parsePersistedEnvelope
      Then the holder's starvation streak is 3

  Rule: The auth scheme is case-insensitive

    Scenario Outline: A token with the scheme in any case is verified
      Given tokeninfo answers a valid payload for token "t1"
      When the verifier checks the header "<header>"
      Then the result is ok with that payload's sub

      Examples:
        | header    |
        | Bearer t1 |
        | bearer t1 |
        | BEARER t1 |
        | bEaReR t1 |
