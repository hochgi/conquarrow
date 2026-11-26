# language: en
# Overview: docs/spec/lost-seat-standings/lost-seat-standings.md
# Packet P102 — a lost seat is marked, and a finished online game shows standings

Feature: A lost seat is visible, and a finished online game shows standings
  As a player in a match
  I want a lost seat marked once, and the server's standings when an online game ends
  So that I notice an elimination when it happens and can read how the game ended

  Rule: The seat line marks a lost seat and keeps it (D6)

    Scenario: A lost seat is struck, greyed, and named eliminated, and keeps its kind text
      Given the seat line lists "A" as "Player", "B" as "AI", and "C" as "Agent"
      And the lost set is "C"
      When the seat line is read
      Then the items are "A", "B", "C" in that order
      And "C" is lost, struck, and greyed
      And the accessible name of "C" is "C — eliminated"
      And the visible text of "C" is "C=Agent"
      And "A" and "B" are not lost, not struck, and not greyed
      And "A" and "B" have no accessible name

  Rule: A toast fires once, from the diff, and the first snapshot is silent (D2, D3, D4)

    Scenario: The first snapshot toasts for nobody
      Given no previous lost set
      And the next lost set is "A" and "C"
      When newly lost seats are read
      Then no seat is newly lost

    Scenario: Several seats lost in one snapshot toast once each, in order
      Given the previous lost set is empty
      And the next lost set is "B" and "C"
      When elimination toasts are read with the letter as the label
      Then the toasts are "B was eliminated" and "C was eliminated" in that order
      And each toast id is that letter

    Scenario: A later snapshot does not repeat a toast
      Given the previous lost set is "B" and "C"
      And the next lost set is "B" and "C"
      When newly lost seats are read
      Then no seat is newly lost

    Scenario: The caller's own loss says You were eliminated
      Given the label "you"
      When the elimination sentence is read
      Then the sentence is "You were eliminated"

  Rule: Online standings come from the summary, or not at all (D7)

    Scenario: The winner is first, the caller is you, a lost seat is marked, and the turn is named
      Given a summary won by "A" on turn 14
      And standings "A" seat 0 not lost with territory 12, shares 3, heads 4
      And standings "B" seat 1 lost with territory 0, shares 0, heads 0
      And standings "C" seat 2 lost with territory 0, shares 0, heads 0
      And seat 0 is a human chair with hash "alice"
      And seat 1 is a human chair with hash "bob"
      And seat 2 is a heuristic
      And the caller hash is "alice"
      And the match is showing game-over
      When the standings view is read
      Then the view is a table
      And the caption is "Won on turn 14"
      And the rows are "A", "B", "C" in that order
      And row "A" is marked you, is the winner, and its marker is "winner"
      And row "A" shows territory 12, shares 3, and heads 4
      And row "B" is not you, is lost, and its marker is "lost"
      And row "C" is labeled "AI", is lost, and its marker is "lost"
      And the local summary line is hidden

    Scenario: A missing summary keeps the winner line and the local summary line
      Given no summary
      And the match is showing game-over
      When the standings view is read
      Then the view is the fallback
      And no standings row is invented
      And the local summary line is shown

    Scenario: A summary does not draw a table before game-over is showing
      Given a summary won by "A" on turn 14
      And the match is not showing game-over
      When the standings view is read
      Then the view is the fallback
      And the local summary line is shown
