# language: en
# Overview: docs/spec/id-free-copy/id-free-copy.md
# Packet P103 — copy names stacks, not arrows; the camera is free while a seat thinks

Feature: Player-facing copy never shows an arrow id
  As a player
  I want the strip and its buttons to talk about my stacks, not internal ids
  So that I can tell which stack a line or a button means

  Rule: The strip names the selected stack by size

    Scenario: The selection line counts heads, not the arrow
      Given movable stacks "m1", "m2", "m3"
      When "m2" with 2 heads is selected
      Then the selection line reads "Selected: 2 heads · 2 of 3"

    Scenario: The count note says where the rest stay without an id
      Given a run of 1 head from a stack of 3
      Then the count note reads "2 heads stay where the last run began"

    Scenario: A refusal with a selection names the selected stack
      Given a stack is selected
      When an out-of-reach arrow is clicked
      Then the message line reads "Too far for the selected stack"

  Rule: A merge button says which of your stacks and which way

    Scenario: A merge target up and to the left
      Given the selected stack's centre is at (0, 0)
      And a merge target of 3 heads is centred at (-2, -2)
      Then its button reads "Merge into your 3-stack, up-left"

  Rule: The camera is locked only while moves are shown

    Scenario: A seat thinking between two replayed batches leaves the camera free
      Given an online game where it is not my turn
      And no batch is playing or queued
      Then the camera is not locked

    Scenario: A replayed batch locks the camera
      Given an online batch is playing
      And auto-focus is on and the seat is spectated
      Then the camera is locked
