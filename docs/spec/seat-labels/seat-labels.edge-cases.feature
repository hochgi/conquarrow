# language: en
# Overview: docs/spec/seat-labels/seat-labels.md
# Packet P105 — edge cases

Feature: Seat labels at the edges

  Rule: A peek that is not a member's carries no names

    Scenario Outline: The peek without a member's bearer
      Given an open invite whose seat A is Alice, named "Alice"
      When the invite is peeked with <bearer>
      Then the answer is 200
      And no chair has a name

      Examples:
        | bearer                         |
        | no Authorization               |
        | a bearer the verifier rejects  |
        | a verifier that throws         |
        | Carol, who is not a member     |

    Scenario: A closed or missing invite is unchanged
      When a member peeks a revoked invite
      Then the answer is 410 with no seats
      When anyone peeks a missing invite
      Then the answer is 404

  Rule: Error answers carry no names

    Scenario: Accept on a full invite
      When Carol accepts an invite with no free human chair
      Then the answer is 409 and the client shows the lobby as full

    Scenario: Accept or create without a valid bearer
      Then the answer is 401 and nothing is written

  Rule: A name never impersonates a label

    Scenario Outline: A reserved word as a name
      Given Bob's profile name is "<name>"
      Then his seat B reads "Player B"
      And his agent's seat reads "Agent"

      Examples:
        | name       |
        | you        |
        | You        |
        | your agent |
        | AI         |
        | waiting    |
        |            |

  Rule: No profile, or a broken one, means no name

    Scenario: The profile object is missing or not JSON
      When a member reads the game
      Then that chair has no name key
      And it reads "Player B" or "Agent"

  Rule: "you" needs proof

    Scenario: Signed out
      Given no caller hash
      Then no seat reads "you" or "your agent"

    Scenario: A local hot-seat
      Given two human seats locally
      Then they read "Player A" and "Player B"

    Scenario: The host seat moves when seat A is AI
      Given the online plan AI, Player, Player
      Then seat B's Player option reads "Player (you)"
      And seat C's reads "Player"
