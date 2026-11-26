# language: en
# Overview: docs/spec/seat-labels/seat-labels.md
# Packet P105 — seat labels everywhere

Feature: Every seat is named the same way on every surface
  As a player
  I want to see who sits in each seat in plain words
  So that I know which seat is me, which is my agent and who the others are

  Rule: One table words every seat

    Scenario: My own seats
      Given I am bound to seat A and my agent to seat B
      Then seat A reads "you"
      And seat B reads "your agent"

    Scenario: Other people's seats, with names
      Given Bob is bound to seat B with the profile name "Bob"
      And Ada's agent is bound to seat C, and her profile name is "Ada"
      Then seat B reads "Bob"
      And seat C reads "Ada's agent"

    Scenario: Other people's seats, without names
      Given seat B is another human with no profile name
      And seat C is another person's agent with no profile name
      Then seat B reads "Player B"
      And seat C reads "Agent"

    Scenario: Unbound and AI seats
      Given seat B is an open human seat and seat C is AI
      Then seat B reads "waiting"
      And seat C reads "AI"

  Rule: Members get names in the invite and game bodies

    Scenario: The creator's roster names a joiner
      Given Alice created an invite and Bob, named "Bob", accepted it
      When Alice's lobby peeks the invite while signed in
      Then the body names seat B "Bob"
      And Alice's roster reads "you · Bob · AI"

    Scenario: The game body names every bound chair
      When a member reads the game
      Then every bound human and agent chair carries its owner's name

  Rule: Seat A says it is you

    Scenario: The host seat's Player option
      Given the online lobby with seat A as Player
      Then seat A's Player option reads "Player (you)"
      And seat A offers no Agent

  Rule: The seat selects line up

    Scenario: Even widths
      Then every seat select and the roster column share one width
