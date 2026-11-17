# language: en
# Overview: docs/spec/online-reliability/online-reliability.md
# Packet P97 — lobby sign-in edges

Feature: Sign-in reaches the lobby, and the Google button does not linger
  As a player on a phone or a laptop
  I want sign-in, sign-out, and the Google button to follow the host's token
  So that a stored credential is not painted as signed out, and an empty list is not a missed fetch

  Rule: Sign-out and a second sign-in (D13)

    Scenario: Signing out turns the host's signed-in flag off and clears My games
      Given A is signed in on the lobby and My games is loaded
      When A signs out
      Then the host reports signed out
      And My games is cleared
      And My games is not offered

    Scenario: Signing in again after sign-out lists My games once
      Given A has signed out on the lobby
      And GET /my-games for A returns group G game 000001
      When A's Google credential arrives
      Then the host reports signed in
      And exactly one GET /my-games is sent
      And My games lists group G game 000001

  Rule: A credential on another route does not become a library read (D13)

    Scenario: A credential on an invite route accepts and does not list My games
      Given an invite route is open and the host store holds no token
      When A's Google credential arrives
      Then the invite accept is posted
      And no GET /my-games is sent

    Scenario: A credential on a game route reads the game and does not list My games
      Given a game route is open and the host store holds no token
      When A's Google credential arrives
      Then the game is read
      And no GET /my-games is sent

  Rule: The shell asks the host, and refreshes only when due (D13)

    Scenario: The shell asks the host whether it is signed in
      Then no web source reads the ID token key from sessionStorage

    Scenario Outline: My games refresh is due only on a signed-in lobby with no library
      Given signed in is <signed in>
      And the hash route is the lobby is <on lobby>
      And the library is loaded is <library loaded>
      Then a lobby library read is due is <due>

      Examples:
        | signed in | on lobby | library loaded | due   |
        | true      | true     | false          | true  |
        | false     | true     | false          | false |
        | true      | false    | false          | false |
        | true      | true     | true           | false |

    Scenario: The shell starts a library read only when one is due
      Then App calls refreshLibrary only when lobbyLibraryDue is true
      And that call's lobby flag is the hash route, not whether React state is unset

  Rule: The Google chooser mounts once, and never while signed in (D13)

    Scenario Outline: The chooser slot is offered only while signed out
      Given signed in is <signed in>
      Then the chooser slot is offered is <offered>

      Examples:
        | signed in | offered |
        | false     | true    |
        | true      | false   |

    Scenario: An absent chooser slot is not created and is not rendered
      Given a document with no chooser slot
      When the chooser is offered
      Then renderButton is not called
      And the document gains no chooser slot
      And no lobby row is queried

    Scenario: An empty chooser slot is rendered once
      Given a document whose chooser slot is empty
      When the chooser is offered twice
      Then renderButton is called once
      And the slot is not moved

    Scenario: A filled chooser slot is not rendered again
      Given a document whose chooser slot already holds a button
      When the chooser is offered twice
      Then renderButton is not called
      And the slot is not moved

    Scenario: A credential does not remove the chooser slot
      Given a document whose chooser slot is empty
      When a Google credential callback runs
      Then the chooser slot is still in the document

    Scenario: The chooser does not attach to a lobby row
      Then online-gis does not query a lobby-online-row
      And Lobby renders the chooser slot id only when chooserSlotOffered is true
