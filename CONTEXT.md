# conquarrow

Adapter and seating language that is not a game rule. Core rules vocabulary stays in `AGENTS.md`.

## Language

**heuristic**:
A seat whose moves are chosen by the deterministic adapter. Online library rows label this seat "AI".
_Avoid_: LLM, BYOK, bot

**BYOK**:
A seat whose moves are chosen by a model using credentials pasted in that browser: base URL, API key, and model id. Each browser profile is configured separately. The key is not a server secret.
_Avoid_: hosted LLM, operator keyring, household key (there is no shared provision)

**hosted LLM**:
A seat whose moves are chosen by a model using a key the operator holds on the server. Parked. Only if Pages-direct BYOK cannot reach CORS-ok hosts do we add a Lambda pump, and then only the operator may create those chairs.
_Avoid_: BYOK, AI (that label is heuristic)

**provider**:
The model vendor named by a BYOK base URL (for example x.ai). Many vendors share the OpenAI chat/completions shape.
_Avoid_: platform, treating each vendor as a new API shape

**model**:
The provider-specific model id pasted with the BYOK key. Seat configuration, not a secret.
_Avoid_: LLM (that is the seat kind)

**operator**:
The personal-account owner (AWS + Pages). Not a key distributor: every device that wants an LLM chair pastes credentials locally.
_Avoid_: admin, host (host is GIS Sign-In chrome)

**operator keyring**:
Parked. A server-side bundle of provider keys, used only if a Lambda LLM pump is ever built.
_Avoid_: the API key, BYOK config

**match log**:
The ordered moves of one match, plus setup. Replaying it reconstructs every position. It does not contain keys or prompts.
_Avoid_: save file, replay file

**gateway**:
A provider that sells many companies' models through one key, almost always on the OpenAI chat/completions shape (OpenRouter, Zenmux, Groq, NVIDIA, Cloudflare, Bedrock Mantle). It is a keyring row, not a new HTTP dialect.
_Avoid_: treating each gateway as its own API shape

**API shape**:
The HTTP dialect used to ask a model for a legalMoves index. v1 is OpenAI chat/completions only. A small port stays in code so Anthropic Messages or Gemini can be added later without a rewrite. Seats still take turns.
_Avoid_: adapter per company, talk (ambiguous)

**pause**:
An operator control that stops bot LLM decisions until resumed. It does not block a human from playing when it is a human chair's turn.
_Avoid_: freeze, stop (ambiguous with match end)

**idle pause**:
On an all-bot match, LLM decisions run only while the watching tab is focused. Leaving focus is the auto-pause. Matches with a human chair stop naturally when that human must act.
_Avoid_: logout, AFK timer

**creator**:
The signed-in Google user who `POST /invites`. They occupy one human seat. The operator and the creator are the same person today; they stay different roles if hosted LLM is ever unparked.
_Avoid_: host, owner

**spectated turn**:
A turn already decided elsewhere that this client replays move-by-move: a heuristic or BYOK seat locally, and (once P49 lands) a remote human online. The predicate is not "enemy" — it is "not driven by whoever is at this keyboard". Hot-seat humans are never spectated.
_Avoid_: enemy turn, opponent turn, AI turn (hot-seat opponents are none of these, and remote humans are all three)

**auto-focus**:
The persisted preference that lets the camera drive spectated turns. On by default. While on, manual pan and zoom are locked for the duration of a replay — not for the whole turn, so a slow BYOK seat's thinking time stays free.
_Avoid_: camera lock, cinematic mode, follow cam

**replay window**:
The span of a spectated turn from the first camera hop to the restore. Distinct from the turn: the decision that precedes it is not part of it, and neither is the wait for the next seat's moves.
_Avoid_: turn, playback (playback is the move cadence, which continues while the camera yields)

**camera group**:
A maximal run of consecutive moves by one seat, within one turn, that the camera frames in a single shot. One camera movement per group; none inside one. Grouping never spans a seat or a turn.
_Avoid_: hop (superseded by P52), batch (that is a replay window's arrival unit), cluster (groups are contiguous in play order, never re-ordered)

**safe box**:
The fraction of the viewport a camera group's moves must fit inside — every arrow of every member, source and exit — for the group to be framed as one shot.
_Avoid_: viewport, frame, bounds

**restore**:
Returning the camera when control comes back to this client: the camera as the player last left it, nudged only if their last-selected stack is off-screen.
_Avoid_: reset, recenter

**stride**:
Moving one group the whole distance its size allows in a turn — a 2-stack taking two arrows, a 4-stack taking three. The stack bonus of SPEC §3 spent as intended.
_Avoid_: sprint, dash, full move (a group can stride a shortened distance and still be striding)

**shuttle**:
The defect where a group splits and walks its parts one arrow onto the same destination, re-merging there. Spends every step it owns to advance one arrow. Named because a bot did it in half of all turns before it could see stride.
_Avoid_: conveyor (that is the priced, deliberate manoeuvre of SPEC §3), split, leapfrog

**box**:
Denying a group every legal exit, so no step it could take is allowed. Not a rule of its own — the standing consequence of territory-illegal steps and a lone head being unable to attack. A boxed group is immobile until something around it changes, and can be closed around and converted.
_Avoid_: trap, pin, stranded (a stranded group still has somewhere to go)

**chooseTurn**:
The adapter function that returns one seat's full turn as an ordered list of moves ending in endTurn. greedy-v1 and beam-v1 are the two implementations. Not a contracts port.
_Avoid_: strategy registry, difficulty picker, AI port

**greedy-v1**:
The frozen per-step chooser loop — today's chooseMove until the seat is handed back. Baseline for head-to-head. Still short-circuits on findings. Still never passes while a step is legal.
_Avoid_: the live local heuristic (that is beam-v1)

**beam-v1**:
Beam search over incomplete turn plans. The live local heuristic. playBotTurn calls this. Findings order which exits expand first; evaluate scores completed plans. A pass must beat the best stepped complete by more than IDLE_SLACK or the stepped plan wins (playtest 2026-08-31: pinwheel freeze).
_Avoid_: minimax, opponent ply (that is P55)

**IDLE_SLACK**:
Sixteen evaluate points. beam-v1 will still pass when walking a lone tip onto trail is clearly worse; it will not pass when the first step off the home pinwheel is only slightly worse than sitting.
_Avoid_: never-pass (that is greedy-v1), a new evaluate term

**turn plan**:
An ordered list of moves for one seat, last move endTurn. The unit beam-v1 searches.
_Avoid_: burst (online Lambda), playback (P30 presents a plan)

**mobility**:
The evaluate term: for each group, sign by whether we own it, times heads, times how many distinct legal exits it has. The gradient that makes a box visible inside one turn.
_Avoid_: allowance, speed, trapped
