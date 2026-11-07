# P90 — Resume a local match after back, refresh or a frozen tab

> **Status:** in progress. **Kind:** web adapter (UX). **Depends on:** P10
> (match log), P48 (prefs seam).
>
> **Evidence:** [playtest 2026-11-06](../../research/playtest-2026-11-06/FINDINGS.md),
> finding 3: an edge swipe on a phone navigated back and the match was lost;
> earlier, a frozen tab lost a 580-move log that held a hang worth
> reproducing.
>
> **SPEC coverage:** none. No game rule is touched; resuming replays the
> logged moves through `rules.apply`.

## What exists

- `record` (`packages/web/src/App.tsx`) already calls `saveMatchLog` after
  every applied move, to `conquarrow:last-match`, in **every** mode: local,
  tutorial and online all overwrite it.
- `loadLastMatchLog` (`src/matchLog.ts`) reads it back, but only tests call
  it. Nothing in the UI resumes or downloads a saved match.
- The strict move parser is `parseMove` in `bench/src/moves.ts`.
- There is no router, no `pushState`/`popstate` and no `beforeunload`.
  Screens are React state; online play uses hash routes (`src/online-hash.ts`).

## Decisions (BSSN, recorded here)

1. **A separate resume save.** Key `conquarrow:resume`, holding the same
   `MatchLog` JSON. It is written after every applied move of a **local**
   match only: not the tutorial, not online play, not a spectated or replayed
   board. `conquarrow:last-match` keeps its current behaviour.
2. **Which matches resume.** Only matches whose logged seats are all `human`
   or `heuristic`. A match with a `byok` seat is still saved (so it can be
   downloaded) but is not offered for resume: the API key is not in the log,
   and rebuilding a BYOK seat is out of scope.
3. **A finished match is not resumable.** When the log has a `winner`, the
   resume save is deleted.
4. **Starting a new match replaces the save.** `startMatch` writes the new
   match's empty log over it. Pressing Lobby does **not** delete it: Lobby
   pressed by mistake is one of the cases this packet fixes.
5. **The lobby shows the save.** When a resume save exists and parses, the
   lobby shows a **Resume** button with a one-line description (seats, round,
   move count) and a **Download saved log** button. Download is there even
   when resume is not offered (decision 2), and it is how a frozen game's log
   is recovered: reload the page, open the lobby, download.
6. **Resume replays.** `makeMatch(log.config)`, then `rules.apply` for each
   logged move, in order. The seat plan is rebuilt from `log.seats`. The
   restored match keeps the original log (same `startedAt`, moves and seats),
   and play continues as if never interrupted: if the side to move is a
   heuristic seat, its turn runs as usual.
7. **A save that does not replay is discarded, loudly.** If the JSON does not
   parse, a move does not parse, or `rules.apply` refuses a move, Resume shows
   a one-line error, keeps **Download saved log** available, and does not
   start a match. It never resumes a prefix silently.
8. **Pure helpers, thin wiring.** The parse, the replay and the "should this
   mode autosave" decision are pure functions in `src`, tested in node. The
   storage access goes through a small backing like
   `tutorial/storage.ts`'s `StorageBacking`, so tests drive it with memory.
   `parseMove` and `serializeMove` move from `bench/src/moves.ts` to `src`,
   and the bench imports them from there.
9. **Ask before leaving a match in progress.**
   - **Back:** when a local match starts or resumes, push one history entry.
     On `popstate` while a local match is in progress (no winner), ask with
     `window.confirm("Leave this game? It is saved; Resume it from the
     lobby.")`. Cancel pushes the entry again and stays. OK returns to the
     lobby. Hash routes for online play are untouched.
   - **Refresh / close:** a `beforeunload` handler while a local match is in
     progress. Mobile browsers honour it unevenly; the save is the real guard.

## Scenarios

- A local match with heuristic seats autosaves after each move; reloading
  the app offers Resume, and Resume restores the same state (same groups,
  trails, territory, active player, round) and the same log.
- Resume when a heuristic seat is to move: its turn runs.
- A tutorial lesson, an online game and a spectated board do not write the
  resume save.
- A match with a `byok` seat: the lobby offers Download saved log but not
  Resume.
- A finished match: no resume save remains.
- A corrupt save (bad JSON, a bad move, or a move `rules.apply` refuses):
  Resume shows an error, starts nothing, and Download saved log still works.
- Starting a new match replaces the save; pressing Lobby keeps it.
- Back during a local match asks; Cancel stays in the match; OK goes to the
  lobby with the save intact.

## Acceptance

- Pure tests for the parse, the replay, the autosave decision and the
  storage backing (node environment; the web package has no jsdom).
- A round-trip test over the committed playtest logs
  (`docs/research/playtest-2026-11-06/match-log.json` and the fixtures in
  `packages/web/test/fixtures/`): serialize → parse → replay gives the same
  final state as a direct replay.
- `pnpm verify` green; checked by the human on a phone after merge.
