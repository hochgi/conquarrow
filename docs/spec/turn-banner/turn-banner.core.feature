# language: en
# Overview: docs/spec/turn-banner/turn-banner.md
# Packet P101 — the turn banner names whose turn it is, happy path

Feature: The turn banner says who is playing
  As a player watching an online game
  I want the banner to say whose turn it is
  So that an agent or an AI turn does not look like my frozen turn

  Rule: Online, only the caller's human seat is "you" (D2)

    Scenario: The caller's own turn says you and Your turn, with no spinner
      Given an online turn for letter "A", kind "human", relation "caller-human"
      And no replay is playing
      And the phase is idle with moves left
      When the turn copy is read
      Then the banner is "Turn: A · you"
      And the hint is "Your turn — gold-outlined stacks can still move"
      And the thinking indicator is off

    Scenario: The caller's own agent does not say you
      Given an online turn for letter "C", kind "agent", relation "caller-agent"
      And no replay is playing
      When the turn copy is read
      Then the banner is "Turn: C · your agent is playing…"
      And the hint is "Waiting for C…"
      And the thinking indicator is on
      And the hint does not start with "Your turn"
      And the suffix is not " · you"

    Scenario: Another seat's named agent uses the owner name
      Given an online turn for letter "B", kind "agent", relation "other", owner "Ada"
      And no replay is playing
      When the turn copy is read
      Then the banner is "Turn: B · Ada's agent is playing…"
      And the hint is "Waiting for B…"
      And the thinking indicator is on

    Scenario: Another seat's unnamed agent uses the letter
      Given an online turn for letter "B", kind "agent", relation "other"
      And no replay is playing
      When the turn copy is read
      Then the banner is "Turn: B · B's agent is playing…"
      And the hint is "Waiting for B…"
      And the thinking indicator is on

    Scenario: A heuristic seat says the AI is playing
      Given an online turn for letter "C", kind "heuristic", relation "other"
      And no replay is playing
      When the turn copy is read
      Then the banner is "Turn: C · AI is playing…"
      And the hint is "Waiting for C…"
      And the thinking indicator is on

    Scenario: Another human says that seat is playing
      Given an online turn for letter "B", kind "human", relation "other"
      And no replay is playing
      When the turn copy is read
      Then the banner is "Turn: B · B is playing…"
      And the hint is "Waiting for B…"
      And the thinking indicator is on

  Rule: A replay hides the spinner and keeps the words (D4)

    Scenario: A replay of someone else's turn does not spin
      Given an online turn for letter "C", kind "agent", relation "caller-agent"
      And a replay is playing
      When the turn copy is read
      Then the banner is "Turn: C · your agent is playing…"
      And the hint is "Waiting for C…"
      And the thinking indicator is off

  Rule: Local matches keep their conditions (D3)

    Scenario: A local hot-seat turn has no you and no spinner
      Given a local hot-seat turn for letter "A"
      And the phase is idle with moves left
      When the turn copy is read
      Then the banner is "Turn: A"
      And the hint is "Gold-outlined stacks can still move"
      And the thinking indicator is off
      And the banner does not contain "Player "

    Scenario: A local versus-bot human turn still says you
      Given a local versus-bot turn for letter "A", kind "human", relation "caller-human"
      And the bots are running and not busy
      And the phase is idle with moves left
      When the turn copy is read
      Then the banner is "Turn: A · you"
      And the hint is "Your turn — gold-outlined stacks can still move"
      And the thinking indicator is off

  Rule: Online facts come from the game seats (D5)

    Scenario: A three-seat game derives you, your agent, and the AI
      Given online seats human "me", agent "me" named "Ada", and heuristic
      And the caller hash is "me"
      And the players are "A", "B", "C"
      When the active seat is derived for "A", "B", and "C"
      Then "A" is human, relation "caller-human", with no owner name
      And "B" is agent, relation "caller-agent", owner "Ada"
      And "C" is heuristic, relation "other", with no owner name
