# P48 — Spectated-turn camera

**Layer:** web adapter only. No `contracts` or `rules-core` change. No game rule
is touched, invented, or implied.

## Problem

When the local player ends their turn, AI seats resolve their turns faster than
a human can follow. `applyMovesSequentially` replays a heuristic turn at
`BOT_PLAYBACK_GAP_MS = 400` per move with a static camera, so the moves land
wherever the player happens to be looking — usually nowhere near the action.
Panning manually during that window is possible but futile: by the time you have
found the action, the turn is over. BYOK seats are less bad only because they are
slow, which is not a design.

## What ships

A camera that performs a **spectated turn** — a turn already decided elsewhere,
replayed move-by-move by this client.

### Trigger

`spectating = the seat to move is not driven by whoever is at this keyboard`.

- Local match: any `heuristic` or `byok` seat (`seatPlan.ts`).
- Hot-seat `human` seats are **never** spectated, including the ones that are not
  "you". Two humans at one screen are one pair of eyes.
- Online: **out of scope**, see P49. The predicate is written so that adding
  `seat.userHash !== ownUserHash` later is a one-line extension.
- Tutorial: **off entirely**. The tutorial owns its camera deliberately
  (`lookAtLesson`, the expect-step pan, the demo loop in `App.tsx`) and two
  policies would fight.
- All-bot match: **on**. Every turn is spectated; this is the showcase case.

### Choreography

The turn is decided in full before any of this begins — that is already how
`planLocalAiTurn` works. The camera never watches a decision, only a replay.

Per **hop**:

1. Ease out to a viewport fitting `{arrows of the previous beat} ∪ {arrows of the
   move about to play}`. For the first hop of a replay window the previous beat
   is the player's saved camera centre, so their own position stays in frame.
2. Ease in to frame the upcoming move.
3. Hold.
4. Apply the move.

There is **no full-board fit beat.** It was considered and dropped: if every hop
bridges two known places, the orientation a board fit buys is already paid for,
and it costs a long dolly per turn.

`skip` moves get no hop — moving the camera to show nothing happening is the
worst available use of the effect. `endTurn` gets no hop; it is the cue to
restore.

**Cap.** If the two-point fit would exceed 24 lattice units of radius (a seat has
fled the field), hard-cut instead of dollying. The fit never zooms out past
`ZOOM.min = 24`.

### Sequential opponents

In a 3- or 6-player match several spectated turns run back to back. The restore
happens only when control returns to this client, never between opponents. The
hop from seat A's last move to seat B's first move is an ordinary two-point fit,
with a longer hold at the seat boundary so a seat change reads as one. No new
chrome — the HUD already names the active seat.

The wait for seat B's decision (a BYOK seat may think for tens of seconds)
happens parked at seat A's last move, **outside** the replay window, so the
camera is free during it.

### Input lock

While auto-focus is on, manual pan/zoom is locked **for the replay window only**
— first hop to restore. It is explicitly *not* locked while a seat is deciding.
Locking a BYOK seat's 30-second think would be strictly worse than today's
behaviour.

The escape hatch is the toggle: turning auto-focus off releases the camera and
restores today's free pan/zoom. A yield-on-gesture model (manual input hands the
camera back for the current turn) was considered and deferred — it is ambiguous
under touch, where a pinch during a tween is hard to tell from tween jitter.
Revisit after play-testing.

**Pause** (`botPause.ts`): an in-flight tween finishes and holds; the lock
stays. Pause exists to stop BYOK credit burn on an unattended match, not to
free the camera — that is what the toggle is for.

### Restore

When control returns to this client:

- Restore the saved camera **exactly**, and nudge only if the target stack is
  off-screen — mirroring the existing post-move policy in App's auto-pick block,
  whose comment ("a camera that jumps after every move destroys the spatial
  orientation the capture effect depends on") remains correct for your own play.
- The saved camera is the camera **as it stands when the replay window opens**,
  not as it stood when your turn ended — so panning during a seat's thinking
  time is respected.
- One saved camera per client, not per seat. Hot-seat humans share a screen.

**Target stack**, in order:

1. Turn ended by End Turn: the stack selected at the moment of the click.
   Note `commitApplied` clears selection (`setSnap(mode.reset())`),
   so this must be captured immediately *before* the commit, not read back after.
2. Turn ended by move exhaustion (`passIfExhausted`): there is
   no selection at that point — the previous commit already cleared it. Use the
   `exit` arrow of the final step.
3. That stack is gone (killed or converted): walk back through this turn's
   earlier `exit` arrows and take the first still owned.
4. None survived but the player has units (a fresh spawn): pick one, sorted by
   `ArrowId`, first. Arbitrary to the player, reproducible to the code — iteration
   order over a `Set` or `Map` here would be a defect, not a style choice.
5. No units at all: saved camera only, no target.

### Settings

A new cogwheel panel, containing exactly two controls, persisted under one
`conquarrow:prefs` localStorage key:

- **Auto-focus** toggle, default on.
- **Opponent playback speed**, 0.5×–3×, default 1×. Scales the camera tweens, the
  hold, and `BOT_PLAYBACK_GAP_MS` together.

Bot-pause **stays on the HUD**. It is an in-the-moment action, not a preference;
behind a gear it is useless.

`fx/timing.ts` budgets are **not** scaled. Watch for capture effects trailing the
camera at 3×; if they do, that is a follow-up, not a surprise.

### Reduced motion

`prefers-reduced-motion` hard-cuts instead of tweening. The camera still takes
you to the action; it just does not fly you there. Disabling the feature outright
would deny the orientation benefit to exactly the people who most need it.

### Starting numbers

Ease-out 260 ms, ease-in 300 ms, hold 150 ms, seat-boundary hold 400 ms, move gap
unchanged at 400 ms, all scaled by the speed multiplier. Fit cap 24 lattice
units. Every one of these is expected to move after the first play-test; that is
what the slider is for.

## Shape

Follow the `botPause.ts` precedent exactly: a pure predicate/geometry module,
with App owning the clock.

- `packages/web/src/spectate.ts` — pure. `isSpectatedSeat`, `fitViewport(bounds,
  cap)`, `hopTargets(prev, next)`, `restoreTarget(saved, stackArrow, viewport)`,
  the fallback chain, the `ArrowId` tie-break. Fully testable.
- A tween runner in App (or a `useCameraTween` hook) owning `rAF` — trivial
  interpolation, thin enough not to need tests.
- `arrowCentroid` (`App.tsx`) needs exporting; it is currently a local const and is the shared primitive here.

## Explicitly out of scope

- Online spectated turns → **P49**.
- Auto-select at turn start (selection is cleared at every transition and only
  re-seeds after your first move). A genuinely nice small change that affects
  hot-seat and solo play too, so it does not belong smuggled in here.
- A yield-on-gesture camera handover.
- Scaling FX budgets with playback speed.

## Note on line references

This packet originally cited `App.tsx` line ranges; they had already drifted by
the time it was implemented. Symbol names are cited instead — they survive a
rebase, line numbers do not.
