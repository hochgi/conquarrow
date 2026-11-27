Feature: Match log v2 — the server's record says when, who and what (P107)

  Background:
    Given an online game between Alice (seat A), an AI (seat B) and Bob's agent (seat C)

  Scenario: A browser move is logged with its time, seat and events
    When Alice posts a step at server time T
    Then the log gains a line with v, at = T, seat "A", the move and its events, and no "by"

  Scenario: The AI's moves after it are marked as the server's
    When Alice ends her turn
    Then every line the server played for seat B carries by "server" and seat "B"

  Scenario: An agent's reply says what its indices became
    Given Bob's agent observed the offer at version N
    When it sends moves [0] and endTurn
    Then its reply line carries resolved = [the step offer row 0 named] and offerVersion N
    And the step line before it carries seat "C" and no "by"

  Scenario: Log events are the web's events
    When any move is applied
    Then its line's events equal logEventsOf(geometry, before, after, move)

  Scenario: The export is format version 2 with one kind vocabulary
    When Alice exports the game
    Then formatVersion is 2
    And seat B's kind is "heuristic" in seats and in the summary standings
    And every log entry carries the at, seat, by and events it was written with
