# language: en
# Overview: docs/spec/online-hardening/online-hardening.md
# Packet P69. Every corruption is one field changed in an otherwise valid stored position.

Feature: Online hardening — stored positions outside the contract are refused
  As the operator of the online API
  I want a corrupt state.json read as unreadable
  So that the engine never runs on a position it could not have produced

  Background:
    Given a valid stored position with at least two groups, a trail, territory, an accumulator, a spawner and a starvation streak

  Rule: Ranges

    Scenario Outline: A field outside its contract range is refused
      When <field> is set to <value>
      And the position is re-read through parsePersistedEnvelope
      Then it is refused

      Examples:
        | field                        | value |
        | players                      | a list of one id |
        | players                      | the same id twice |
        | the first group's heads      | 0 |
        | the first group's heads      | -1 |
        | the first group's heads      | 1.5 |
        | the first group's spent      | -1 |
        | the first group's spent      | 0.5 |
        | the first group's speedOverride | 2 |
        | the first group's speedOverride | "1" |
        | the first spawner's phase    | -1 |
        | the first spawner's phase    | 3 |
        | the first spawner's phase    | 1.5 |
        | the first streak             | -1 |
        | the first streak             | 0.5 |
        | dominationN                  | 0 |
        | dominationN                  | 2.5 |

    Scenario: A retired streak pair that seeds a clock is held to the same checks
      Given the position carries dominationHolder and a dominationStreak of 2.5 instead of starvationStreaks
      When it is re-read through parsePersistedEnvelope
      Then it is refused

  Rule: Membership

    Scenario Outline: A player id that is not seated is refused
      When <field> names the unseated id "p-ghost"
      And the position is re-read through parsePersistedEnvelope
      Then it is refused

      Examples:
        | field                       |
        | activePlayer                |
        | winner                      |
        | the first group's owner     |
        | the first territory owner   |
        | the first trail's player    |
        | the first streak's player   |

    Scenario: A winner that is not a string is refused, not dropped
      When winner is set to 7
      And the position is re-read through parsePersistedEnvelope
      Then it is refused

  Rule: One entry per key

    Scenario Outline: A keyed list naming the same key twice is refused
      When <list> repeats its first entry
      And the position is re-read through parsePersistedEnvelope
      Then it is refused

      Examples:
        | list              |
        | groups            |
        | territory         |
        | accumulators      |
        | spawners          |
        | trails            |
        | starvationStreaks |

  Rule: Callers see an unreadable game, not a crash

    Scenario: A move against an out-of-contract stored position is a 500 and changes nothing
      Given A and B have started and opened a 3-seat game with seats human, human, heuristic
      And its state.json is rewritten with the first group's heads set to 0
      When A posts endTurn with If-Match "0"
      Then the response is 500
      And state.json is unchanged
