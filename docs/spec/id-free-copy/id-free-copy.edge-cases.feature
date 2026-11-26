# language: en
# Overview: docs/spec/id-free-copy/id-free-copy.md

Feature: Edge cases of id-free copy and the camera lock

  Rule: Singular and plural

    Scenario: One head is singular in the selection line
      When a 1-head stack with no move left is selected among 2 movable
      Then the selection line reads "Selected: 1 head · no move left · 2 can move"

    Scenario: One head stays is singular
      Given a run of 2 heads from a stack of 3
      Then the count note reads "1 head stays where the last run began"

    Scenario: Nothing stays
      Given a run of every head
      Then the count note reads "No head stays behind"

  Rule: Refusals without a selection are unchanged

    Scenario Outline: The selection-free sentence is the table's
      When "<reason>" is refused with no selection
      Then the sentence is REFUSAL_TEXT["<reason>"]
      Examples:
        | reason       |
        | out-of-reach |
        | no-exit      |
        | not-yours    |

    Scenario: No exit with a selection
      Then refusalText("no-exit", selected) reads "The selected stack has no move left this turn"

  Rule: Merge options keep order and drop the direction when it means nothing

    Scenario: Locked input offers no merge
      Given merge targets exist and input is locked
      Then there are no merge options

    Scenario: No selection gives no direction
      Given a merge target of 1 head and no selection
      Then its button reads "Merge into your 1-stack"

    Scenario: Coinciding centres give no direction
      Given the selected centre equals the target centre
      Then its button reads "Merge into your 2-stack"

    Scenario: Several targets come in compareArrows order
      Given merge targets "m3", "m1", "m2"
      Then the options are for "m1", "m2", "m3" in that order

  Rule: Compass words

    Scenario Outline: Eight directions, y grows downward
      Given from (0, 0) and to (<x>, <y>)
      Then the compass word is "<word>"
      Examples:
        | x  | y  | word       |
        | 1  | 0  | right      |
        | 1  | 1  | down-right |
        | 0  | 1  | down       |
        | -1 | 1  | down-left  |
        | -1 | 0  | left       |
        | -1 | -1 | up-left    |
        | 0  | -1 | up         |
        | 1  | -1 | up-right   |

    Scenario: A shallow angle rounds to the nearer axis
      Given from (0, 0) and to (10, 1)
      Then the compass word is "right"

  Rule: Showing moves

    Scenario: A queued batch counts as shown
      Given no batch is playing and one is queued
      Then moves are showing

    Scenario: A local seat applying its plan counts as shown
      Given local playback is on
      Then moves are showing

    Scenario: A local seat that is planning does not
      Given no replay, no queue and no local playback
      Then moves are not showing
