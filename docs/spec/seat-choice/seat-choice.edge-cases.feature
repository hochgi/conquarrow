Feature: Seat choice edge cases (P106)

  Scenario: A plan with no Player (you) is refused by the server
    When a client posts seats [human, human, heuristic]
    Then the answer is 422 and nothing is stored

  Scenario: Two Player (you) seats are refused
    When a client posts seats [creator, creator, heuristic]
    Then the answer is 422

  Scenario: Player (you) with only AI is not enough
    When a client posts seats [creator, heuristic, heuristic]
    Then the answer is 422
    And the lobby note reads "Create needs you and at least one more Player or Agent."

  Scenario: Agent (yours) counts as the second chair
    When Alice posts [creator, creator-agent, heuristic]
    Then the answer is 201

  Scenario: Another user's agent cannot take a reserved chair
    Given Alice created [Player (you), Agent (yours), Player]
    When Bob's agent joins
    Then the join answers "full" and seat B is still reserved for Alice

  Scenario: Another user's agent takes the open chair, not the reserved one
    Given Alice created [Player (you), Agent (yours), Agent]
    When Bob's agent joins
    Then Bob's agent holds seat C and seat B is still reserved

  Scenario: Accept never takes a reserved chair
    Given Alice created [Player (you), Agent (yours), AI]
    When Bob accepts
    Then the answer is 409

  Scenario: Start waits for Alice's agent
    Given Alice created [Player (you), Agent (yours), Player] and Bob accepted
    Then Start is not offered and a forced start is 409

  Scenario: An agent holding two seats plays only the active one
    Given Alice's agent holds seats B and C of a started game
    When seat C is active
    Then observe offers seat C
    When seat A is active
    Then observe stops with not-your-turn

  Scenario: Online to Local drops the online-only choices
    Given the plan is [Player (you), Agent (yours), Agent]
    When Alice switches to Local
    Then the plan is [Player, AI, AI]
