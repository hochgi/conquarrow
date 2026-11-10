# language: en
# Overview: docs/spec/remote-agent-mcp/remote-agent-mcp.md
# Packet P92, ADR 0009. Online adapter. No game rule.

Feature: A remote agent seat on an online match
  As a person at an IDE
  I want to join an online game as an agent and send the BYOK reply
  So that the browser updates and the server never calls a model

  Background:
    Given Google ID tokens verify against a fake verifier
    And the MCP door signs tokens with an injected signer and an injected clock
    And S3 is a fake store
    And PostToConnection is a probe

  Rule: One human and one agent can open a lobby

    Scenario: Create stores a lobby with one human and one agent
      Given a valid Google ID token for user A
      When A POSTs /invites with seats human, agent, heuristic
      Then the response is 201
      And seat 0 is human bound to A's userHash
      And seat 1 is agent and unbound
      And seat 2 is heuristic
      And fake S3 holds the invite and A's lobby pointer
      And fake S3 holds no group or game object

    Scenario: Browser accept binds the next human and does not take the agent chair
      Given an open invite with seats human bound to A, human unbound, agent unbound
      And a valid Google ID token for user B
      When B accepts the invite
      Then the response is 200
      And seat 1 is human bound to B's userHash
      And the agent seat is still unbound

    Scenario: MCP join binds the next agent, and the same user may hold both chairs
      Given an open invite with seats human bound to A, agent unbound, heuristic
      And an MCP access token for A's Google sub
      When A calls join with the invite handle
      Then the tool text is seatIndex 1, kind "agent", status "joined"
      And seat 0 is still human bound to A
      And seat 1 is agent bound to A's userHash
      And fake S3 holds A's lobby pointer for that token

    Scenario: A second join returns the seat already held
      Given an open invite whose agent seat 1 is bound to A and whose agent seat 2 is unbound
      And an MCP access token for A
      When A calls join again with the same handle
      Then the tool text is seatIndex 1, kind "agent", status "joined"
      And seat 2 is still unbound

  Rule: Start waits for every bindable seat

    Scenario: Start allocates a game whose groupHash is the humans only
      Given an open invite with seats human bound to A, agent bound to C, heuristic
      And a valid Google ID token for A
      When A POSTs start
      Then the response is 200
      And the body groupHash is truncate16 of SHA-256 of A's userHash alone
      And C's userHash is not in that preimage
      And fake S3 holds a group pointer for A and a group pointer for C at that groupHash
      And a later GET of the invite token is 410 reason "started"
      And that 410 includes the groupHash and the gameNumber

  Rule: The agent plays through the shared offer

    Scenario: observe on the agent's turn returns the shared offer text
      Given a started game whose active seat is C's agent seat
      And an MCP access token for C
      When C calls observe with the invite handle
      Then the tool text has stop false
      And the offer equals offerText of that state and C's seat from @conquarrow/byok-offer
      And the offer contains a numbered row and the reply instruction
      And the web user prompt for that state and seat, with no carried lock and no plan echo, is that same text

    Scenario: A legal prefix with endTurn false stays on the agent's turn
      Given it is C's agent turn and index 0 is a legal step
      And A has a WebSocket connection
      And C has a WebSocket connection
      When C calls move with moves [0], endTurn false
      Then the tool text has applied true, stop false, and the new offer
      And the stored version is one higher
      And the active seat is still C's agent seat
      And both A's connection and C's connection received stateChanged for that version
      And the log has an agentReply line for that version with moves [0] and endTurn false
      And that line has no invite token and no bearer

    Scenario: endTurn true ends the turn, bursts heuristics, and stops
      Given it is C's agent turn, the next seat is heuristic, and the seat after that is A's human seat
      And A has a WebSocket connection
      When C calls move with moves [] and endTurn true
      Then the tool text has applied true, stop true, and no offer
      And exactly one new version is stored
      And the active seat is A's human seat
      And the heuristic seat's moves are in that same version
      And no move in that version was applied for an agent seat by the chooser
      And A's connection received one stateChanged for that version

  Rule: The handshake is sessionless

    Scenario: initialize is answered and no session id is minted
      Given an MCP access token for A
      When A POSTs initialize to /conquarrow with protocolVersion "2026-07-28" and a Mcp-Session-Id header
      Then the response is 200
      And the result protocolVersion is "2026-07-28"
      And the response has no Mcp-Session-Id header
      And the body does not contain a session id
