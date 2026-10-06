# language: en
# Overview: docs/spec/online-moves-ws/online-moves-ws.md
# ADR 0002, packet P18

Feature: Online moves and notify — boundaries
  As the operator
  I want illegal callers refused and partial writes retry-safe
  So that a double-tab or a dropped socket cannot clobber history

  Background:
    Given ADR 0002 is accepted
    And Google ID tokens verify against a fake verifier in tests
    And S3 is a fake store
    And the heuristic chooser is injected
    And PostToConnection is a fake sink

  Rule: Authz

    Scenario: Unauthenticated GET game is 401
      Given a started game
      When GET /games/:groupHash/:gameNumber without a bearer
      Then the response is 401
      And fake S3 still has no state.json

    Scenario: Unauthenticated POST moves is 401
      Given a started game at version 0
      When POST /games/:groupHash/:gameNumber/moves without a bearer
      Then the response is 401
      And the stored version is still 0

    Scenario: WebSocket connect without a token is 401
      When a client opens the WebSocket without access_token
      Then the connect result is 401
      And fake S3 holds no connections keys

    Scenario Outline: WebSocket connect without a token does not call Google
      When a client opens the WebSocket with access_token <token>
      Then the connect result is 401
      And the Google verifier was not called
      And fake S3 holds no connections keys

      Examples:
        | token    |
        | (absent) |
        | (empty)  |

    Scenario Outline: WebSocket connect with a rejected token is 401 and stores nothing
      When a client opens the WebSocket with an <kind> Google ID token
      Then the connect result is 401
      And fake S3 holds no connections keys

      Examples:
        | kind    |
        | expired |
        | invalid |

    Scenario Outline: Disconnect leaves a connection record that names no user
      Given the connection-id record for c is <record>
      When $disconnect arrives for c without a userHash
      Then the disconnect result is 200
      And fake S3 is unchanged

      Examples:
        | record          |
        | not json        |
        | 42              |
        | null            |
        | {"userHash":7}  |

    Scenario: Non-member GET does not materialise
      Given A and B have started a game
      And C has a valid Google token and is not seated
      When GET /games/:groupHash/:gameNumber with C's bearer
      Then the response is 403
      And fake S3 has no state.json

    Scenario: Bound human who is not to move is 403
      Given an all-human 3-seat game with A to move at version 0
      When POST /games/:groupHash/:gameNumber/moves with B's bearer
      And If-Match is "0"
      And the body move is endTurn
      Then the response is 403
      And the stored version is still 0
      And log.jsonl is unchanged

    Scenario: Unknown game is 404
      When GET /games/deadbeefdeadbeefdeadbeefdeadbeef/000001 with A's bearer
      Then the response is 404
      When POST /games/deadbeefdeadbeefdeadbeefdeadbeef/000001/moves with A's bearer
      And If-Match is "0"
      And the body move is endTurn
      Then the response is 404

  Rule: Concurrency and legality

    Scenario: Missing If-Match is 428
      Given A is to move at version 0
      When POST /games/:groupHash/:gameNumber/moves with A's bearer
      And If-Match is omitted
      And the body move is endTurn
      Then the response is 428
      And the stored version is still 0

    Scenario: Stale If-Match is 412
      Given A is to move at version 1
      When POST /games/:groupHash/:gameNumber/moves with A's bearer
      And If-Match is "0"
      And the body move is endTurn
      Then the response is 412
      And the stored version is still 1

    Scenario: Illegal move is 422
      Given A is to move at version 0
      When POST /games/:groupHash/:gameNumber/moves with A's bearer
      And If-Match is "0"
      And the body move is a step the rules reject
      Then the response is 422
      And the stored version is still 0
      And log.jsonl has no new line

    Scenario: POST after winner is 409 finished
      Given a started game whose state.winner is already set
      When POST /games/:groupHash/:gameNumber/moves with a bound human's bearer
      And If-Match is the current version
      And the body move is endTurn
      Then the response is 409
      And the body reason is finished
      And S3 is unchanged

    Scenario: Member GET of a finished game is 200
      Given a started game whose state.winner is set
      When GET /games/:groupHash/:gameNumber with a bound human's bearer
      Then the response is 200
      And the body state winner matches meta.winner

    Scenario: POST without a prior GET still ensures then applies
      Given A and B have started a game with A in the first human seat
      And fake S3 has no state.json
      When POST /games/:groupHash/:gameNumber/moves with A's bearer
      And If-Match is "0"
      And the body move is endTurn
      Then the response is 200
      And the body version is 1
      And fake S3 holds state.json and log.jsonl

    Scenario Outline: If-Match must be exactly a quoted decimal version
      Given A is to move at version 0
      When POST /games/:groupHash/:gameNumber/moves with A's bearer
      And If-Match is <ifMatch>
      And the body move is endTurn
      Then the response is 412
      And the stored version is still 0

      Examples:
        | ifMatch |
        | 0       |
        | W/"0"   |
        | "0"x    |
        | x"0"    |
        | ""      |
        | "0 "    |

    Scenario: A version past 9 matches its If-Match
      Given A is to move at version 12
      When POST /games/:groupHash/:gameNumber/moves with A's bearer
      And If-Match is "12"
      And the body move is endTurn
      Then the response is 200
      And the body version is 13

    Scenario Outline: A move body that is not a move is 422
      Given A is to move at version 0
      When POST /games/:groupHash/:gameNumber/moves with A's bearer
      And If-Match is "0"
      And the raw body is <body>
      Then the response is 422
      And the stored version is still 0
      And log.jsonl has no new line

      Examples:
        | body                                                       |
        | (none)                                                     |
        | not json                                                   |
        | null                                                       |
        | {}                                                         |
        | {"move":null}                                              |
        | {"move":5}                                                 |
        | {"move":{"kind":"jump"}} with a legal step's from/exit/count |
        | a legal step with count "1"                                |
        | a legal step with from 5                                   |
        | a legal step with exit 5                                   |

    Scenario: An unreadable state.json is 500 and is not replaced
      Given A and B have started a game
      And state.json holds bytes that are not a persisted position
      When GET /games/:groupHash/:gameNumber with A's bearer
      Then the response is 500
      When POST /games/:groupHash/:gameNumber/moves with A's bearer
      And If-Match is "0"
      And the body move is endTurn
      Then the response is 500
      And state.json still holds the same bytes

    Scenario: log.jsonl holds exactly one line per applied move
      Given A and B have started a 3-seat game with seats human, human, heuristic
      When GET /games/:groupHash/:gameNumber with A's bearer
      Then log.jsonl is empty
      When A posts endTurn with If-Match "0"
      Then log.jsonl is exactly A's endTurn stamped 1
      When B posts endTurn with If-Match "1"
      Then log.jsonl is exactly A's endTurn stamped 1, B's endTurn stamped 2, and the heuristic's endTurn stamped 2

    Scenario: Without a heuristic chooser the opening heuristic seat waits
      Given the API has no heuristic chooser
      And A and B have started a 3-seat game with seats heuristic, human, human
      When GET /games/:groupHash/:gameNumber with A's bearer
      Then the response is 200
      And the body version is 0
      And the active player is the heuristic seat's
      And log.jsonl is empty

    Scenario: Without a heuristic chooser a heuristic seat waits after a human move
      Given the API has no heuristic chooser
      And A and B have started a 3-seat game with seats human, human, heuristic
      When A posts endTurn with If-Match "0"
      And B posts endTurn with If-Match "1"
      Then B's response body version is 2
      And the active player is the heuristic seat's
      And log.jsonl holds two lines

  Rule: Notify hygiene

    Scenario: Gone connection id is dropped
      Given B has a stored connection id
      And PostToConnection reports that id gone
      When A posts a successful move
      Then B's connection key is deleted
      And the persist still succeeded
      And C still received stateChanged if C is a bound human with a live connection

    Scenario: Heuristic seats are not notified
      Given a 3-seat game with seats human, human, heuristic
      When A posts a successful move
      Then stateChanged was sent only to B's connections
      And no notify targeted a missing userHash

  Rule: P17 follow-on races

    Scenario: Concurrent accept does not share a chair
      Given an open 3-seat invite by A with seats human, human, human
      And seats 1 and 2 are unbound
      When B and C POST accept on that token at the same time
      Then one response is 200 with B on one human seat
      And the other is 200 with C on a different human seat
      And no seat lists both userHashes

    Scenario: Last chair concurrent accept is 409 for the loser
      Given an open 3-seat invite with two humans bound and one human seat left
      When B and C POST accept on that token at the same time
      Then exactly one response is 200
      And the other is 409
      And the invite has exactly three seats

    Scenario: Start does not overwrite an existing game number
      Given group G already has games/000001/meta.json
      When a new invite of the same two humans Starts
      Then the new game number is 000002
      And games/000001/meta.json is unchanged

    Scenario: Retry Start finishes the same game
      Given Start has written games/000001/meta.json
      And the invite is still open
      When POST /invites/:token/start with a bound human's bearer again
      Then the response is 200
      And the body gameNumber is 000001
      And fake S3 has no games/000002
      And the invite status is started

    Scenario: Start does not claim another invite's game number
      Given games/000001/meta.json was allocated by a different invite token
      And this invite of the same humans is still open
      When POST /invites/:token/start
      Then the new game number is 000002
      And games/000001/meta.json still names the other token

    Scenario: Concurrent Start on the same token allocates one game
      Given an open bound invite
      When two bound humans POST start on that token at the same time
      Then at least one response is 200 with gameNumber 000001
      And the other is 200 with the same number or 410 started
      And fake S3 has no games/000002

    Scenario: After completed Start the token is still 410
      Given A and B have completed Start
      When POST /invites/:token/start with A's bearer again
      Then the response is 410
      And the body reason is started

  Rule: Group game counter

    Scenario: Start numbers the game from the group's next game number
      Given group G's meta.json has nextGameNumber 5
      And no game of G exists
      When A and B Start an invite of G
      Then the body gameNumber is 000005
      And group G's nextGameNumber is 6

    Scenario Outline: An unusable group counter numbers from 1
      Given group G's meta.json is <groupMeta>
      When A and B Start an invite of G
      Then the body gameNumber is 000001
      And group G's meta.json is {"nextGameNumber":2}

      Examples:
        | groupMeta              |
        | {"nextGameNumber":0}   |
        | {"nextGameNumber":-3}  |
        | {"nextGameNumber":2.5} |
        | {"nextGameNumber":"7"} |
        | {}                     |
        | 42                     |
        | null                   |
        | not json               |

    Scenario: Retrying Start never moves the group counter backwards
      Given an open bound invite of G whose record already names game 000001
      And group G's meta.json has nextGameNumber 7
      When POST /invites/:token/start with A's bearer
      Then the body gameNumber is 000001
      And group G's nextGameNumber is still 7

    Scenario: Start skips a game number whose meta is unreadable
      Given games/000001/meta.json of G holds bytes that are not game meta
      When A and B Start an invite of G
      Then the body gameNumber is 000002
      And games/000001/meta.json still holds the same bytes

  Rule: Store failures

    Scenario: A store failure writing game meta fails Start and allocates nothing
      Given an open bound invite of G over the real store and a probed S3
      And the probed S3 rejects the next put of games/000001/meta.json with a 500
      When POST /invites/:token/start with A's bearer
      Then the call fails with that error
      And G has no game meta at 000001 or 000002
      And the invite is still open
      When POST /invites/:token/start with A's bearer again
      Then the body gameNumber is 000001

    Scenario: A store failure writing the opening position surfaces
      Given A and B have started a game over the real store and a probed S3
      And the probed S3 rejects the next put of state.json with a 500
      When GET /games/:groupHash/:gameNumber with A's bearer
      Then the call fails with that error
      And the backing has no state.json

    Scenario: A store failure persisting a move is 500 and notifies no one
      Given A and B have started and opened a 3-seat game over the real store and a probed S3
      And B has a stored connection
      And the probed S3 rejects the next conditional put of state.json with a 500
      When A posts endTurn with If-Match "0"
      Then the response is 500
      And state.json is still at version 0
      And no stateChanged was posted

  Rule: Stub retirement

    Scenario: P16 POST /moves stub is gone
      When POST /moves with A's bearer
      Then the response is not 501
      And the response is 404

  Rule: Route matching

    Scenario Outline: Game routes match whole paths only
      Given A and B have started a game G/000001
      When <method> <path> with A's bearer
      Then the response is 404
      And fake S3 still has no state.json

      Examples:
        | method | path                       |
        | GET    | /api/games/G/000001        |
        | GET    | /games/G/000001/extra      |
        | GET    | /api/games/G/000001/log    |
        | GET    | /games/G/000001/logs       |
        | GET    | /games/G/000001/moves      |
        | GET    | /games/G                   |
        | GET    | /nowhere                   |
        | POST   | /games/G/000001            |
        | POST   | /api/games/G/000001/moves  |
        | POST   | /games/G/000001/movesx     |
        | POST   | /games/G/000001/moves/x    |
        | POST   | /games/G/000001/log        |
