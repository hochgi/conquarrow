Feature: Agent context v2 — who is who, what happened, honest step counts (P108)

  Background:
    Given an online game between Gilad (seat A), Gilad's agent (seat B) and an AI (seat C)

  Scenario: The offer lists the seats with kind, name and relation
    When Gilad's agent observes on its turn
    Then the offer lists "A human Gilad (your owner)", "B agent Gilad's agent (you)" and "C heuristic AI" in turn order

  Scenario: The offer states the starvation clock from the state
    When Gilad's agent observes on its turn
    Then the offer states dominationN and every seat's streak as the state holds them

  Scenario: The offer says what happened since the agent's last turn
    Given the agent's last turn cut a trail, and the AI fought after it
    When Gilad's agent observes on its next turn
    Then "Since your last turn" lists its own run with the cut, then the AI's run with the combat

  Scenario: A split portion's row never reads a negative left
    Given the agent's 4-head stack has walked 2 steps
    When the offer lists a 1-head portion from it
    Then the row reads spd=3 spent=2 left=1 then=0

  Scenario: The move tool declares its arguments
    When the agent lists the tools
    Then move's moves items are integers and why and plan are strings
    And its description states the batch rule

  Scenario: The door and a BYOK seat give the same offer
    Given the same position, seats and history
    Then the door's offer block equals the BYOK user prompt with no plan and no locks
