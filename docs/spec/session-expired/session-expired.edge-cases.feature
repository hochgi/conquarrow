# language: en
# Overview: docs/spec/session-expired/session-expired.md
# Packet P98 — expired sign-in, edges

Feature: A dead session cannot look like success
  As a player on a phone
  I want every lobby action to end in a link, a list, or a sentence
  So that a swallowed 401 is not an empty lobby

  Background:
    Given the lobby route is open
    And the clock is frozen

  Rule: An unusable token is removed and is not session expired (D1)

    Scenario: An opaque token is signed out and removed
      Given player A's stored token is the opaque string alice-id-token
      When the host is asked whether A is signed in
      Then the host reports signed out
      And the token is gone
      And session expired is clear

    Scenario: A token whose exp is not a number is signed out and removed
      Given player A's stored token has exp set to the string soon
      When the host is asked whether A is signed in
      Then the host reports signed out
      And the token is gone
      And session expired is clear

    Scenario: A token whose exp equals now is signed out and removed
      Given player A's stored token expires at the frozen now
      When the host is asked whether A is signed in
      Then the host reports signed out
      And the token is gone
      And a second ask still reports signed out

    Scenario: A create with an already expired token sends nothing
      Given player A's stored token expired one hour ago
      And the seat plan is two Players and the invite name is valid
      When A creates an invite
      Then the promise resolved
      And no POST /invites was sent
      And the create note is absent
      And session expired is clear
      And the host reports signed out

  Rule: A create that is not a 401 still ends visibly (D4)

    Scenario Outline: A non-success create shows a note and resolves
      Given player A is signed in with a token an hour from expiry
      And the seat plan is two Players and the invite name is valid
      When A creates an invite and the server answers <status> with <body>
      Then the promise resolved
      And create is not pending
      And the invite link is absent
      And the create note is <note>
      And session expired is clear
      And GIS prompt was called zero times

      Examples:
        | status | body                                      | note                                          |
        | 422    | {"error":"unprocessable"}                 | The server refused this seat plan             |
        | 422    | {"error":"unprocessable","reason":"seats"} | The server refused this seat plan: seats     |
        | 422    | not-json                                  | The server refused this seat plan             |
        | 500    | {"error":"internal"}                      | Couldn't create the invite — try again        |
        | 403    | {"error":"forbidden"}                     | Couldn't create the invite — try again        |

    Scenario: A thrown create fetch shows the failed sentence and resolves
      Given player A is signed in with a token an hour from expiry
      And the seat plan is two Players and the invite name is valid
      When A creates an invite and the fetch throws
      Then the promise resolved
      And create is not pending
      And the invite link is absent
      And the create note is Couldn't create the invite — try again
      And session expired is clear

    Scenario: A later success clears the create note
      Given player A is signed in with a token an hour from expiry
      And a previous create left the failed sentence
      When A creates an invite and the server answers 201 with an invite token
      Then the invite link is shown
      And the create note is absent

  Rule: The held create is one shot (D3)

    Scenario: A second 401 on the retry does not post a third time
      Given player A is signed in with a token an hour from expiry
      And the seat plan is two Players and the invite name is valid
      And POST /invites answers 401
      When A creates an invite
      And A's new Google credential arrives
      And that retry is answered 401
      Then exactly two POST /invites were sent
      And no GET /my-games was sent
      And the invite link is absent
      And session expired is set
      And the host reports signed out
      And GIS prompt was called twice

    Scenario: Signing out before the credential does not retry the create
      Given a create for A was answered 401 and is held
      When A signs out
      And A's Google credential arrives
      Then no further POST /invites was sent
      And session expired is clear
      And the create note is absent

    Scenario: A credential on a game route does not retry the create
      Given a create for A was answered 401 and is held
      And the hash route is a game
      When A's Google credential arrives
      Then the game is read
      And no POST /invites was sent for the retry
      And no GET /my-games was sent

    Scenario: A credential on an invite route does not retry the create
      Given a create for A was answered 401 and is held
      And the hash route is an invite
      When A's Google credential arrives
      Then the invite accept is posted
      And no POST /invites was sent for the retry
      And no GET /my-games was sent

    Scenario: A plan that is no longer creatable is not retried
      Given a create for A was answered 401 and is held
      And the seat plan is now one Player
      When A's Google credential arrives on the lobby
      Then no POST /invites was sent for the retry
      And exactly one GET /my-games was sent

    Scenario: The retry sends the plan at credential time
      Given a create for A was answered 401 while the plan was two Players
      And the plan is now one Player and one Agent
      And the invite name is now Rematch
      When A's Google credential arrives on the lobby
      Then the retry POST /invites carries one Player, one Agent, and the name Rematch
      And exactly one retry POST /invites was sent

  Rule: My games does not paint a failure as empty (D5)

    Scenario: A 401 on My games is session expired, not an empty library
      Given player A is signed in with a token an hour from expiry
      And My games has not loaded
      When A refreshes My games and the server answers 401
      Then session expired is set
      And the host reports signed out
      And the library is not failed
      And the library is not an empty success
      And the session-expired note is offered
      And the load-failed note is absent
      And GIS prompt was called once

    Scenario: A 500 on My games is load-failed, not empty
      Given player A is signed in with a token an hour from expiry
      When A refreshes My games and the server answers 500
      Then the library is failed
      And the library is not an empty success
      And session expired is clear
      And the load-failed note is offered
      And My games is not empty

    Scenario: A thrown library fetch is load-failed
      Given player A is signed in with a token an hour from expiry
      When A refreshes My games and the fetch throws
      Then the promise resolved
      And the library is failed
      And session expired is clear
      And the load-failed note is offered

    Scenario: A 200 body that does not parse is load-failed
      Given player A is signed in with a token an hour from expiry
      When A refreshes My games and the server answers 200 with not-json
      Then the library is failed
      And the library is not an empty success
      And My games is not empty

    Scenario: An unset library is not No games yet
      Given player A is signed in
      And My games has not loaded
      Then My games is not empty
      And the load-failed note is absent

    Scenario: Retry after a library failure reads My games again
      Given player A's library read failed
      When A retries My games and the server answers 200 with no games
      Then the library is not failed
      And My games is empty

  Rule: Any other authenticated 401 is the same door (D2)

    Scenario Outline: An authenticated 401 expires the session and does not succeed
      Given player A is signed in with a token an hour from expiry
      And a held submit is <held>
      And that action is ready to send an authenticated request
      When A <action> and the server answers 401
      Then session expired is set
      And the host reports signed out
      And the token is gone
      And the chooser slot is offered
      And GIS prompt was called once
      And the action's failure is <failure>
      And the held submit is still <held>

      Examples:
        | action            | held  | failure                          |
        | accepts the invite | no    | no seat was bound                |
        | starts the match   | no    | the hash is unchanged            |
        | reads the game     | no    | the board is unchanged           |
        | exports the game   | no    | no export text                   |
        | deletes the game   | no    | delete returned false            |
        | hides the game     | no    | hide returned false              |
        | renames the game   | no    | rename returned false            |
        | polls the version  | no    | no wake was taken                |
        | loads more games   | no    | no row was appended              |
        | boots and reads /me | no   | the user hash is unset           |

    Scenario: A 401 on submit keeps the held submit and expires the session
      Given player A is signed in on a game route with a token an hour from expiry
      And A has a legal endTurn to submit
      When A submits that move and the server answers 401
      Then the submit outcome is unauthorized
      And the submit is still pending
      And the held submit is kept
      And session expired is set
      And the host reports signed out
      And the P95 unauthorized submit note is unchanged
      When A's new Google credential arrives on that game route
      Then the held submit is posted with the same submit id
      And the held submit is then clear

    Scenario: A library 401 does not drop a held submit
      Given player A has a held submit
      When A refreshes My games and the server answers 401
      Then the held submit is kept
      And session expired is set

    Scenario: A following heartbeat sends nothing after a 401
      Given player A is signed in and a socket is open
      When A refreshes My games and the server answers 401
      And the host heartbeats
      Then no heartbeat is sent
      And a following authenticated request sends no Authorization

  Rule: The lead window prompts once and does not block the fallback (D6)

    Scenario Outline: A user action inside the lead prompts once and still sends
      Given player A is signed in with a token one minute from expiry
      And GIS has not been prompted for that token
      And that action is ready to send an authenticated request
      When A <action>
      Then GIS prompt was called once
      And the request was sent with A's current bearer

      Examples:
        | action             |
        | creates an invite  |
        | accepts the invite |
        | starts the match   |
        | refreshes My games |
        | opens a listed game |
        | submits a move     |
        | exports the game   |
        | deletes the game   |
        | hides the game     |
        | renames the game   |
        | loads more games   |

    Scenario: A token already prompted is not prompted again, until a 401
      Given player A is signed in with a token one minute from expiry
      And GIS has already been prompted for that token
      When A creates an invite and the server answers 200
      Then GIS prompt was called zero times for that create
      And the request was sent with A's current bearer
      When A creates an invite and the server answers 401
      Then GIS prompt was called once for that 401
      And the host reports signed out
      And the chooser slot is offered
      And the session-expired note is offered

  Rule: Sign-out and the seat sentence (D7)

    Scenario: Signing out clears the expiry flags
      Given a library read for A failed
      And a later create for A was answered 401 and is held
      And the create note is absent
      When A signs out
      Then the host reports signed out
      And session expired is clear
      And the create note is absent
      And the library is not failed
      And the library is cleared
      And a later credential on the lobby does not post /invites for that held create

    Scenario: Signing out clears a create note
      Given player A is signed in with a token an hour from expiry
      And the seat plan is two Players and the invite name is valid
      And a create was answered 500
      When A signs out
      Then the create note is absent
      And the host reports signed out
      And session expired is clear

    Scenario Outline: The seat-plan note follows the creatable rule
      Given player A is signed in
      And the seat plan is <plan>
      Then the seat-plan note is <note>

      Examples:
        | plan                              | note                                                     |
        | two Players                       | absent                                                   |
        | one Player and one Agent          | absent                                                   |
        | one Player and one AI             | Create needs two Players, or a Player and an Agent.      |
        | one Player                        | Create needs two Players, or a Player and an Agent.      |
        | one Agent                         | Create needs two Players, or a Player and an Agent.      |

    Scenario: An invalid name does not show the seat-plan note
      Given player A is signed in
      And the seat plan is two Players
      And the invite name is not valid
      Then the seat-plan note is absent
      And create is not offered

    Scenario: The old two-Player sentence is gone from the lobby
      Then Lobby does not contain the sentence Create needs two Player seats.
