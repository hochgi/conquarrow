Feature: The creator picks their own seat (P106)

  Background:
    Given online play is available and Alice is signed in

  Scenario: Every online seat offers five choices
    When Alice opens the seat options for seat A
    Then they read "Player (you)", "Player", "Agent (yours)", "Agent", "AI"

  Scenario: Create waits for Player (you)
    Given no seat is "Player (you)"
    Then Create is disabled and the note reads "Pick your seat: choose Player (you) on one seat."
    When Alice picks "Player (you)" on seat C and "Player" on seat B
    Then Create is enabled

  Scenario: Picking Player (you) again moves it
    Given seat A is "Player (you)"
    When Alice picks "Player (you)" on seat C
    Then seat A is "Player" and seat C is "Player (you)"

  Scenario: The creator's chair is where they picked
    When Alice creates [Agent, Player, Player (you)]
    Then the invite's seat C is bound to Alice and seats A and B are open

  Scenario: Agent (yours) waits for Alice's own agent
    Given Alice created [Player (you), Agent (yours), Agent (yours)]
    Then Alice sees seats B and C as "your agent (waiting)"
    When Alice's agent joins over MCP
    Then seats B and C are bound to Alice's agent and it is told seat B

  Scenario: An agent in seat A moves first
    Given Alice created [Agent, Player (you), AI] and Bob's agent joined
    When Alice starts the game
    Then Bob's agent observes an offer for seat A
