Feature: Agent context v2 — edge cases (P108)

  Scenario: The agent's first turn shows everything so far
    Given the agent has not completed a turn yet
    Then the window is every recorded line

  Scenario: Mid-turn, the window still starts at the last completed turn
    Given the agent has applied one step of this turn
    Then the window starts at its previous turn and ends with this turn's step

  Scenario: Lines written before P107 are skipped
    Given a game whose early lines have no seat or events
    Then the window holds only the lines that have them

  Scenario: An empty window says so
    Given no recorded line
    Then the offer says "Since your last turn: nothing recorded yet."

  Scenario: A long run is capped
    Given a run with more than 12 printable events
    Then it prints 12 and "… +k more"

  Scenario: A name cannot add lines
    Given a seat name with a line break and 60 characters
    Then its row is one line and the name is cut to 40 characters

  Scenario: A step that loses its fight reads then=0
    Given a step into a stronger rival stack
    Then its row reads then=0

  Scenario: An agent on two chairs sees its other chair as also you
    Given Gilad's agent holds seats B and D
    Then on B's turn the offer reads D as "also you"
