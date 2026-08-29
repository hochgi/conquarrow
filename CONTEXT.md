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

**hop**:
One camera beat within a replay window: ease out far enough to fit the arrows of the move just played together with those of the move about to play, ease in on the latter, hold, then apply the move. Never a full-board fit.
_Avoid_: pan, cut, fly-to

**restore**:
Returning the camera when control comes back to this client: the camera as the player last left it, nudged only if their last-selected stack is off-screen.
_Avoid_: reset, recenter
