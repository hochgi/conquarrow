# language: en
# Overview: docs/spec/online-edge-probes/online-edge-probes.md
# Packet P68. Failure injection is by probe rule or intercept, never a new fake.

Feature: Online edge probes — error mapping, races and notify hygiene
  As the operator of the online API
  I want every S3 and WebSocket failure mode the adapters claim to handle exercised
  So that a 404, a 412, a lost page or a gone socket behaves as shipped

  Background:
    Given a fresh rig
    And a probed S3 for bucket "match-bucket" whose default rule forwards to the backing
    And the real store is createS3Store("match-bucket", probed S3 adapter)

  Rule: Not-found mapping on reads

    Scenario: A bare 404 that is not named NoSuchKey still reads as undefined
      Given the next GetObjectCommand is rejected with an S3 error named "NotFound" with status 404
      When the real store gets key "conquarrow/k1"
      Then the result is undefined

    Scenario: A read failure that is not a 404 propagates
      Given the backing holds "x" at "conquarrow/k1"
      And the next GetObjectCommand is rejected with an S3 error named "InternalError" with status 500
      When the real store gets key "conquarrow/k1"
      Then the call rejects with that same error

  Rule: Preconditions map to PreconditionFailed

    Scenario: Compare-and-swap on an absent key fails without a write
      When the real store puts key "conquarrow/k1" with body "v1" and ifMatch "v0"
      Then the call rejects with PreconditionFailed
      And no PutObjectCommand was recorded
      And the backing holds nothing at "conquarrow/k1"

    Scenario: Compare-and-swap with a stale body fails without a write
      Given the backing holds "v0" at "conquarrow/k1"
      When the real store puts key "conquarrow/k1" with body "v2" and ifMatch "stale"
      Then the call rejects with PreconditionFailed
      And no PutObjectCommand was recorded
      And the backing holds "v0" at "conquarrow/k1"

    Scenario: A write racing between the read and the conditional put loses with PreconditionFailed
      Given the backing holds "v0" at "conquarrow/k1"
      And the test intercepts the next PutObjectCommand for "conquarrow/k1"
      When the real store puts key "conquarrow/k1" with body "mine" and ifMatch "v0"
      And while that put is held another writer stores "theirs" at "conquarrow/k1"
      And the held put is forwarded to the backing
      Then the call rejects with PreconditionFailed
      And the backing holds "theirs" at "conquarrow/k1"

    Scenario: Create-only put on an existing key fails and leaves it unchanged
      Given the backing holds "first" at "conquarrow/k1"
      When the real store puts key "conquarrow/k1" with body "second" and ifNoneMatch "*"
      Then the call rejects with PreconditionFailed
      And the backing holds "first" at "conquarrow/k1"

    Scenario Outline: A rejected PutObject maps to PreconditionFailed by name or by status
      Given the next PutObjectCommand is rejected with an S3 error named "<name>" with status <status> ("none": no httpStatusCode in its $metadata)
      When the real store puts key "conquarrow/k1" with body "x"
      Then the call rejects with PreconditionFailed

      Examples:
        | name                       | status |
        | PreconditionFailed         | 412    |
        | ConditionalRequestConflict | 409    |
        | OtherConflict              | 409    |
        | OtherPrecondition          | 412    |
        | PreconditionFailed         | none   |
        | ConditionalRequestConflict | none   |

    Scenario: A PutObject failure that is neither 412 nor 409 propagates unmapped
      Given the next PutObjectCommand is rejected with an S3 error named "SlowDown" with status 503
      When the real store puts key "conquarrow/k1" with body "x"
      Then the call rejects with that same error
      And the error is not PreconditionFailed

  Rule: Listing boundaries

    Scenario: Exactly one full page is one call
      Given the backing holds 1000 keys under "conquarrow/p/"
      When the real store lists prefix "conquarrow/p/"
      Then the result is exactly those 1000 keys, sorted by compareStrings
      And the probe recorded 1 ListObjectsV2Command call

    Scenario: A page failure mid-listing propagates instead of returning a partial list
      Given the backing holds 1500 keys under "conquarrow/p/"
      And the first ListObjectsV2Command forwards and the second is rejected with an S3 error named "InternalError" with status 500
      When the real store lists prefix "conquarrow/p/"
      Then the call rejects with that same error

  Rule: Notify hygiene through the probed notifier

    Scenario: A gone connection is forgotten and a live one is kept
      Given an api over the real store and the probed notifier
      And A and B have started and opened a 3-seat game with seats human, human, human, with C bound
      And B has stored connection "conn-bob-1"
      And C has stored connection "conn-carol-1"
      And the probed notifier answers 410 to "conn-bob-1" and 200 to every other post
      When A posts endTurn with If-Match "0"
      Then the response is 200 with version 1
      And the backing holds nothing at B's connection key for "conn-bob-1" nor at the connection-id key for "conn-bob-1"
      And the backing still holds C's connection key for "conn-carol-1" and its connection-id key
      And the probed notifier received a post to "conn-carol-1"

    Scenario: A rejected post does not stop later notifies and keeps that connection
      Given an api over the real store and the probed notifier
      And A and B have started and opened a 3-seat game with seats human, human, human, with C bound
      And B has stored connection "conn-bob-1"
      And C has stored connection "conn-carol-1"
      And the probed notifier rejects the first post it receives and answers 200 to the second
      When A posts endTurn with If-Match "0"
      Then the response is 200 with version 1
      And the probed notifier received exactly two posts, one to "conn-bob-1" and one to "conn-carol-1"
      And the backing still holds both connections' keys, including the one whose post was rejected

    Scenario: Heuristic seats and the mover are never posted
      Given the probed notifier answers 200 to every post
      And an api over the real store and the probed notifier
      And A and B have started and opened a 3-seat game with seats human, human, heuristic
      And A has stored connection "conn-alice-1"
      And B has stored connection "conn-bob-1"
      When A posts endTurn with If-Match "0"
      Then the probed notifier received exactly one post, to "conn-bob-1"
      And no ListObjectsV2Command was recorded for A's connections prefix

    Scenario: With no notifier configured no connection prefix is listed
      Given an api over the real store with no PostToConnection
      And A and B have started and opened a 3-seat game with seats human, human, heuristic
      And B has stored connection "conn-bob-1"
      When A posts endTurn with If-Match "0"
      Then the response is 200 with version 1
      And no ListObjectsV2Command was recorded for any connections prefix

  Rule: Handler races on the real store

    Scenario: A racing state write between the move's read and its conditional put is a 412, not a 500
      Given the probed notifier answers 200 to every post
      And an api over the real store and the probed notifier
      And A and B have started and opened a 3-seat game with seats human, human, heuristic
      And B has stored connection "conn-bob-1"
      And the test intercepts the next PutObjectCommand for the game's state.json that carries IfMatch
      When A posts endTurn with If-Match "0"
      And while that put is held another writer stores a different body at the game's state.json
      And the held put is forwarded to the backing
      Then the response is 412
      And the backing's state.json for the game is the other writer's body
      And the probed notifier received no post
