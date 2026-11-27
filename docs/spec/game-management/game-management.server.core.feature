# language: en
# Overview: docs/spec/game-management/game-management.md
# Packet P96 — server (packages/online-api)

Feature: The server's export, and naming, deleting, hiding and listing games
  As a member of an online game
  I want the server's own record of it, and a lobby I can keep tidy
  So that a review never depends on one browser, and junk games can go

  Rule: A member exports the server's whole log (D1)

    Scenario: The export holds every move and replays to the served state
      Given a started game of Alice, Bob and a heuristic seat with three versions played
      When Alice gets the export
      Then the answer is 200 with format "conquarrow-online-export"
      And its moves are every move of the log in order
      And replaying its moves from makeMatch of its config gives the state GET serves
      And it has no vsBot, botMode, humanSeat or botSeat field

    Scenario: The export names every seat by kind, name and owner
      Given a started game of Alice, Bob's agent and a heuristic seat
      And Alice's profile name is "Alice" and Bob's is "Bob"
      When Alice gets the export
      Then seat 0 is a human named "Alice"
      And seat 1 is an agent named "Agent" owned by "Bob"
      And seat 2 is a heuristic seat named "AI"
      And no user hash appears anywhere in the body

  Rule: Rival agent replies wait for the end of the game (D2)

    Scenario: Mid-game, another seat's reply records are withheld
      Given a started game where Bob's agent has replied once with a plan
      When Alice gets the export
      Then the log holds no agentReply record
      And withheldReplies is 1

    Scenario: After the game is won, every reply record is exported
      Given a won game where Bob's agent replied once with a plan
      When Alice gets the export
      Then the log holds Bob's agentReply with its seat and plan
      And withheldReplies is 0

  Rule: The agent door exports the same record (D3)

    Scenario: The MCP export equals the browser export of the same user
      Given a started game where Bob's agent holds seat 1
      When Bob's agent calls export
      Then the JSON block equals Bob's browser export but for exportedAt

    Scenario: observe carries the game's name
      Given a started game named "Friday rematch" where it is the agent's turn
      When the agent calls observe
      Then the JSON block has name "Friday rematch"

  Rule: The owner may delete a game, and only with the exact confirm (D4, D5)

    Scenario: The owner deletes a game
      Given Alice created the invite of a started game of Alice and Bob
      And Alice and Bob each have an open connection
      When Alice posts delete with confirm "Yes, permanently delete this game"
      Then the answer is 200 with deleted true
      And no object under the game's prefix remains
      And Alice's and Bob's connections are sent a libraryChanged wake with change "deleted"
      And GET of the game answers 404

    Scenario: A member who is not the owner cannot delete
      Given Alice created the invite of a started game of Alice and Bob
      When Bob posts delete with the exact confirm
      Then the answer is 403
      And the game's objects are unchanged

    Scenario: A delete without the exact confirm is refused
      Given Alice created the invite of a started game of Alice and Bob
      When Alice posts delete with confirm "yes"
      Then the answer is 422
      And the game's objects are unchanged

    Scenario: A deleted game's invite and agent door say it was deleted
      Given a deleted game that Bob's agent sat in
      When anyone gets the game's invite
      Then the answer is 410 with reason "deleted"
      And the agent's observe answers stop with reason "deleted"

  Rule: Games have names (D6)

    Scenario: A name given at creation reaches the game
      Given Alice creates an invite named "  Friday   rematch "
      When Bob accepts and Alice starts the game
      Then GET of the game has name "Friday rematch"
      And Alice's library row has name "Friday rematch"

    Scenario: The owner renames a game and the members are told
      Given a started game of Alice and Bob that Alice owns
      When Alice posts the name "Final"
      Then the answer is 200 with name "Final"
      And Bob's connection is sent a libraryChanged wake with change "renamed"
      And Bob's library row has name "Final"

    Scenario: An invalid name is refused
      Given Alice is signed in
      When Alice creates an invite named with a 49-character name
      Then the answer is 422
      And no invite is written

  Rule: The library lists games by section and activity (D7, D8)

    Scenario: A persisted version stamps last activity and turns
      Given a started game of Alice and Bob at clock 1000
      When Alice ends her turn at clock 5000
      Then the meta's lastActivityAt is the ISO time of 5000
      And the meta's turns is 1

    Scenario: Rows are listed by section, then by last activity
      Given Alice has a finished game, a game where it is her turn and two games where she waits
      When Alice gets her games
      Then the rows are the your-turn game, then the waiting games newest first, then the finished game
      And counts are your-turn 1, waiting 2, finished 1, hidden 0

    Scenario: Finished rows are paged
      Given Alice has twelve finished games
      When Alice gets her games
      Then the answer holds the ten newest finished rows and counts finished 12
      When Alice gets section finished from offset 10
      Then the answer holds the other two rows with total 12

  Rule: A member may hide a finished game from their own list (D9)

    Scenario: Hiding takes a game out of only the caller's list
      Given a won game of Alice and Bob
      When Bob posts hide true
      Then the answer is 200 with hidden true
      And Bob's games hold no row for it and counts hidden 1
      And Alice's games still hold it

    Scenario: A game still in play cannot be hidden
      Given a started game of Alice and Bob with no winner
      When Bob posts hide true
      Then the answer is 409 with reason "not-finished"
