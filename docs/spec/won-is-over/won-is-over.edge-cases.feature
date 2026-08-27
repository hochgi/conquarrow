Feature: A won match is over — the boundaries

  Background:
    Given a GameState, a GeometryPort and a RulesPort

  Rule: A record that runs past the win stops there

    Scenario: The reported playtest log is a P47 prefix golden
      Given the reported playtest log of 1247 moves
      When it is replayed
      Then the replay refuses at move 233
      And the refused move is E's step 3,-4,0 to 4,-4,0
      And the refused move is named
      And no winner is set on the playable prefix
      # P47 extra evaporation demotes that E trail onto F land; P28 then
      # withholds the recorded step. P38's 1242/1243 claims live on the
      # hand-authored won position, not on a fold that never reaches them.

    Scenario: The log folds cleanly when sliced at the first unplayable move
      Given the reported playtest log sliced at move 233
      When it is replayed
      Then it folds without refusal
      And no winner is set
      And a second fold of the same prefix is identical

    Scenario: The record still contains the historical 1242/1243 tail
      Given the reported playtest log
      Then move 1242 is a step
      And move 1243 is an end of turn
      And the four moves it records after 1242 remain on the fixture
      And the fold never reaches them
      # Fixture guard, not an engine claim. Those moves were accepted by an
      # engine that had not noticed the match was decided; P47 stops earlier.

  Rule: Refusal is total and says nothing about the board

    Scenario: A won state refuses a move that would be illegal anyway
      Given a state in which A is the winner
      And a step against the grain
      When it is applied
      Then it is refused for the match being over

    Scenario: A won state refuses a move that would have been legal
      Given a state in which A is the winner
      And a step that every rule but this one permits
      When it is applied
      Then it is refused for the match being over

    Scenario: Equal won states refuse equally
      Given two equal states in which A is the winner
      When the same move is applied to each
      Then both are refused with equal messages

    Scenario: A won state is cheaper to ask than a live one
      Given a state in which A is the winner
      When legal moves are asked for
      Then no arrow and no vertex is read
      # The gate is one `undefined` check on a field already in hand, before any
      # board read. Consistent with P37 invariant 16, which this does not disturb.

  Rule: A lost seat and a won match are different states

    Scenario: A lost seat is still offered the pass
      Given C is lost and no winner is set
      When legal moves are asked for on C's turn
      Then only an end of turn is offered
      # P37 invariant 4, unchanged. The round must still advance through C's slot.

    Scenario: The last loss and the win are the same move
      Given only A and C are not lost, and it is A's turn
      When A takes C's last territory
      Then C is lost in the state that step returns
      And the winner is A in that same state
      And the next move is refused

  Rule: The celebration waits for the effects that won the match

    Scenario: The board reads as playing while the deciding move animates
      Given A wins on a closure that fills ground and converts a stack
      When that step is applied
      Then the board is not dimmed
      And no banner is shown

    Scenario: The celebration begins once those overlays have finished
      Given A wins on a closure that fills ground and converts a stack
      When that step is applied
      And its overlays have finished
      Then the board is dimmed but for A
      And A's banner is shown

    Scenario: A dropped overlay brings the celebration forward, it cannot strand it
      Given A wins on a move whose overlays are dropped under queue pressure
      When the surviving overlays have finished
      Then the celebration has begun
      # The first draft of this scenario had the risk backwards. Losing an overlay
      # makes queue-empty fire *earlier*, and `pruneQueue` drops every item on its
      # own lifetime, so nothing outlives itself. The only way the queue stays
      # non-empty is new overlays arriving, and after the win nothing can enqueue —
      # this packet's own rules half refuses every move. Queue-empty is
      # self-bounding.

    Scenario: The ceiling is never shorter than the move it waits for
      Given A wins on a closure that fills ground and converts a stack
      Then the deciding move's overlays settle at 1200ms
      And the ceiling is not less than that
      # Measured. `captureFresh` is offset 500 with a duration of 700. A ceiling of
      # MAJOR_SEQUENCE_MS — 700 — would fire on top of it, 500ms early, which is a
      # smaller copy of the bug this packet exists to fix. `timing.ts` claims the
      # biggest sequence fits inside MAJOR_SEQUENCE_MS; it does not.

    Scenario: The celebration begins once and does not restart
      Given A has won and the celebration has begun
      When the board re-renders
      Then the celebration does not begin again

    Scenario: The wait does not unlock input
      Given A wins and the deciding move's overlays are still playing
      Then input is locked
      And the lock is read from the winner, not from the celebration
      # `Hud.tsx` computes `controlsLocked(victory)`, which is `fx.kind === 'over'`.
      # So while the celebration reads *playing* during the wait, the board would
      # unlock for the length of the winning move's animation. This packet has to
      # rewire that lock to read `winner` before it can make the celebration wait at
      # all — the two changes are one change.
