# language: en
# Overview: docs/spec/conquarrow-mcp/conquarrow-mcp.md
# Adapter only — stdio MCP over rules-core, not a game rule

Feature: Tools over legalMoves and apply, not a scrape
  As a local tool caller
  I want observation, legal rows, apply, greedy-v1, and a board picture
  So that I can play human seats without raw GameState or a Pages scrape

  Background:
    Given the conquarrow stdio MCP server with no live match

  Rule: Opening match is a seat-scoped view

    Scenario: new_match seed 1 R=7 three seats returns the locked opening
      When the caller invokes new_match with:
        | playerCount  | 3                         |
        | seats        | human, human, heuristic   |
        | R            | 7                         |
        | homeOffset   | 5                         |
        | dominationN  | 5                         |
        | spawnerSeed  | 1                         |
      Then the result includes a matchId
      And observation.me is A
      And observation.activePlayer is A
      And observation.winner is null
      And observation.shareCounts.A is 4
      And observation.shareCounts.B is 4
      And observation.shareCounts.C is 3
      And the payload has no spawners array of length 58

    Scenario: legal_moves for A's opening home stack is the BYOK row shape
      Given a live match from new_match seed 1 R=7 with seats human, human, heuristic
      When the caller invokes legal_moves with seat A
      Then the text contains at least one row tagged leave_home
      And the text contains at least one row tagged home_mill
      And every numbered row contains spd=
      And a row with unmoved heads on from greater than count contains leave=
      And no row is invented beyond legalMoves for activePlayer

    Scenario: apply_steps of one legal opening step then refuses the same index
      Given a live match from new_match seed 1 R=7 with seats human, human, heuristic
      And legal_moves for seat A has been called
      When the caller invokes apply_steps for seat A with indices of one leave_home row
      Then observation.exposedTips is not the pre-apply list
      And observation.exposedTips is not empty
      When the caller invokes apply_steps for seat A with the same indices again
      Then the tool refuses
      And observation.activePlayer is still A
      And observation.exposedTips matches the post-first-apply view

    Scenario: end_turn on the active human seat advances activePlayer
      Given a live match from new_match seed 1 R=7 with seats human, human, heuristic
      When the caller invokes end_turn with seat A
      Then observation.activePlayer is B
      And observation.winner is null

    Scenario: observe after a dirt-shaped close does not invent share+N
      Given a live 3-seat match reconstructed or fixtured so a human seat has a legal closes row with no share+N
      When the caller invokes apply_steps of that closes row
      Then landed tags include closes
      And landed tags do not include a share+N tag
      And observation.shareCounts for that seat equals the pre-apply shareCounts
      And observation.threatLine contains "closes without share+N (dirt)" when the current offer's closes rows all lack share+N

    Scenario: play_heuristic_turn on the active heuristic seat plays greedy-v1
      Given a live match from new_match seed 1 R=7 with seats heuristic, human, human
      When the caller invokes play_heuristic_turn with seat A
      Then the returned moves are the chooseTurnGreedy plan for A on the pre-call state
      And the last returned move is endTurn
      And observation.activePlayer is B
      And a second play_heuristic_turn for seat A is refused

    Scenario: findings list only kinds whose move is a legal step for me
      Given a live match from new_match seed 1 R=7 with seats human, human, heuristic
      When the caller invokes observe with seat A
      Then every findings entry has a move field
      And no findings entry has a step field
      And every findings[].move equals a kind=step member of legalMoves for A
      When the caller invokes observe with seat B
      Then findings is empty

    Scenario: no JSON tool returns the full 58-spawner array
      Given a live match from new_match seed 1 R=7 with seats human, human, heuristic
      When the caller invokes observe with seat A
      Then spawnersNearTips has at most 12 entries
      And the payload has no spawners key listing every match spawner
      When the caller invokes see_board with seat A
      Then the SVG may contain data-spawner marks inside the R-window
      And the JSON tools still have no full spawner array

    Scenario: see_board returns SVG, identical for the same state and seat
      Given a live match from new_match seed 1 R=7 with seats human, human, heuristic
      When the caller invokes see_board with seat A twice
      Then both results are SVG text whose root has xmlns http://www.w3.org/2000/svg
      And the two SVG texts are equal
      And the SVG is not a PNG
      And no element has data-legal-index
      When the caller invokes see_board with seat B
      Then the viewBox equals A's viewBox
      And the data-arrow set equals A's
      And the data-spawner set equals A's
      And data-highlight=1 appears only on groups whose data-owner is B
