# language: en
# Overview: docs/spec/online-reliability/online-reliability.md
# Packet P97 — lobby sign-in, happy path

Feature: A signed-in lobby lists My games
  As a player who just picked a Google account
  I want the lobby to show that I am signed in and to list my games
  So that I am not asked to sign in again, and a game I am seated in is not hidden

  Background:
    Given the lobby route is open
    And the host store holds no ID token
    And GET /my-games for A returns one started game, group G game 000001, status your-turn

  Rule: A credential on the lobby lists My games once (D13)

    Scenario: A credential on the lobby signs the shell in and lists My games
      When A's Google credential arrives
      Then the host reports signed in
      And exactly one GET /my-games is sent
      And My games lists group G game 000001
