# language: en
# Overview: docs/spec/remote-agent-mcp/remote-agent-mcp.md
# Packet P92, ADR 0009. Boundaries the happy path does not pin down.

Feature: Remote agent seat boundaries
  As a person sharing an invite with an IDE
  I want refused plans, bad replies, and bad tokens to change nothing
  So that a wrong call cannot start a game or rewrite a position

  Background:
    Given Google ID tokens verify against a fake verifier
    And the MCP door signs tokens with an injected signer and an injected clock
    And S3 is a fake store
    And PostToConnection is a probe

  Rule: Create still refuses a plan that is not one human plus an agent, or two humans

    Scenario Outline: Create refuses and stores nothing
      Given a valid Google ID token for user A
      When A POSTs /invites with seats <seats> and host <host>
      Then the response is 422
      And fake S3 holds no invite, lobby pointer, group, or game object

      Examples:
        | seats                              | host    |
        | agent, agent, heuristic            | omitted |
        | human, heuristic, heuristic        | omitted |
        | byok, human, human                 | omitted |
        | agent, human, heuristic            | 0       |
        | human, agent                       | omitted |

  Rule: Accept and join do not take each other's chairs

    Scenario: Accept by a user who already holds the agent seat binds the next human
      Given an open invite with seats human unbound, agent bound to A, heuristic
      And a valid Google ID token for A
      When A accepts the invite
      Then the response is 200
      And seat 0 is human bound to A's userHash
      And the agent seat is still bound to A

    Scenario: Accept is 409 when every human seat is bound, even if an agent seat is free
      Given an open invite with seats human bound to A, human bound to B, agent unbound
      And a valid Google ID token for user C
      When C accepts the invite
      Then the response is 409
      And the agent seat is still unbound

    Scenario Outline: join refuses and does not change seats
      Given an invite whose status is <status> and whose agent seats are <agents>
      And an MCP access token for user C
      When C calls join with <handle>
      Then the tool is an error "<error>"
      And no seat's userHash changes

      Examples:
        | status  | agents              | handle            | error          |
        | open    | none                | the bare token    | no-agent-seat  |
        | open    | both bound to others| the bare token    | full           |
        | revoked | one unbound         | the bare token    | revoked        |
        | started | one bound to C      | the bare token    | started        |
        | open    | one unbound         | not a token       | bad-handle     |

    Scenario: Two different Google users may each hold an agent seat
      Given an open invite with two unbound agent seats
      And MCP access tokens for C and D
      When C calls join and then D calls join
      Then C and D are bound to different agent seats
      And neither call took a human chair

  Rule: Start is still a browser action, and it waits

    Scenario: Start before the agent has joined is refused and the invite stays open
      Given an open invite with a human bound to A and an unbound agent seat
      And a valid Google ID token for A
      When A POSTs start
      Then the response is 409
      And GET of the invite token is still 200
      And fake S3 holds no group or game object

    Scenario: Start with an MCP access token is 401 and writes nothing
      Given an open invite with every human and every agent seat bound
      And an MCP access token for the bound human A
      When that token is presented to POST start
      Then the response is 401
      And fake S3 holds no group or game object

  Rule: observe and move refuse without writing

    Scenario: observe before Start returns stop and does not write a game
      Given an open invite whose agent seat is bound to C
      And an MCP access token for C
      When C calls observe with the invite handle
      Then the tool text has stop true, reason "not-started", and no offer
      And fake S3 holds no state.json and no log.jsonl

    Scenario Outline: observe when it is not this agent's turn
      Given a started game whose turn state is <state>
      And an MCP access token for C, who holds an agent seat
      When C calls observe
      Then the tool text has stop true, reason "<reason>", and no offer

      Examples:
        | state                         | reason         |
        | a heuristic seat to move      | not-your-turn  |
        | another human seat to move    | not-your-turn  |
        | another agent seat to move    | not-your-turn  |
        | game over                     | game-over      |

    Scenario: observe by a user who has not joined
      Given a started game with an unbound agent seat
      And an MCP access token for D, who holds no seat
      When D calls observe with the invite handle
      Then the tool text has stop true, reason "not-seated", and no offer

    Scenario: A bad index does not change state or version
      Given it is C's agent turn at version 3
      When C calls move with moves [99] and endTurn true
      Then the tool is an error the model can read
      And the tool text has stop false
      And the stored version is still 3
      And the log has no agentReply line

    Scenario: A legal index followed by an illegal one writes nothing
      Given it is C's agent turn and index 0 is legal now
      When C calls move with moves [0, 99] and endTurn false
      Then the stored version is unchanged
      And the active seat is unchanged
      And the tool text has stop false

    Scenario: A move when it is not the agent's turn leaves state unchanged
      Given a started game whose active seat is not C's agent seat
      And the stored version is 4
      When C calls move with endTurn true
      Then the tool text has stop true and reason "not-your-turn"
      And the stored version is still 4
      And the log has no new agentReply line

    Scenario: Empty moves and endTurn false, while a step remains, writes nothing
      Given it is C's agent turn and a legal step remains
      When C calls move with moves [] and endTurn false
      Then the tool text has stop false and the current offer
      And the stored version is unchanged
      And the tool is not an error

    Scenario: No legal step remains, so the turn ends even when endTurn is false
      Given it is C's agent turn and the offer has no legal step
      And the next seat is a human
      When C calls move with moves [] and endTurn false
      Then the tool text has applied true, stop true, and no offer
      And the active seat is that human seat

    Scenario: A lost conditional put does not retry and does not double-apply
      Given it is C's agent turn
      And the conditional put will fail once
      When C calls move with a legal prefix and endTurn true
      Then the tool is an error the model can read with stop false
      And this call wrote no version and no agentReply line

  Rule: The reply record is not a move

    Scenario: The log line has the reply fields and the replay ignores it
      Given a persisted agent move at version 2 with moves [1, 2] and endTurn true
      When the log is read and the move lines are replayed from the opening
      Then the agentReply line has moves [1, 2], endTurn true, and version 2
      And the agentReply line has no invite token, no bearer, and no offer text
      And GET /log does not include that line in moves
      And replaying the move lines reconstructs the stored position

    Scenario: A token echoed into why is redacted before the line is stored
      Given it is C's agent turn
      When C calls move with endTurn true and why containing the invite token and the bearer
      Then the stored agentReply why does not contain the invite token or the bearer
      And the probed log calls do not contain the invite token or the bearer

    Scenario: A browser move does not append an agentReply line
      Given it is A's human turn
      When A POSTs /moves with a legal move
      Then the new log lines are moves
      And none of them has an agentReply key

  Rule: The door rejects the wrong caller before it runs a tool

    Scenario: An unauthenticated POST is 401 and names the protected-resource metadata
      When POST /conquarrow has no Authorization header
      Then the response is 401
      And WWW-Authenticate names "https://mcp.games.hochgi.com/.well-known/oauth-protected-resource/conquarrow"
      And fake S3 is unchanged

    Scenario: Protected-resource metadata points at this host and this path
      When GET /.well-known/oauth-protected-resource/conquarrow without a bearer
      Then the response is 200
      And resource is "https://mcp.games.hochgi.com/conquarrow"
      And authorization_servers is "https://mcp.games.hochgi.com"

    Scenario Outline: A token that is not this door's access token is 401
      Given a bearer that is <bearer>
      When that bearer is presented to POST /conquarrow
      Then the response is 401
      And the body does not contain the bearer

      Examples:
        | bearer                                      |
        | an access token whose aud is a different URL |
        | an access token whose exp is at the clock    |
        | a Google ID token                            |

    Scenario: GET /conquarrow does not open a stream
      When GET /conquarrow
      Then the response is 405
      And the response has no Mcp-Session-Id header
      And the body is not an event stream

    Scenario: An older known initialize version is echoed, and no session is minted
      Given an MCP access token for A
      When A POSTs initialize with protocolVersion "2025-03-26"
      Then the result protocolVersion is "2025-03-26"
      And the response has no Mcp-Session-Id header

    Scenario: There is no registration endpoint
      When POST /register
      Then the response is 404
      And authorization-server metadata has no registration_endpoint
      And authorization-server metadata has client_id_metadata_document_supported true

    Scenario: A non-https client_id is refused before fetch
      When authorize is requested with a client_id that is not an https URL
      Then the response is a refusal
      And the metadata fetch was not called

    Scenario: A redirect that is not in the metadata document is refused
      Given a client-id metadata document whose redirect_uris do not include the requested redirect
      When authorize is requested with that client_id
      Then the response is a refusal
      And no authorization code is stored

    Scenario: A loopback redirect may use an ephemeral port
      Given a client-id metadata document that lists http://127.0.0.1/callback
      When authorize is requested with redirect_uri http://127.0.0.1:61762/callback
      Then the response is the consent page
      And the response is not a redirect to Google

    Scenario: The consent page names the redirect host and does not send the browser to Google yet
      When GET /authorize for a localhost redirect
      Then the response is 200
      And the body contains the redirect hostname
      And the response is not a redirect to Google

    Scenario: A rotated refresh token is rejected and the new one works
      Given an MCP refresh token for A
      When A refreshes once
      Then the new access token is accepted on POST /conquarrow
      And the previous refresh token is 401
      And the stored refresh object is one object, not a list

  Rule: Ping and burst stay inside one invocation

    Scenario: A browser move still does not ping the caller
      Given it is A's human turn
      And A and B each have a WebSocket connection
      When A POSTs /moves with a legal move
      Then B's connection received stateChanged
      And A's connection did not

    Scenario: The burst stops at the next agent and writes one version
      Given it is C's agent turn, the next seat is heuristic, and the seat after that is D's agent seat
      When C calls move with endTurn true
      Then exactly one new version is stored
      And the active seat is D's agent seat
      And no chooser move was applied for D

  Rule: The lobby and the library tell the truth about the chair

    Scenario: The online picker offers agent and the local picker does not
      When the lobby is online
      Then the kind options include agent
      And seat 0's options do not include agent
      When the lobby is local
      Then the kind options do not include agent

    Scenario: Local to Online keeps an agent chair and does not force a second human
      Given a plan with seats human, agent, heuristic
      When the lobby switches from local to online
      Then seat 1 is still agent
      And the plan still has one human seat

    Scenario: Local to Online with no agent chair still forces two humans
      Given a plan with seats human, heuristic, heuristic
      When the lobby switches from local to online
      Then seats 0 and 1 are human

    Scenario: The library labels the agent chair and does not call it your-turn
      Given a started game where A holds the human seat and the agent seat, and the agent is to move
      And A's profile display name is "Ada"
      When A GETs /my-games
      Then the agent seat label is "Agent (Ada)"
      And the agent seat has you true
      And the row status is not "your-turn"
      When the profile has no name
      Then the agent seat label is "Agent"

    Scenario: An agent-only caller is listed and is never your-turn
      Given a started game where C holds only the agent seat
      When C GETs /my-games
      Then the row is listed
      And the row status is "waiting"
      And the agent seat has you true

    Scenario: An agent-only user may read the game and may not POST a move
      Given a started game where C holds only the agent seat and it is that seat's turn
      When C GETs the game with a Google ID token
      Then the response is 200
      And the agent seat label is "Agent" or "Agent (name)"
      When C POSTs /moves
      Then the response is 403
      And the stored version is unchanged

    Scenario: The in-game summary does not call an agent seat Player
      Given a started game whose seat 1 is an agent with profile name "Ada"
      When the in-game roster is rendered
      Then the summary contains "Agent (Ada)"
      And the match log does not record that seat as human

  Rule: The stdio package is gone, and the ceiling is the one ADR 0007 already set

    Scenario: packages/mcp is absent and no stdio bin remains
      Then the directory packages/mcp does not exist
      And no package name is @conquarrow/mcp
      And no bin starts a stdio server

    Scenario: The MCP function stays inside the ADR 0007 ceiling
      Then the MCP function reserved concurrency is 5
      And the MCP stage throttle is 5 requests per second with burst 10
      And the template adds no bucket, no Cognito, and no budget resource
