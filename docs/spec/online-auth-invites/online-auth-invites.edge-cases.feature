# language: en
# Overview: docs/spec/online-auth-invites/online-auth-invites.md
# ADR 0002, packet P17

Feature: Online auth and invites — boundaries
  As the operator
  I want invalid lobbies and wrong callers refused
  So that AWS is not billed for browser-only play and tokens die cleanly

  Background:
    Given ADR 0002 is accepted
    And Google ID tokens verify against a fake verifier in tests
    And S3 is a fake store

  Rule: Seat plan must be an online lobby

    Scenario: All-heuristic create is 422 and writes nothing
      Given a valid Google ID token for user A
      When POST /invites with seats heuristic, heuristic, heuristic
      Then the response is 422
      And fake S3 has no new keys

    Scenario: One human and two heuristics is 422 and writes nothing
      Given a valid Google ID token for user A
      When POST /invites with seats human, heuristic, heuristic
      Then the response is 422
      And fake S3 has no new keys

    Scenario: BYOK seat is 422 and writes nothing
      Given a valid Google ID token for user A
      When POST /invites with seats human, human, byok
      Then the response is 422
      And fake S3 has no new keys

    Scenario: Seat count other than 3 or 6 is 422
      Given a valid Google ID token for user A
      When POST /invites with 4 human seats
      Then the response is 422
      And fake S3 has no new keys

    Scenario: hostSeatIndex on a heuristic chair is 422
      Given a valid Google ID token for user A
      When POST /invites with seats human, human, heuristic and hostSeatIndex 2
      Then the response is 422
      And fake S3 has no new keys

    Scenario Outline: A create body that is not a seat plan is 422
      Given a valid Google ID token for user A
      When POST /invites with the raw body <body>
      Then the response is 422
      And fake S3 has no new keys

      Examples:
        | body                                                    |
        | (none)                                                  |
        | {                                                       |
        | null                                                    |
        | []                                                      |
        | {}                                                      |
        | {"seats":5}                                             |
        | {"seats":["human","human","wizard"]}                    |
        | {"seats":["human","human","heuristic"],"hostSeatIndex":"1"} |
        | {"seats":["human","human","heuristic"],"hostSeatIndex":0.5} |

  Rule: Creator chair

    Scenario: hostSeatIndex binds the creator to a later human seat
      Given a valid Google ID token for user A
      When POST /invites with seats human, heuristic, human and hostSeatIndex 2
      Then the response is 201
      And seat 2 is human bound to A's userHash
      And seat 0 is human unbound

  Rule: Accept

    Scenario: Creator accepting their own invite keeps one chair
      Given an open invite by A with seats human, human, heuristic
      When POST /invites/:token/accept with A's bearer
      Then the response is 200
      And A occupies only seat 0
      And seat 1 is still unbound

    Scenario: Same user accepting twice stays on one seat
      Given an open invite by A with seats human, human, heuristic
      And B has accepted once
      When POST /invites/:token/accept with B's bearer again
      Then the response is 200
      And B still occupies only seat 1

    Scenario: Repeat accept restores a missing lobby pointer
      Given an open invite by A with seats human, human, heuristic
      And B has accepted once
      And B's lobby pointer is missing
      When POST /invites/:token/accept with B's bearer again
      Then the response is 200
      And GET /my-games with B's bearer lists that token

    Scenario: Unauthenticated accept is 401
      Given an open invite
      When POST /invites/:token/accept without a bearer
      Then the response is 401
      And the invite seats are unchanged

    Scenario: Sixth human on a full 6-human lobby is 409
      Given an open 6-seat all-human invite with all six chairs bound
      And a valid Google ID token for a seventh user
      When POST /invites/:token/accept with that bearer
      Then the response is 409
      And the invite still has exactly six seats
      And no spectator row was added

    Scenario: Missing or expired Google token is 401 on /me
      When GET /me without a bearer
      Then the response is 401
      When GET /me with an expired Google ID token
      Then the response is 401

  Rule: Revoke and Start

    Scenario: Creator revoke yields 410 revoked
      Given an open invite created by A
      When POST /invites/:token/revoke with A's bearer
      Then the response is 200
      When GET /invites/:token without a bearer
      Then the response is 410
      And the body reason is revoked
      When POST /invites/:token/accept with B's bearer
      Then the response is 410
      And the body reason is revoked

    Scenario: Revoking a started invite is 410 and leaves it started
      Given A and B have started an invite created by A
      When POST /invites/:token/revoke with A's bearer
      Then the response is 410
      And the body reason is started
      And the stored invite is unchanged

    Scenario: Non-creator cannot revoke
      Given an open invite created by A and accepted by B
      When POST /invites/:token/revoke with B's bearer
      Then the response is 403
      And the invite is still open

    Scenario: Start before humans are full is 409
      Given an open 3-seat invite by A with seats human, human, heuristic
      And seat 1 is still unbound
      When POST /invites/:token/start with A's bearer
      Then the response is 409
      And fake S3 holds no group or game objects

    Scenario: Unbound user cannot Start
      Given an open invite with humans A and B bound
      And a valid Google ID token for user C who is not seated
      When POST /invites/:token/start with C's bearer
      Then the response is 403
      And fake S3 holds no group or game objects

    Scenario: After Start the token is 410 started
      Given A and B have started an invite
      When GET /invites/:token without a bearer
      Then the response is 410
      And the body reason is started
      When POST /invites/:token/accept with a new user's bearer
      Then the response is 410
      And the body reason is started
      When POST /invites/:token/start with A's bearer again
      Then the response is 410
      And the body reason is started

    Scenario: B may Start when every human seat is bound
      Given an open 3-seat invite with humans A and B bound and one heuristic
      When POST /invites/:token/start with B's bearer
      Then the response is 200
      And game number 000001 exists under the group

  Rule: Library isolation

    Scenario: /my-games does not list another user's lobby
      Given A has an open invite B has not accepted
      When GET /my-games with B's bearer
      Then the body does not list A's token
      And the body does not list A's userHash as a peer row B did not join

    Scenario: A lobby pointer whose invite is gone is not listed
      Given A has an open invite T
      And A's lobby pointer names a token whose invite object does not exist
      When GET /my-games with A's bearer
      Then the response is 200
      And lobbies lists only T

  Rule: Unknown tokens and route matching

    Scenario: Every invite route is 404 for an unknown token
      Given a valid Google ID token for user A
      And no invite exists for token T
      When GET /invites/T
      Then the response is 404
      When POST /invites/T/accept, /invites/T/revoke and /invites/T/start with A's bearer
      Then each response is 404
      And fake S3 holds no invite, group or game objects

    Scenario: Every invite route is 404 for an unreadable invite record
      Given a valid Google ID token for user A
      And the invite object for token T holds bytes that are not an invite
      When GET /invites/T
      Then the response is 404
      When POST /invites/T/accept, /invites/T/revoke and /invites/T/start with A's bearer
      Then each response is 404
      And the invite object for T still holds the same bytes

    Scenario Outline: Invite routes match whole paths only
      Given an open invite T created by A
      When <method> <path> with A's bearer
      Then the response is 404
      And the invite T is unchanged

      Examples:
        | method | path                    |
        | GET    | /api/invites/T          |
        | GET    | /invites/T/extra        |
        | GET    | /invites/T/accept       |
        | GET    | /invites                |
        | POST   | /invites/T              |
        | POST   | /api/invites/T/accept   |
        | POST   | /invites/T/accept/extra |
        | POST   | /invites/T/join         |
        | POST   | /me                     |
        | POST   | /my-games               |

  Rule: Store failures

    Scenario: A store failure writing an accept surfaces and binds no one
      Given an open invite T by A with seats human, human, heuristic
      And the real store over a probed S3
      And the probed S3 rejects the next conditional put of T's invite with a 500
      When POST /invites/T/accept with B's bearer
      Then the call fails with that error
      And seat 1 of T is still unbound
      And B has no lobby pointer to T
