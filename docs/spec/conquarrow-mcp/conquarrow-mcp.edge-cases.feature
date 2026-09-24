# language: en
# Overview: docs/spec/conquarrow-mcp/conquarrow-mcp.md
# Adapter only — stdio MCP over rules-core, not a game rule

Feature: MCP edges — roster, kind, stale index, won match, handshake
  As a local tool caller
  I want illegal or mismatched calls to refuse without mutating the match
  So that a bad index or a heuristic seat cannot skip the engine

  Background:
    Given the conquarrow stdio MCP server

  Rule: Won match and missing match refuse mutation

    Scenario: apply_steps on a won match refuses
      Given a live match whose observation.winner is not null
      When the caller invokes apply_steps for the winner seat with any steps
      Then the tool refuses wrapping ContractViolation
      And observation.winner is unchanged
      And observation.activePlayer is unchanged

    Scenario: tools other than new_match with no live match refuse NoLiveMatch
      Given no live match
      When the caller invokes observe with seat A
      Then the tool refuses NoLiveMatch
      When the caller invokes legal_moves with seat A
      Then the tool refuses NoLiveMatch
      When the caller invokes see_board with seat A
      Then the tool refuses NoLiveMatch

  Rule: One live match, last offer per seat

    Scenario: second new_match replaces the first
      Given a live match with matchId M1 from seed 1
      And legal_moves for seat A has been called
      When the caller invokes new_match with playerCount 3 and seats human, human, heuristic and spawnerSeed 2
      Then the new matchId is not M1
      And observation reflects seed 2 not seed 1
      And apply_steps for seat A with indices from M1's offer is refused StaleOfferIndex

    Scenario: index apply is relative to the last legal_moves for that seat
      Given a live match from new_match seed 1 R=7 with seats human, human, heuristic
      And legal_moves for seat A has been called
      And apply_steps for seat A has applied one legal index
      When the caller invokes apply_steps for seat A with that same index
      Then the tool refuses StaleOfferIndex
      And observation matches the post-first-apply view
      When the caller invokes legal_moves for seat A again
      Then apply_steps with a current printed index is accepted

    Scenario: legal_moves for a non-active seat is empty and does not steal the active offer
      Given a live match from new_match seed 1 R=7 with seats human, human, heuristic
      And legal_moves for seat A has been called
      When the caller invokes legal_moves with seat B
      Then the text has no numbered step rows
      When the caller invokes apply_steps for seat A with an index from A's offer
      Then the step is accepted

  Rule: Roster is 3 or 6, human or heuristic only

    Scenario Outline: illegal roster is refused and does not clamp
      Given no live match
      When the caller invokes new_match with playerCount <count> and seats <seats>
      Then the tool refuses InvalidRoster
      And there is still no live match

      Examples:
        | count | seats                    |
        | 2     | human, heuristic         |
        | 4     | human, human, human, human |
        | 3     | human, human, byok       |
        | 3     | human, human             |
        | 6     | human                    |

    Scenario: playerCount 6 with six kinds is accepted
      When the caller invokes new_match with playerCount 6 and seats human, heuristic, human, heuristic, human, heuristic
      Then observation.activePlayer is A
      And observation.me is A
      And shareCounts has keys A, B, C, D, E, F

  Rule: Kind gates mutation

    Scenario: apply_steps and end_turn on a heuristic seat refuse
      Given a live match from new_match seed 1 R=7 with seats heuristic, human, human
      When the caller invokes apply_steps for seat A with any legal-looking steps
      Then the tool refuses SeatKindMismatch
      And observation.activePlayer is A
      When the caller invokes end_turn with seat A
      Then the tool refuses SeatKindMismatch
      And observation.activePlayer is A

    Scenario: play_heuristic_turn on a human seat refuses
      Given a live match from new_match seed 1 R=7 with seats human, human, heuristic
      When the caller invokes play_heuristic_turn with seat A
      Then the tool refuses SeatKindMismatch
      And observation.activePlayer is A

    Scenario: apply_steps with both indices and steps, or neither, refuses
      Given a live match from new_match seed 1 R=7 with seats human, human, heuristic
      And legal_moves for seat A has been called
      When the caller invokes apply_steps for seat A with empty steps and empty indices
      Then the tool refuses
      And observation.activePlayer is A
      When the caller invokes apply_steps for seat A with both a step object and an index
      Then the tool refuses
      And observation.activePlayer is A

    Scenario: includeMills false drops home_mill rows
      Given a live match from new_match seed 1 R=7 with seats human, human, heuristic
      When the caller invokes legal_moves with seat A and includeMills false
      Then no printed row contains tags including home_mill
      And at least one printed row is tagged leave_home

    Scenario: unknown seat id refuses UnknownSeat
      Given a live match from new_match seed 1 R=7 with seats human, human, heuristic
      When the caller invokes observe with seat Z
      Then the tool refuses UnknownSeat

  Rule: Handshake lists tools, not resources

    Scenario: tools/list includes the seven names and no resources
      When a client performs the stdio MCP initialize handshake
      And the client calls tools/list
      Then the listed names are exactly:
        | new_match            |
        | observe              |
        | legal_moves          |
        | apply_steps          |
        | end_turn             |
        | play_heuristic_turn  |
        | see_board            |
      When the client calls resources/list
      Then the list is empty

    Scenario: observe threatLine is derived from the fields
      Given a live match from new_match seed 1 R=7 with seats human, human, heuristic
      When the caller invokes observe with seat A
      Then observation.threatLine starts with Lead:
      And observation.threatLine equals threatLineFromCounts over observation.shareCounts, territoryCounts, longestEnemyTrail, offerTags, and dirt
      And the payload has no leadLine key
