Feature: Match log v2 — edge cases (P107)

  Scenario: A refused move writes no line
    When Alice posts an illegal step
    Then the answer is 422 and log.jsonl is unchanged

  Scenario: An agent call that loses the race writes no line
    Given another write lands first
    When Bob's agent sends a reply
    Then it is told the position changed and log.jsonl is unchanged

  Scenario: An agent that only ends its turn resolves to nothing
    When Bob's agent sends moves [] and endTurn
    Then its reply line carries resolved [] and the endTurn line has no "by"

  Scenario: The opening's server moves are logged at version 0
    Given a game whose first seats are AI
    When it is read for the first time
    Then the opening lines carry v 0 and by "server"

  Scenario: A pre-P107 game still exports
    Given a log written before P107 ({v, move} and {v, agentReply:{seat, …}})
    When it is exported
    Then its entries have no at, seat, by or events, and each reply's seat is lifted to the entry

  Scenario: A rival's reply stays withheld mid-game
    Given the game has no winner
    When Alice exports it
    Then Bob's agent's reply lines are withheld and counted, whichever line version wrote them

  Scenario: Presentation-only events are not logged
    When a step moves, splits or merges a stack with no other effect
    Then its line's events are []

  Scenario: A share change is logged
    When a closure takes a spawner-border arrow from seat B
    Then the line holds sharesChanged for the closer and for B with their counts before and after
