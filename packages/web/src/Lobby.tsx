import { useState, type ReactElement } from 'react';
import type {
  InviteSeat,
  LibraryList,
  MyGamesBody,
  PagesLobbyMode,
  PlannedSeatKind,
  StartedGameRow,
} from '@conquarrow/contracts';
import { DELETE_GAME_CONFIRM, GAME_NAME_MAX } from '@conquarrow/contracts';
import { styleFor } from './colors';
import { testByokConnection } from './byokBot';
import { DEFAULT_BYOK, isByokReady } from './byokConfig';
import {
  CREATING_INVITE_COPY,
  GAME_DELETED_COPY,
  formatLibraryRow,
  librarySections,
  libraryRowTitle,
  libraryTurnLine,
  libraryWinnerLine,
  type LibrarySectionView,
  chooserSlotOffered,
  formatLibraryStartedAt,
  libraryOffered,
  libraryRowTint,
  MY_GAMES_COPY,
  NO_GAMES_COPY,
  lobbyKindOptions,
  rosterOccupancy,
  rosterOccupancyLabel,
} from './online-shell-ui';
import {
  PLAYTEST_PLAYER_COUNTS,
  byokConfigForSeat,
  onlineSeatKindAllowed,
  resizeSeatPlan,
  seatPlanReady,
  seatPlayerId,
  updateSeat,
  type PlaytestPlayerCount,
  type SeatKind,
  type SeatPlan,
} from './seatPlan';

export interface LobbyOnline {
  readonly offered: boolean;
  readonly mode: PagesLobbyMode;
  readonly onMode: (mode: PagesLobbyMode) => void;
  readonly signedIn: boolean;
  readonly onSignIn: () => void;
  readonly onSignOut: () => void;
  readonly createOffered: boolean;
  readonly createInvitePending: boolean;
  readonly onCreate: () => void;
  readonly acceptOffered: boolean;
  readonly onAccept: () => void;
  readonly copiedUrl: string | undefined;
  readonly startOffered: boolean;
  readonly inviteGone: boolean;
  readonly goneReason: 'revoked' | 'started' | 'deleted' | undefined;
  readonly lobbyFull: boolean;
  /** P96 D11: the sectioned library, and the hidden rows loaded so far. */
  readonly library: MyGamesBody | undefined;
  readonly hiddenGames: readonly StartedGameRow[];
  readonly onOpenGame: (groupHash: string, gameNumber: string) => void;
  readonly onLoadMore: (list: LibraryList) => void;
  readonly onRename: (groupHash: string, gameNumber: string, name: string) => Promise<boolean>;
  readonly onDelete: (groupHash: string, gameNumber: string) => void;
  readonly onHide: (groupHash: string, gameNumber: string, hidden: boolean) => void;
  /** P96 D6: the optional name the next invite is created with. */
  readonly inviteName: string;
  readonly onInviteName: (name: string) => void;
  readonly inviteNameValid: boolean;
  /** P96 D12: the game the link named was deleted. */
  readonly gameDeleted: boolean;
  readonly seatKinds: readonly PlannedSeatKind[];
  readonly seatEditsOffered: boolean;
  readonly inviteSeats: readonly InviteSeat[] | undefined;
  readonly userHash: string | undefined;
}

export interface LobbyResume {
  readonly description?: string;
  readonly error?: string;
  readonly onResume?: () => void;
  readonly onDownload: () => void;
}

export interface LobbyProps {
  readonly plan: SeatPlan;
  readonly onPlan: (next: SeatPlan) => void;
  readonly onStart: () => void;
  readonly online?: LobbyOnline;
  /** Starts L0. Omitted only in tests that do not host a walkthrough. */
  readonly onLearn?: () => void;
  readonly learnCardVisible?: boolean;
  readonly onDismissLearnCard?: () => void;
  /** A local save waiting in the lobby. Omitted when there is nothing stored. */
  readonly resume?: LobbyResume;
}

const PLACEMENT_BLURB: Record<PlaytestPlayerCount, string> = {
  3: 'Every alternating corner — order-3 rotational symmetry (fair grain)',
  6: 'All six corners — full hexagon of homes',
};



const ResumeSave = ({ resume }: { readonly resume: LobbyResume }): ReactElement => (
  <div className="lobby-resume">
    <div className="lobby-byok-actions">
      {resume.onResume === undefined ? null : (
        <button type="button" className="lobby-start" onClick={resume.onResume}>
          Resume
        </button>
      )}
      <button type="button" className="lobby-byok-test" onClick={resume.onDownload}>
        Download saved log
      </button>
    </div>
    {resume.description === undefined ? null : (
      <p className="lobby-byok-note">{resume.description}</p>
    )}
    {resume.error === undefined ? null : <p className="lobby-byok-warn">{resume.error}</p>}
  </div>
);

export const Lobby = ({
  plan,
  onPlan,
  onStart,
  online,
  onLearn,
  learnCardVisible,
  onDismissLearnCard,
  resume,
}: LobbyProps): ReactElement => {
  const incomplete = !seatPlanReady(plan);
  const onlineMode = online?.offered === true && online.mode === 'online';
  const startDisabled = onlineMode ? !online.startOffered : incomplete;
  const frozen = onlineMode && !online.seatEditsOffered;
  const rosterSeats = frozen ? online.inviteSeats : undefined;
  const optionsForSeat = (
    index: number,
  ): readonly { readonly value: SeatKind; readonly label: string }[] => {
    const offered = lobbyKindOptions(onlineMode ? 'online' : 'local', index);
    if (!onlineMode) return offered;
    return offered.filter((opt) => online.seatKinds.includes(opt.value));
  };
  const [probeSeat, setProbeSeat] = useState<number | undefined>(undefined);
  const [probeMsg, setProbeMsg] = useState<string | undefined>(undefined);
  const [probeOk, setProbeOk] = useState<boolean | undefined>(undefined);
  const [probeShownOn, setProbeShownOn] = useState<number | undefined>(undefined);

  const runProbe = (index: number): void => {
    const seat = plan.seats[index];
    if (seat === undefined || seat.kind !== 'byok') return;
    const config = byokConfigForSeat(seat);
    if (!isByokReady(config) || probeSeat !== undefined) return;
    setProbeSeat(index);
    setProbeShownOn(index);
    setProbeMsg(`Testing seat ${PLAYER_LABEL(index)}…`);
    setProbeOk(undefined);
    void (async () => {
      const result = await testByokConnection(config);
      setProbeSeat(undefined);
      if (result.ok) {
        setProbeOk(true);
        setProbeMsg(`Connected · ${result.sample}`);
      } else {
        setProbeOk(false);
        setProbeMsg(result.reason);
      }
    })();
  };

  return (
    <div className="lobby">
      <div className="lobby-card lobby-card-wide">
        <h1>Conquarrow</h1>
        <p className="lobby-lead">Playtest match on the arrow tiling</p>
        {online?.offered === true ? (
          <OnlineChrome online={online} {...(onLearn === undefined ? {} : { onLearn })} />
        ) : onLearn === undefined ? null : (
          <button type="button" className="lobby-start" onClick={onLearn}>
            Learn
          </button>
        )}
        {learnCardVisible === true && onLearn !== undefined ? (
          <div className="lobby-learn-card">
            <p className="lobby-lead">
              Eight short lessons on the real board — grain, trail, closure, cuts, combat,
              encirclement, spawners, and winning.
            </p>
            <div className="lobby-online-row">
              <button type="button" className="lobby-start" onClick={onLearn}>
                Start walkthrough
              </button>
              {onDismissLearnCard === undefined ? null : (
                <button type="button" className="lobby-byok-test" onClick={onDismissLearnCard}>
                  Dismiss
                </button>
              )}
            </div>
          </div>
        ) : null}

        <label className="lobby-count">
          Players (3 or 6 — rotationally fair)
          <select
            value={plan.playerCount}
            disabled={frozen}
            onChange={(e) => {
              const n = Number(e.target.value) as PlaytestPlayerCount;
              onPlan(resizeSeatPlan(plan, n));
              setProbeMsg(undefined);
              setProbeOk(undefined);
            }}
          >
            {PLAYTEST_PLAYER_COUNTS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>

        <p className="lobby-blurb">{PLACEMENT_BLURB[plan.playerCount]}</p>

        <fieldset className="lobby-seats">
          <legend>
            {frozen
              ? 'Seats — Player, AI, waiting, or you'
              : onlineMode
                ? 'Seats — Player, AI, or Agent'
                : 'Seats — each can be Player or AI'}
          </legend>
          {rosterSeats !== undefined ? (
            <FrozenRoster seats={rosterSeats} userHash={online?.userHash} />
          ) : (
            plan.seats.map((seat, index) => {
            const player = seatPlayerId(index);
            const color = styleFor(player).fill;
            const byokIncomplete = seat.kind === 'byok' && !isByokReady(byokConfigForSeat(seat));
            return (
              <div key={String(player)} className="lobby-seat">
                <div className="lobby-seat-head">
                  <span className="lobby-seat-swatch" style={{ background: color }} />
                  <strong style={{ color }}>{styleFor(player).label}</strong>
                  <select
                    value={seat.kind}
                    aria-label={`${styleFor(player).label} driver`}
                    disabled={frozen}
                    onChange={(e) => {
                      const kind = e.target.value as SeatKind;
                      if (onlineMode && !onlineSeatKindAllowed(plan, index, kind)) {
                        return;
                      }
                      onPlan(updateSeat(plan, index, { kind }));
                      setProbeMsg(undefined);
                      setProbeOk(undefined);
                    }}
                  >
                    {optionsForSeat(index).map((opt) => (
                      <option
                        key={opt.value}
                        value={opt.value}
                        disabled={
                          onlineMode &&
                          opt.value === 'heuristic' &&
                          seat.kind === 'human' &&
                          !onlineSeatKindAllowed(plan, index, 'heuristic')
                        }
                      >
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                {seat.kind === 'byok' && !onlineMode ? (
                  <div className="lobby-seat-byok">
                    <label className="lobby-count">
                      Base URL
                      <input
                        type="url"
                        autoComplete="off"
                        spellCheck={false}
                        value={seat.byok.baseUrl}
                        placeholder={DEFAULT_BYOK.baseUrl}
                        onChange={(e) => {
                          onPlan(
                            updateSeat(plan, index, {
                              byok: { ...seat.byok, baseUrl: e.target.value },
                            }),
                          );
                          setProbeMsg(undefined);
                          setProbeOk(undefined);
                        }}
                      />
                    </label>
                    <label className="lobby-count">
                      API key
                      <input
                        type="password"
                        autoComplete="off"
                        spellCheck={false}
                        value={seat.byok.apiKey}
                        placeholder="sk-… (this browser only)"
                        onChange={(e) => {
                          onPlan(
                            updateSeat(plan, index, {
                              byok: { ...seat.byok, apiKey: e.target.value },
                            }),
                          );
                          setProbeMsg(undefined);
                          setProbeOk(undefined);
                        }}
                      />
                    </label>
                    <label className="lobby-count">
                      Model
                      <input
                        type="text"
                        autoComplete="off"
                        spellCheck={false}
                        value={seat.byok.model}
                        placeholder={DEFAULT_BYOK.model}
                        onChange={(e) => {
                          onPlan(
                            updateSeat(plan, index, {
                              byok: { ...seat.byok, model: e.target.value },
                            }),
                          );
                          setProbeMsg(undefined);
                          setProbeOk(undefined);
                        }}
                      />
                    </label>
                    <label className="lobby-check">
                      <input
                        type="checkbox"
                        checked={seat.byok.reasoning}
                        onChange={(e) => {
                          onPlan(
                            updateSeat(plan, index, {
                              byok: { ...seat.byok, reasoning: e.target.checked },
                            }),
                          );
                        }}
                      />
                      Longer rationale budget (API thinking stays off — required for JSON picks)
                    </label>
                    <label className="lobby-count">
                      Proxy URL (optional)
                      <input
                        type="url"
                        autoComplete="off"
                        spellCheck={false}
                        value={seat.byok.proxyUrl}
                        placeholder="empty — local pnpm dev uses /__byok"
                        onChange={(e) => {
                          onPlan(
                            updateSeat(plan, index, {
                              byok: { ...seat.byok, proxyUrl: e.target.value },
                            }),
                          );
                          setProbeMsg(undefined);
                          setProbeOk(undefined);
                        }}
                      />
                    </label>
                    <label className="lobby-check">
                      <input
                        type="checkbox"
                        checked={seat.byok.useTurnRunner}
                        onChange={(e) => {
                          onPlan(
                            updateSeat(plan, index, {
                              byok: { ...seat.byok, useTurnRunner: e.target.checked },
                            }),
                          );
                          setProbeMsg(undefined);
                          setProbeOk(undefined);
                        }}
                      />
                      Turn runner (local plan→commit — run <code>pnpm byok-turn</code>)
                    </label>
                    {seat.byok.useTurnRunner ? (
                      <label className="lobby-count">
                        Turn runner URL
                        <input
                          type="url"
                          autoComplete="off"
                          spellCheck={false}
                          value={seat.byok.turnRunnerUrl}
                          placeholder="empty — Vite uses /__turn → :4010"
                          onChange={(e) => {
                            onPlan(
                              updateSeat(plan, index, {
                                byok: { ...seat.byok, turnRunnerUrl: e.target.value },
                              }),
                            );
                            setProbeMsg(undefined);
                            setProbeOk(undefined);
                          }}
                        />
                      </label>
                    ) : null}
                    <div className="lobby-byok-actions">
                      <button
                        type="button"
                        className="lobby-byok-test"
                        disabled={byokIncomplete || probeSeat !== undefined}
                        onClick={() => {
                          runProbe(index);
                        }}
                      >
                        {probeSeat === index ? 'Testing…' : 'Test connection'}
                      </button>
                    </div>
                    {probeMsg !== undefined && probeShownOn === index ? (
                      <p
                        className={
                          probeOk === true
                            ? 'lobby-byok-ok'
                            : probeOk === false
                              ? 'lobby-byok-warn'
                              : 'lobby-byok-note'
                        }
                      >
                        {probeMsg}
                      </p>
                    ) : null}
                    {byokIncomplete ? (
                      <p className="lobby-byok-warn">
                        Fill base URL, API key, and model for this seat.
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })
          )}
        </fieldset>

        {onlineMode ? null : (
          <p className="lobby-byok-note">
            On Pages, leave Proxy URL empty. Hosts that allow browser CORS (x.ai,
            Groq, OpenRouter) work without <code>pnpm</code>.{' '}
            <code>api.openai.com</code> often does not — then use{' '}
            <code>pnpm --filter @conquarrow/web dev</code> (auto <code>/__byok</code>)
            or a personal Proxy URL. Every device pastes its own base URL, key, and
            model. Point seats at different models to watch them fight. Keys stay in
            this browser.
          </p>
        )}

        {incomplete && !onlineMode ? (
          <p className="lobby-byok-warn">Complete every BYOK seat before Start.</p>
        ) : null}

        {onlineMode &&
        online.signedIn &&
        !online.createOffered &&
        online.seatEditsOffered &&
        !online.createInvitePending ? (
          <p className="lobby-byok-note">Create needs two Player seats.</p>
        ) : null}

        {onlineMode && !online.startOffered ? (
          <p className="lobby-byok-note">
            Start is enabled when every Player seat is filled — waiting chairs must bind.
          </p>
        ) : null}

        {resume === undefined ? null : <ResumeSave resume={resume} />}

        <button type="button" className="lobby-start" disabled={startDisabled} onClick={onStart}>
          Start match
        </button>
      </div>
    </div>
  );
};

const PLAYER_LABEL = (index: number): string => String(seatPlayerId(index));

const FrozenRoster = ({
  seats,
  userHash,
}: {
  readonly seats: readonly InviteSeat[];
  readonly userHash: string | undefined;
}): ReactElement => (
  <>
    {seats.map((seat, index) => {
      const player = seatPlayerId(index);
      const color = styleFor(player).fill;
      return (
        <div key={String(player)} className="lobby-seat">
          <div className="lobby-seat-head">
            <span className="lobby-seat-swatch" style={{ background: color }} />
            <strong style={{ color }}>{styleFor(player).label}</strong>
            <span className="lobby-seat-occupancy">
              {rosterOccupancyLabel(rosterOccupancy(seat, userHash))}
            </span>
          </div>
        </div>
      );
    })}
  </>
);

const goneCopy = (reason: 'revoked' | 'started' | 'deleted' | undefined): string => {
  if (reason === 'revoked') return 'This invite was revoked.';
  if (reason === 'deleted') return GAME_DELETED_COPY;
  if (reason === 'started') return 'This invite already started.';
  return 'This invite is gone.';
};

export interface LibraryActions {
  readonly onOpenGame: (groupHash: string, gameNumber: string) => void;
  readonly onLoadMore: (list: LibraryList) => void;
  readonly onRename: (groupHash: string, gameNumber: string, name: string) => Promise<boolean>;
  readonly onDelete: (groupHash: string, gameNumber: string) => void;
  readonly onHide: (groupHash: string, gameNumber: string, hidden: boolean) => void;
}

/** P96 D11: colour, label, "you", and a marker on the seat to move. */
const SeatChips = ({ row }: { readonly row: StartedGameRow }): ReactElement => (
  <span className="lobby-game-chips">
    {row.seats.map((seat, index) => (
      <span
        key={`${seat.kind}:${String(index)}`}
        className={index === row.activeSeat ? 'lobby-game-chip to-move' : 'lobby-game-chip'}
      >
        <span
          className={
            seat.you
              ? 'lobby-game-swatch you'
              : seat.kind === 'heuristic'
                ? 'lobby-game-swatch ai'
                : 'lobby-game-swatch'
          }
          style={{ background: styleFor(seatPlayerId(index)).fill }}
          aria-hidden
        />
        {seat.label}
        {seat.you ? ' (you)' : null}
        {index === row.activeSeat ? <span className="lobby-game-to-move"> · to move</span> : null}
      </span>
    ))}
  </span>
);

type RowMode = 'idle' | 'renaming' | 'deleting';

const RenameForm = ({
  row,
  actions,
  onDone,
}: {
  readonly row: StartedGameRow;
  readonly actions: LibraryActions;
  readonly onDone: () => void;
}): ReactElement => {
  const [draft, setDraft] = useState(row.name ?? '');
  const [failed, setFailed] = useState(false);
  return (
    <form
      className="lobby-game-rename"
      onSubmit={(event) => {
        event.preventDefault();
        void actions.onRename(row.groupHash, row.gameNumber, draft).then((ok) => {
          if (ok) onDone();
          else setFailed(true);
        });
      }}
    >
      <input
        aria-label="Game name"
        value={draft}
        maxLength={GAME_NAME_MAX * 2}
        onChange={(event) => {
          setDraft(event.target.value);
          setFailed(false);
        }}
      />
      <button type="submit" className="lobby-byok-test">
        Save
      </button>
      <button type="button" className="lobby-byok-test" onClick={onDone}>
        Cancel
      </button>
      {failed ? <span className="lobby-byok-warn">That name was not accepted.</span> : null}
    </form>
  );
};

const RowActions = ({
  row,
  actions,
}: {
  readonly row: StartedGameRow;
  readonly actions: LibraryActions;
}): ReactElement | null => {
  const [mode, setMode] = useState<RowMode>('idle');
  const idle = (): void => {
    setMode('idle');
  };
  if (mode === 'renaming') return <RenameForm row={row} actions={actions} onDone={idle} />;
  if (mode === 'deleting') {
    return (
      <div className="lobby-game-actions lobby-game-confirm" role="group" aria-label="Confirm delete">
        <span className="lobby-byok-warn">This deletes the game for every player. It cannot be undone.</span>
        <button
          type="button"
          className="lobby-game-delete"
          onClick={() => {
            actions.onDelete(row.groupHash, row.gameNumber);
            idle();
          }}
        >
          {DELETE_GAME_CONFIRM}
        </button>
        <button type="button" className="lobby-byok-test" onClick={idle}>
          Cancel
        </button>
      </div>
    );
  }
  const finished = row.section === 'finished';
  if (!row.owner && !finished) return null;
  return (
    <div className="lobby-game-actions">
      {row.owner ? (
        <button
          type="button"
          className="lobby-byok-test"
          onClick={() => {
            setMode('renaming');
          }}
        >
          Rename
        </button>
      ) : null}
      {finished ? (
        <button
          type="button"
          className="lobby-byok-test"
          onClick={() => {
            actions.onHide(row.groupHash, row.gameNumber, !row.hidden);
          }}
        >
          {row.hidden ? 'Unhide' : 'Hide'}
        </button>
      ) : null}
      {row.owner ? (
        <button
          type="button"
          className="lobby-byok-test"
          onClick={() => {
            setMode('deleting');
          }}
        >
          Delete
        </button>
      ) : null}
    </div>
  );
};

const LibraryGameRow = ({
  row,
  actions,
}: {
  readonly row: StartedGameRow;
  readonly actions: LibraryActions;
}): ReactElement => {
  const activity = formatLibraryStartedAt(row.lastActivityAt ?? row.startedAt);
  const turnLine = libraryTurnLine(row);
  const winnerLine = libraryWinnerLine(row);
  const tint = libraryRowTint(row.seatIndex);
  return (
    <li className="lobby-game">
      <button
        type="button"
        className="lobby-byok-test lobby-game-open"
        style={{ borderLeftColor: tint }}
        onClick={() => {
          actions.onOpenGame(row.groupHash, row.gameNumber);
        }}
      >
        <span className="lobby-game-copy">
          <span className="lobby-game-name">{libraryRowTitle(row)}</span>
          <span className="lobby-game-status">{formatLibraryRow(row.status, row.gameNumber)}</span>
          <SeatChips row={row} />
          <span className="lobby-game-meta">
            {[turnLine, winnerLine, activity].filter((line) => line !== undefined).join(' · ')}
          </span>
        </span>
      </button>
      <RowActions row={row} actions={actions} />
    </li>
  );
};

const LibrarySectionList = ({
  section,
  actions,
}: {
  readonly section: LibrarySectionView;
  readonly actions: LibraryActions;
}): ReactElement => {
  const [open, setOpen] = useState(!section.collapsedByDefault);
  return (
    <section className="lobby-games-section">
      <button
        type="button"
        className="lobby-games-heading"
        aria-expanded={open}
        onClick={() => {
          setOpen((was) => !was);
        }}
      >
        {section.title} ({String(section.count)})
      </button>
      {open ? (
        <>
          {section.rows.length === 0 && !section.more ? (
            <p className="lobby-byok-note">{NO_GAMES_COPY}</p>
          ) : (
            <ul className="lobby-games">
              {section.rows.map((row) => (
                <LibraryGameRow key={`${row.groupHash}/${row.gameNumber}`} row={row} actions={actions} />
              ))}
            </ul>
          )}
          {section.more ? (
            <button
              type="button"
              className="lobby-byok-test"
              onClick={() => {
                actions.onLoadMore(section.list);
              }}
            >
              {section.rows.length === 0 ? 'Show' : 'Show more'}
            </button>
          ) : null}
        </>
      ) : null}
    </section>
  );
};

const MyGamesDisclosure = ({
  library,
  hiddenGames,
  actions,
}: {
  readonly library: MyGamesBody | undefined;
  readonly hiddenGames: readonly StartedGameRow[];
  readonly actions: LibraryActions;
}): ReactElement => {
  const [open, setOpen] = useState(false);
  const sections = library === undefined ? [] : librarySections(library, hiddenGames);
  const empty = sections.every((section) => section.count === 0);
  return (
    <>
      <button
        type="button"
        className="lobby-byok-test"
        onClick={() => {
          setOpen((was) => !was);
        }}
      >
        {MY_GAMES_COPY}
      </button>
      {open ? (
        empty ? (
          <p className="lobby-byok-note">{NO_GAMES_COPY}</p>
        ) : (
          <div className="lobby-library">
            {sections.map((section) => (
              <LibrarySectionList key={section.list} section={section} actions={actions} />
            ))}
          </div>
        )
      ) : null}
    </>
  );
};

/** P96 D6: the optional name of the next invite, checked as it is typed. */
const InviteNameField = ({ online }: { readonly online: LobbyOnline }): ReactElement => (
  <label className="lobby-invite-name">
    Game name (optional)
    <input
      value={online.inviteName}
      maxLength={GAME_NAME_MAX * 2}
      aria-invalid={!online.inviteNameValid}
      onChange={(event) => {
        online.onInviteName(event.target.value);
      }}
    />
    {online.inviteNameValid ? null : (
      <span className="lobby-byok-warn">
        Up to {String(GAME_NAME_MAX)} letters, digits, spaces and - _ . , : ; ! ? ' " ( ) # & + / @
      </span>
    )}
  </label>
);

/** Online row. The chooser slot exists only while signed out, never beside Sign out. */
const OnlineActionRow = ({ online }: { readonly online: LobbyOnline }): ReactElement => (
  <div className="lobby-online-row">
    {online.signedIn ? (
      <button type="button" className="lobby-byok-test" onClick={online.onSignOut}>
        Sign out
      </button>
    ) : (
      <>
        <button type="button" className="lobby-start" onClick={online.onSignIn}>
          Sign in with Google
        </button>
        {chooserSlotOffered(online.signedIn) ? <div id="conquarrow-gis-chooser" /> : null}
      </>
    )}
    <button
      type="button"
      className="lobby-byok-test"
      disabled={!online.createOffered}
      onClick={online.onCreate}
    >
      Create invite
    </button>
    {online.acceptOffered ? (
      <button type="button" className="lobby-start" onClick={online.onAccept}>
        Accept invite
      </button>
    ) : null}
  </div>
);

const OnlineChrome = ({
  online,
  onLearn,
}: {
  readonly online: LobbyOnline;
  readonly onLearn?: () => void;
}): ReactElement => (
  <div className="lobby-online">
    <div className="lobby-mode" role="group" aria-label="Play mode">
      <button
        type="button"
        className={online.mode === 'local' ? 'lobby-mode-btn on' : 'lobby-mode-btn'}
        onClick={() => {
          online.onMode('local');
        }}
      >
        Local
      </button>
      <button
        type="button"
        className={online.mode === 'online' ? 'lobby-mode-btn on' : 'lobby-mode-btn'}
        onClick={() => {
          online.onMode('online');
        }}
      >
        Online
      </button>
      {onLearn === undefined ? null : (
        <button type="button" className="lobby-mode-btn" onClick={onLearn}>
          Learn
        </button>
      )}
    </div>
    {online.mode === 'online' ? (
      <>
        <OnlineActionRow online={online} />
        {online.signedIn && online.seatEditsOffered ? <InviteNameField online={online} /> : null}
        {online.createInvitePending ? (
          <p className="lobby-create-pending" role="status">
            <span className="lobby-hourglass" aria-hidden="true" />
            {CREATING_INVITE_COPY}
          </p>
        ) : null}
        {online.copiedUrl !== undefined ? (
          <p className="lobby-byok-ok">
            Invite link:{' '}
            <button
              type="button"
              className="lobby-copy"
              onClick={() => {
                const url = online.copiedUrl;
                if (url === undefined) return;
                try {
                  void navigator.clipboard.writeText(url).catch(() => {
                    /* permission — URL still visible */
                  });
                } catch {
                  /* no clipboard API */
                }
              }}
            >
              Copy
            </button>
            <code className="lobby-invite-url">{online.copiedUrl}</code>
          </p>
        ) : null}
        {online.inviteGone ? <p className="lobby-byok-warn">{goneCopy(online.goneReason)}</p> : null}
        {online.lobbyFull ? <p className="lobby-byok-warn">That lobby is full.</p> : null}
        {online.gameDeleted ? <p className="lobby-byok-warn">{GAME_DELETED_COPY}</p> : null}
        {libraryOffered(online.mode, online.signedIn) ? (
          <MyGamesDisclosure library={online.library} hiddenGames={online.hiddenGames} actions={online} />
        ) : null}
      </>
    ) : null}
  </div>
);
