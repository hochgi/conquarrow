# language: en
# Overview: docs/spec/online-edge-probes/online-edge-probes.md
# Packet P68. Characterises shipped behaviour of s3-store.ts / notify.ts.

Feature: Online edge probes — the production store and notifier at their real seams
  As the operator of the online API
  I want the S3 adapter and the WebSocket notifier executed against probed boundaries
  So that error mapping, conditional writes and pagination are tested, not assumed

  Background:
    Given a fresh rig
    And a probed S3 for bucket "match-bucket" whose default rule forwards to the backing
    And the real store is createS3Store("match-bucket", probed S3 adapter)

  Rule: Reads and writes round-trip through a real S3Client

    Scenario: A put is readable back as the same body
      When the real store puts key "conquarrow/k1" with body '{"a":1}'
      And the real store gets key "conquarrow/k1"
      Then the result is '{"a":1}'
      And the probe recorded one PutObjectCommand with Bucket "match-bucket", Key "conquarrow/k1" and ContentType "application/json"

    Scenario: A key never written reads as undefined
      When the real store gets key "conquarrow/missing"
      Then the result is undefined
      And the probe recorded one GetObjectCommand for "conquarrow/missing"

    Scenario: A deleted key reads as undefined
      Given the real store put key "conquarrow/k1" with body "x"
      When the real store deletes key "conquarrow/k1"
      And the real store gets key "conquarrow/k1"
      Then the result is undefined

  Rule: Conditional writes use real ETags

    Scenario: Create-only put on an absent key creates it
      When the real store puts key "conquarrow/k1" with body "first" and ifNoneMatch "*"
      Then the backing holds "first" at "conquarrow/k1"
      And the recorded PutObjectCommand carries IfNoneMatch "*"

    Scenario: Compare-and-swap with the current body writes and sends the read ETag
      Given the backing holds "v0" at "conquarrow/k1"
      When the real store puts key "conquarrow/k1" with body "v1" and ifMatch "v0"
      Then the backing holds "v1" at "conquarrow/k1"
      And a GetObjectCommand for "conquarrow/k1" was recorded before the PutObjectCommand
      And the PutObjectCommand carries IfMatch equal to the ETag that GetObject returned for "v0"

  Rule: Listing follows continuation tokens past the page cap

    Scenario: A prefix holding more than two pages lists every key, sorted
      Given the backing holds 2345 keys under "conquarrow/connections/u1/"
      And the backing holds 3 keys under "conquarrow/connections/u2/"
      When the real store lists prefix "conquarrow/connections/u1/"
      Then the result is exactly the 2345 keys under that prefix, sorted by compareStrings
      And the probe recorded 3 ListObjectsV2Command calls
      And the first carries no ContinuationToken
      And each later call carries the NextContinuationToken of the call before it

  Rule: Notify goes through a probed PostToConnection

    Scenario: A successful move notifies every connection of the other bound humans only
      Given the probed notifier answers 200 to every post
      And an api over the real store and the probed notifier
      And A and B have started a 3-seat game with seats human, human, heuristic
      And A has stored connection "conn-alice-1"
      And B has stored connections "conn-bob-1" and "conn-bob-2"
      When A posts endTurn with If-Match "0"
      Then the response is 200 with version 1
      And the probed notifier received exactly two posts, to "conn-bob-1" then "conn-bob-2"
      And each post's payload is stateChanged with version 1 and that game's groupHash and gameNumber
      And no post targeted "conn-alice-1"

  Rule: A handler flow runs end to end on the real store

    Scenario: Invite, accept, start, open and move persist through the S3 adapter
      Given the probed notifier answers 200 to every post
      And an api over the real store and the probed notifier
      When A creates an invite with seats human, human, heuristic
      And B accepts it
      And A starts it
      And A gets the game
      Then that response is 200 with version 0
      And the probe recorded a PutObjectCommand for the game's state.json carrying IfNoneMatch "*"
      When A posts endTurn with If-Match "0"
      Then that response is 200 with version 1
      And the probe recorded a PutObjectCommand for the game's state.json carrying an IfMatch ETag
      And the backing's state.json for the game parses to version 1
      And the backing's log.jsonl for the game is non-empty
      And B gets the game with version 1
