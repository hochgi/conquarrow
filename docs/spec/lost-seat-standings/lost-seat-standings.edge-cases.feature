# language: en
# Overview: docs/spec/lost-seat-standings/lost-seat-standings.md
# Packet P102 — edge cases

Feature: Lost-seat and standings boundaries

  Rule: newlyLost is a total diff (D2)

    Scenario Outline: The diff toasts only letters that just appeared
      Given the previous lost set is "<prev>"
      And the next lost set is "<next>"
      When newly lost seats are read
      Then the newly lost seats are "<result>"

      # "(absent)" is undefined, not the empty list. "(empty)" is a real snapshot.
      # "(none)" is an empty result. Letters are comma-separated, in order.
      Examples:
        | prev    | next  | result |
        | (absent)| A,C   | (none) |
        | (empty) | B,C   | B,C    |
        | A       | A,C   | C      |
        | A,C     | A,C   | (none) |
        | C       | A     | A      |
        | A       | C,A,C | C      |
        | (empty) | (empty) | (none) |
        | B,C     | C,B   | (none) |

  Rule: The match identity is the game route only while online (D3)

    Scenario Outline: Identity is the game id only for an online game route
      Given online is "<online>"
      And the hash is "<hash>"
      And the match started at "<started>"
      When the match identity is read
      Then the identity is "<identity>"

      Examples:
        | online | hash              | started                      | identity                          |
        | true   | #/g/abc/000001    | 2026-11-25T00:00:00.000Z     | abc/000001                        |
        | false  | #/g/abc/000001    | 2026-11-25T00:00:00.000Z     | local:2026-11-25T00:00:00.000Z    |
        | true   | #/                  | 2026-11-25T00:00:00.000Z     | local:2026-11-25T00:00:00.000Z    |
        | true   | #/invite/tok      | 2026-11-25T00:00:00.000Z     | local:2026-11-25T00:00:00.000Z    |

  Rule: A new match identity is a first snapshot (D3)

    Scenario: A version jump in the same match toasts only the new letter
      Given memory for identity "g/000001" with lost set "C"
      And the identity is still "g/000001"
      And the next lost set is "C" and "A"
      When losses are observed
      Then the newly lost seats are "A"
      And the memory records identity "g/000001" and lost set "C" and "A"

    Scenario: Opening another game does not toast seats that are already lost
      Given memory for identity "g/000001" with lost set "C"
      And the identity is "g/000002"
      And the next lost set is "C"
      When losses are observed
      Then no seat is newly lost
      And the memory records identity "g/000002" and lost set "C"

    Scenario: The first observation of a mount records the lost set and emits nothing
      Given no loss memory
      And the identity is "local:2026-11-25T00:00:00.000Z"
      And the next lost set is "B"
      When losses are observed
      Then no seat is newly lost
      And the memory records that identity and lost set "B"

  Rule: The lost set is the predicate, in players order (D1)

    Scenario: Only the letters the predicate loses are returned, in players order
      Given players "C", "A", "B"
      And the predicate loses "A" and "B"
      When lost seat ids are read
      Then the lost set is "A" and "B" in that order

    Scenario: A predicate that loses nobody returns an empty set
      Given players "A" and "B"
      And the predicate loses nobody
      When lost seat ids are read
      Then the lost set is empty

  Rule: Seat labels are the P101 words (D5)

    Scenario Outline: The first matching label row wins
      Given a seat letter "<letter>", kind "<kind>", relation "<relation>", owner "<owner>", sayYou "<sayYou>"
      When the seat label is read
      Then the label is "<label>"

      # Owner "(none)" means the field is absent. "(blank)" is whitespace only.
      # sayYou is true or false.
      Examples:
        | letter | kind      | relation      | owner | sayYou | label      |
        | A      | human     | caller-human  | (none) | true  | you        |
        | A      | human     | caller-human  | (none) | false | A          |
        | C      | agent     | caller-agent  | Ada   | true  | your agent |
        | C      | agent     | caller-agent  | (none) | true  | your agent |
        | B      | heuristic | other         | (none) | true  | AI         |
        | B      | byok      | other         | (none) | false | AI         |
        | B      | agent     | other         | Ada   | true  | Ada        |
        | B      | agent     | other         | (none) | true  | B          |
        | B      | human     | other         | (none) | true  | B          |
        | B      | agent     | other         | (blank) | true | B          |
        | A      | human     | caller-agent  | (none) | true  | A          |
        | C      | agent     | caller-human  | Ada   | true  | Ada        |

    Scenario: Online, only a proved human caller is you
      Given online seats human "alice", human "bob", and agent "alice" labeled "Agent (Ada)"
      And the caller hash is "alice"
      And the players are "A", "B", "C"
      When each online seat label is read
      Then "A" is labeled "you"
      And "B" is labeled "B"
      And "C" is labeled "your agent"

    Scenario: A missing hash or a missing chair is never you
      Given online seats are missing
      And the caller hash is missing
      And the players are "A"
      When the online label of "A" is read
      Then the label is "A"

    Scenario: A local hot-seat labels humans by letter
      Given local log seats "A" human, "B" human, and "C" heuristic
      When each local seat label is read
      Then "A" is labeled "A"
      And "B" is labeled "B"
      And "C" is labeled "AI"

    Scenario: The one human in a local versus-bot match is you
      Given local log seats "A" human, "B" heuristic, and "C" heuristic
      When each local seat label is read
      Then "A" is labeled "you"
      And "B" is labeled "AI"
      And "C" is labeled "AI"

    Scenario: your agent does not take the you sentence
      Given the label "your agent"
      When the elimination sentence is read
      Then the sentence is "your agent was eliminated"

    Scenario: The toast duration is the named constant
      When the elimination toast duration is read
      Then it is 4000 milliseconds

  Rule: The seat line does not invent rows or names (D6)

    Scenario: A lost letter that is not on the roster adds no item
      Given the seat line lists "A" as "Player"
      And the lost set is "C"
      When the seat line is read
      Then the only item is "A"
      And "A" is not lost
      And "A" has no accessible name

    Scenario: Every listed copy of a lost letter is marked
      Given the seat line lists "A" as "Player" and "A" as "AI"
      And the lost set is "A"
      When the seat line is read
      Then both items are lost, struck, and greyed
      And both accessible names are "A — eliminated"
      And the visible texts are "A=Player" and "A=AI"

  Rule: Standings sort, marks, and fallback (D7)

    Scenario: The winner is not the caller, and still comes first
      Given a summary won by "B" on turn 3
      And standings "A" seat 0 lost with territory 1, shares 0, heads 0
      And standings "B" seat 1 not lost with territory 9, shares 2, heads 5
      And standings "C" seat 2 lost with territory 0, shares 0, heads 2
      And seat 0 is a human chair with hash "alice"
      And seat 1 is a human chair with hash "bob"
      And seat 2 is a heuristic
      And the caller hash is "alice"
      And the match is showing game-over
      When the standings view is read
      Then the rows are "B", "A", "C" in that order
      And row "A" is marked you and its marker is "lost"
      And row "B" is not you, is the winner, and its marker is "winner"
      And row "B" shows territory 9, shares 2, and heads 5
      And the caption is "Won on turn 3"

    Scenario: A winner string that matches no row keeps server order
      Given a summary won by "Z" on turn 1
      And standings "A" seat 0 not lost with territory 1, shares 0, heads 1
      And standings "B" seat 1 lost with territory 0, shares 0, heads 0
      And no chairs
      And the match is showing game-over
      When the standings view is read
      Then the rows are "A", "B" in that order
      And no row is marked you
      And no row is the winner
      And the caption is "Won on turn 1"

    Scenario: A row that is both winner and lost carries both marks
      Given a summary won by "A" on turn 2
      And standings "A" seat 0 lost with territory 0, shares 0, heads 0
      And no chairs
      And the match is showing game-over
      When the standings view is read
      Then row "A" is the winner and is lost
      And its marker is "winner, lost"
      And it is not marked you

    Scenario: An empty standings list is still a table
      Given a summary won by "A" on turn 0 with no standings
      And the match is showing game-over
      When the standings view is read
      Then the view is a table
      And the caption is "Won on turn 0"
      And there are no rows

    Scenario: Without a chair, a heuristic standing is AI and a human is the letter
      Given a summary won by "A" on turn 4
      And standings "A" seat 0 not lost with territory 1, shares 0, heads 1, kind human
      And standings "B" seat 1 lost with territory 0, shares 0, heads 0, kind heuristic
      And no chairs
      And the caller hash is "alice"
      And the match is showing game-over
      When the standings view is read
      Then row "A" is labeled "A" and is not marked you
      And row "B" is labeled "AI" and its marker is "lost"

    Scenario: The caller's agent is your agent, not the owner name
      Given a summary won by "A" on turn 8
      And standings "A" seat 0 not lost with territory 2, shares 1, heads 1
      And standings "C" seat 2 lost with territory 0, shares 0, heads 0
      And seat 0 is a human chair with hash "bob"
      And seat 2 is an agent chair with hash "alice" labeled "Agent (Ada)"
      And the caller hash is "alice"
      And the match is showing game-over
      When the standings view is read
      Then row "A" is labeled "A" and is not marked you
      And row "C" is labeled "your agent"

    Scenario: Another agent's owner name is the label
      Given a summary won by "A" on turn 8
      And standings "A" seat 0 not lost with territory 2, shares 1, heads 1
      And standings "C" seat 2 lost with territory 0, shares 0, heads 0
      And seat 2 is an agent chair with hash "bob" labeled "Agent (Ada)"
      And the caller hash is "alice"
      And the match is showing game-over
      When the standings view is read
      Then row "C" is labeled "Ada"

  Rule: A bad summary does not drop the board (D8)

    Scenario: A valid summary is kept on the board
      Given a game body with version 3 and a summary won by "A" on turn 6
      And that summary has standing "A" seat 0 not lost with territory 4, shares 1, heads 2
      When the board is parsed
      Then the board version is 3
      And the summary winner is "A"
      And the summary turns are 6
      And the standing "A" has territory 4, shares 1, heads 2, and is not lost

    Scenario: An absent summary leaves the board without the key
      Given a game body with version 3 and no summary
      When the board is parsed
      Then the board version is 3
      And the board has no summary

    Scenario Outline: An invalid summary is dropped and the board remains
      Given a game body with version 3 and a summary that "<fault>"
      When the board is parsed
      Then the board version is 3
      And the board has no summary

      Examples:
        | fault                          |
        | is not an object               |
        | has an empty winner            |
        | has a fractional turn count    |
        | has a negative turn count      |
        | has no standings array         |
        | has a standing with no player  |
        | has a standing whose lost is not a boolean |
        | has a standing with a negative head count  |

    Scenario: An unknown kind is dropped and the standing is kept
      Given a game body with version 1 and a summary won by "A" on turn 1
      And that summary has standing "A" seat 0 not lost with territory 1, shares 0, heads 1 and kind "byok"
      When the board is parsed
      Then the board has a summary
      And the standing "A" has no kind

    Scenario: Extra keys do not reject the summary
      Given a game body with version 1 and a summary won by "A" on turn 1
      And that summary carries an extra key
      When the board is parsed
      Then the summary winner is "A"
