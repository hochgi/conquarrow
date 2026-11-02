# P72 — Decision-API advisor on a BYOK seat

> **Status:** ready; re-gated on P79. **Depends on:** P15, P32, P79 (the gate).
> **Shape:** [ADR 0006](../../adr/0006-decision-api-advisor.md). **Evidence so far:**
> [research note](../../research/jev-byok.md): jev's top pick matched grok 59–70%
> (chance 11%). At 39 replayed human steps, grok matched the human 16/39 both
> plain and advised, and the advised seat copied jev's top pick 37/39. Those
> arms shared a prompt that never explained `force`. P75 and P80 have changed
> the offer since, so P72 is re-gated on the P79 harness instead of the 39
> human steps.
>
> **SPEC coverage:** none. No rule change. Adapter-only, in `packages/web`.
> `rules-core` and `contracts` do not change.

## Intent

A BYOK seat can optionally consult a **decision API** before each completion.
The **advisor** ranks the same legal-move offer the seat's model is about to
see. The prompt then shows each row's advisor probability, and the model still
chooses. The match log records what the advisor said, so advised and
unadvised play can be compared from logs.

The CONTEXT.md vocabulary is already in place: **decision API**, **System One
format**, **advisor**, **relay**.

## BSSN (locked)

### Configuration

- **Per seat, nested in the BYOK fields.** `SeatByokFields` and `ByokConfig`
  gain `advisor: AdvisorConfig`:

  ```ts
  interface AdvisorConfig {
    readonly enabled: boolean;   // the toggle
    readonly baseUrl: string;    // default 'https://api.typesafe.ai/v1'
    readonly apiKey: string;
    readonly model: string;      // default 'jev-latest'
  }
  ```

  It persists with the seat plan in this browser profile (`saveSeatPlan`),
  exactly like the seat's own key. An older save without `advisor` parses to
  the default, which is off.
- **The toggle never clears.** Turning advice off keeps base URL, key and
  model, so the same seat can play advised and unadvised.
- **Ready** means enabled, with non-empty base URL, key and model. An advisor
  that is not ready is simply off. It never blocks Start, because the seat
  plays without it.
- **Lobby.** The BYOK block of a local seat gains one checkbox, *"Advisor
  (decision API)"*. When checked it shows three fields: base URL, key
  (`type="password"`) and model. Online seats never show it, as with BYOK.
  The cogwheel `Settings.tsx` stays at its two controls (P48). The advisor
  belongs to a seat, not to the viewer.

### Wire: System One format

- `POST ${baseUrl}/systemone` (trailing slashes trimmed), with
  `Authorization: Bearer <advisor key>` and `Content-Type: application/json`.
- **One** choice question, engine order:

  ```json
  {
    "model": "<advisor model>",
    "state": "<teaching body>\n\n<user prompt up to, not including, the LEGAL_MOVES block>",
    "questions": {
      "move": {
        "type": "choice",
        "instructions": "You are advising seat <P> in Conquarrow. Which single legal step should seat <P> play next to make the most progress toward winning?",
        "criteria": { "m0": "<offer row 0 text>", "m1": "…", "…": "…" }
      }
    }
  }
  ```

  - Option names are `m<i>`, where `i` is the global offer index the seat's
    model sees. Insertion order is engine order.
  - Each description is that row's offer text, without its `[i]` prefix and
    without any advisor annotation.
  - The **state** is the same board the model sees, without the offer. It is
    built from the same `buildUserPrompt` output, so the two never diverge.
- **One question, not two orders averaged.** The ADR says one choice question,
  and the measurement agrees. At the 39 human steps the engine-order arm
  (19/39) beat the two-order average (16/39), and averaging did not cancel
  the last-row lean.
- **Reply.** `answers.move.probabilities` maps `m<i>` to a number, and the
  response's top-level `model` names the version that answered. The advisor's
  **top pick** is the argmax over the offer. Ties go to the lowest index, so
  the pick is deterministic given the reply. An option missing from the reply
  has probability 0.
- **The relay** is the BYOK relay, unchanged. Under `pnpm dev` the advisor
  POSTs to `/__byok` with the real URL in `X-Arrows-Byok-Upstream`, exactly as
  `postChatCompletions` does. `api.typesafe.ai` joins
  `BYOK_UPSTREAM_ALLOWLIST`. An explicit seat `proxyUrl` is used for the
  advisor too. On Pages it goes through the P71 Lambda relay once that ships.
  Until then, a direct call from Pages fails CORS, and the completion goes
  unadvised.

### Failure is silence

The advisor leaves a completion **unadvised** when any of these hold:

- the HTTP status is not 2xx, or the request throws or times out (**10 s**,
  `AbortSignal.timeout`, against jev's measured ~0.2 s p50);
- the body is not JSON, or has no `answers.move.probabilities` object;
- every probability is missing or non-finite;
- the offer has more than **255** rows (the System One choice cap). This is
  the one case where no call is made at all.

An unadvised completion sends the prompt exactly as an advisor-off seat would.
Nothing falls back to `greedy-v1` on the advisor's account, and no turn waits
on it beyond the timeout. The turn counts the failure (`advisorFailures`) and
keeps the last reason (`advisorLastError`, which never contains a key). Neither
is an advisor record.

### The annotation

On an advised completion, the prompt changes in two places:

1. The `LEGAL_MOVES …` header line is followed by one legend line:
   `advisor=p on a row is an independent decision model's probability that the row is the best next step. It is advice; you choose.`
2. Every offer row ends with ` advisor=<p>`, where `p` has two decimals
   (`toFixed(2)`).

Rows keep engine order and their `[i]` indices. Nothing is reordered, trimmed
or highlighted (ADR 0006: reordering confounds the measurement with the
decision model's position lean). An unadvised completion has neither the
legend nor the suffix.

This is the format the 2026-10-28 A/B used. That A/B found the advised seat
copied jev 37/39, so the gate reports the copy rate (below) whether or not it
passes.

### Advisor records and the summary line

- **One record per advised completion**, collected by `playLlmBotTurn` and
  returned on the turn:

  ```ts
  interface AdvisorRecord {
    readonly seat: PlayerId;
    /** Moves the seat had applied this seat-turn before this completion. */
    readonly turnMoveIndex: number;
    /** The versioned model that answered (the reply's `model`), else the configured one. */
    readonly model: string;
    readonly offerSize: number;
    readonly top: number;
    /** Engine order, one per offer row, rounded to 3 decimals. */
    readonly probabilities: readonly number[];
    /** The first index of the model's reply batch; null when the reply was unusable or empty. */
    readonly picked: number | null;
  }
  ```

  **Agreement** means `picked === top`. A record whose `picked` is null counts
  as advised but not agreed.
- **Match log.** `MatchLog` gains `advisorRecords?: readonly LoggedAdvisorRecord[]`.
  A logged record is `AdvisorRecord` plus `at`, the index into `moves` of the
  record's position: the moves logged before the seat-turn, plus
  `turnMoveIndex`. The field is present only when some record exists, so a
  log without advice is byte-identical to today's. Replay ignores it (P10).
  It carries no key and no prompt.
- **Summary line.** When the log has at least one advisor record,
  `formatMatchSummary`'s line gains a final part, `advisor agreed <a>/<n>`.
  `n` is the record count and `a` the agreed count. With no records the line
  is unchanged.

### Determinism and purity

The advisor is I/O at the edge, like the BYOK fetch. It takes the same
injected `FetchLike` as `playLlmBotTurn`, so tests drive it with a scripted
fetch. Argmax ties break on index, and records are built in completion order.
Nothing in `rules-core` or `contracts` changes. The heuristic seat, online
play and the teaching body do not change either.

## Out of scope

- The OpenAI Decisions wire format. It is parked by ADR 0006, but the base
  URL leaves room for it.
- Reordering, trimming or thresholding the offer by probability.
- A decision-only seat, or a prior inside the heuristic seat.
- The P71 Lambda relay itself.
- Any change to the JSON reply contract or to the teaching prose.

## Scenario inventory

- Advisor off: the request and prompt are byte-identical to today, no
  advisor call is made, and no records are kept.
- Advisor on: one `/systemone` POST per completion, made before that
  completion's chat call, with the documented body (`m<i>` options in engine
  order, the descriptions equal to the offer rows).
- An advised prompt has the legend line and ` advisor=0.xx` on every row,
  in engine order.
- The top pick is the argmax, and ties go to the lowest index.
- Each of the failure modes (non-2xx, throw, timeout, non-JSON, missing
  answer, all-non-finite) leaves that completion unadvised: the prompt is
  plain, there is no record, `advisorFailures` goes up by one, and the turn
  still plays.
- An offer of more than 255 rows makes no advisor call and is unadvised.
- A failed advisor call never causes a `greedy-v1` fallback.
- Toggle off with fields kept: the fields survive the plan's save/load, and
  no call is made.
- An older seat-plan save without `advisor` loads with advice off.
- Under the dev relay the advisor POSTs to `/__byok` with the upstream
  header. `api.typesafe.ai` passes `isAllowedByokUpstream`.
- `picked` is the first index of the reply batch, or null on an unusable
  reply.
- The match log gains `advisorRecords` with absolute `at` only when a record
  exists, and replaying such a log reproduces the same final state.
- The summary line ends `advisor agreed a/n` only when records exist.
- No advisor key appears in any record, log, error string or prompt.

## Gate

P72 ships only if it passes the P79 harness as an arm, measured over main.
The gate is predeclared in
[`docs/research/byok-benchmark.md`](../../research/byok-benchmark.md) before
any paid run. It uses gate plan A: the 12 targeted positions on `grok-4.7`,
plus the 6-cell proxy grid at K = 20 against the post-P81 proxy baseline. The
harness gains an advisor arm (`--advisor jev`, key from `JEV_API_KEY`, redacted
like the seat's key, jev spend metered separately). The arm also reports the
**copy rate**: advised completions whose model pick equals the advisor's top
pick.

## Definition of done

- [ ] `pnpm verify` green.
- [ ] Advisor off is byte-identical to main in request, prompt and log.
- [ ] No change under `packages/rules-core` or `packages/contracts`.
- [ ] The gate is predeclared, run and recorded, with the copy rate. **If it
      does not pass, P72 does not merge.** The packet is marked parked with
      the numbers, and the code goes to `parked/p72-decision-api-advisor`.
