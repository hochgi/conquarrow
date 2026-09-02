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
The persisted preference that lets the camera drive spectated turns. On by default. While on, manual pan and zoom are locked for the duration of the replay — not for the whole turn, so a slow BYOK seat's thinking time stays free.
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
Beam search over incomplete turn plans. The live local heuristic. playBotTurn calls this. Findings order which exits expand first; evaluate scores completed plans. A pass must beat the best stepped complete by more than IDLE_SLACK or the stepped plan wins. When the origin is still at home (no trail, every own group on own territory, no threatened departing exit) SORTIE_SLACK prefers an expedition over a home mill close — including after the first small close has painted past three arrows (playtest 2026-09-01). After P56 they leave; P57 aims the leave at a campaign target so a quiet-board dirt close does not beat walking to production. P59 further keeps only on-mission partial plans and reply-scores finalists only.
_Avoid_: minimax, opponent ply (that is P55)

**IDLE_SLACK**:
One MOBILITY_SCALE. beam-v1 will still pass when walking a lone tip onto trail is clearly worse; it will not pass when the first step off the home pinwheel is only slightly worse than sitting.
_Avoid_: never-pass (that is greedy-v1), a new evaluate term

**SORTIE_SLACK**:
One MOBILITY_SCALE. When the origin is still at home, beam-v1 prefers an expedition complete over a home mill close unless the mill wins — on homeboundScore, which strips own-territory × ARROW_VALUE_A — by more than this. Territory count is not the gate (P56). Playtest 2026-08-31 evening needed the leave; playtest 2026-09-01 showed the ≤3 cap dying after the first paint.
_Avoid_: zeroing tipTerm, a short-trail evaluate bonus, spawner-gravity, a second slack constant

**home mill close**:
A complete that never left home: no share gained, no group off own territory, trail empty again at the terminal. Walking one arrow out and landing so the loop paints is this, not an expedition. evaluate still likes it (+25 / arrow); the P56 swap is what declines it.
_Avoid_: land bridge (that is SPEC §7 and correct on an expedition), spawner mill (P54, hopping sibling open borders)

**expedition**:
A complete that left home: open trail still down at endTurn, or a group standing off own territory, or a share gained this plan. The thing SORTIE_SLACK prefers over a home mill close.
_Avoid_: sortie as a second idea (same fact; P53 used the word for the first step off a 3-arrow home)

**homeboundScore**:
Return-time comparison only: completeScore minus ARROW_VALUE_A times own territory. Lets SORTIE_SLACK stay sized for tipTerm after a paint. Not an evaluate term.
_Avoid_: retuning evaluate, subtracting shares

**campaign target**:
The one spawner vertex beam-v1 is walking toward this turn (P57). Recomputed from the board: highest force × missing-own-shares / grain-distance, skip monopolised vertices, ties on id. Not stored on GameState.
_Avoid_: spawner-gravity in evaluate, nearest-any-spawner, a stored multi-turn plan

**dirt close**:
A 0-share close that does not border the campaign target and does not reduce remaining path to it. On a quiet board (exposure 0) its closeValue is 0 (P57) unless it is staging (P59). Under fire it stays the P54 land-bridge.
_Avoid_: home mill close (that is still-at-home), land bridge (correct on a real expedition or under fire), staging close (that one is allowed)

**BotDrive**:
Named weights over shareLoot / arrowLoot / campaignPull / bankUnderFire. All 1 in P57. The hook P58 clones into personalities. Not a lobby control in this packet.
_Avoid_: difficulty picker, seat kind

**turn plan**:
An ordered list of moves for one seat, last move endTurn. The unit beam-v1 searches.
_Avoid_: burst (online Lambda), playback (P30 presents a plan)

**mobility**:
The evaluate term: for each group, sign by whether we own it, times heads, times how many distinct legal exits it has. The gradient that makes a box visible inside one turn.
_Avoid_: allowance, speed, trapped

**mission**:
The one job beam-v1 is allowed to spend this turn on (P59). One of bank, cut, contest, deny — computed at chooseTurn start from the board, not stored on GameState. Partial plans that do not serve a listed mission are not expanded.
_Avoid_: personality, BotDrive slider, a stored multi-turn plan

**bank**:
The mission when our trail is already down and exposure > 0. Close or get home. Contest waits.
_Avoid_: staging (that is optional paint toward V while not yet cuttable)

**cut**:
The mission when an enemy trail is grain-reachable this turn. Take the cut. Not an extra evaluate term.
_Avoid_: attack bonus, harass weight

**contest**:
The default quiet mission: take a share of the campaign target V, or move the border toward V.
_Avoid_: nearest any spawner, paint any empty loop

**deny**:
The mission when an enemy group is boxable this turn (P55 constructed box). Occupy the open exit.
_Avoid_: a new mobility coefficient

**staging close**:
A 0-share close that is a tool, not a goal: remaining path to V is strictly smaller after it, and the trail it leaves is not a threatened kite. Scored with the P54 rate (loot / T × survival, including arrows × A). No second staging constant.
_Avoid_: dirt close (sideways / pinwheel), home mill close

**remaining path**:
Grain distance from the nearest own group or own-territory arrow to a border arrow of campaign target V. Recomputed on origin and on each complete.
_Avoid_: approach_spawner d1 on one stack only

**kite**:
A contest plan whose close-back (or open trail still down) is at least KITE_RATIO times the outbound grain distance to V.
_Avoid_: expedition (that can be a short walk), land bridge

**kite length**:
Arrow count of the homeward / close_path from the far contest tip back onto *origin* territory — the against-grain return, not the outbound 3.
_Avoid_: turnsToClose as a second unit in the kite test (use arrows)

**threatened kite**:
A kite whose projected trail (outbound union close-back) is grain-reachable by some enemy group within DEFAULT_REPLY_DIST_CAP. Forbidden as the returned contest plan when a staging complete exists.
_Avoid_: exposure on the current empty trail (that is bank)

**KITE_RATIO**:
2. Named export. A 3-out / 9-back return is a kite. Do not invent a second ratio.
_Avoid_: a slack constant, retuning SORTIE_SLACK

**finalist**:
At most one best complete per mission slot (≤ 3). Only finalists run P55 worstReachableReply. Every other complete is scored with evaluate only.
_Avoid_: withReplies on every considerEnd child
