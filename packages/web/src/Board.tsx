import type { ArrowId, GameState, GeometryPort, PlayerId, VertexId } from '@conquarrow/contracts';
import type { TilingLayout } from '@conquarrow/geometry-tiling';
import type { PointerEvent, ReactElement, WheelEvent } from 'react';
import {
  BOARD_BG,
  COUNT_HALO,
  EMPTY_FILL,
  EMPTY_STROKE,
  HIGHLIGHT_STROKE,
  MOVABLE_STROKE,
  PATH_STROKE,
  PATH_WASH,
  PREVIEW_STROKE,
  REACH_FILL,
  TOLL_REACH_FILL,
  SPAWNER_CURSOR,
  SPAWNER_HUB_IDLE,
  SPAWNER_IDLE,
  SPAWNER_RIM,
  SPAWNER_TRACK,
  SPAWNER_TRACK_RIM,
  styleFor,
} from './colors';
import type { InputHighlights } from './input/modes';
import type { RoutePaint } from './route';
import {
  REACH_WASH_FLOOR,
  SELECTED_HALO_STROKE,
  SELECTED_STROKE_WIDTH,
  SELECTED_WASH,
  type SelectionPaint,
} from './selectionChrome';
import { spawnerInfoAt, spawnerProminence, yieldSoonByArrow } from './spawnerInfo';
import type { YieldSoon } from './spawnerInfo';
import type { Viewport } from './viewport';
import { toScreen } from './viewport';
import { boxOf, centroidScreen, polyPoints } from './boardGeom';
import { BoardFx } from './fx/BoardFx';
import type { FxItem } from './fx/queue';
import {
  isMatchOverDimmed,
  playHighlightsAllowed,
  yieldSoonAllowed,
  type VictoryFx,
} from './fx/victory';
import { GAP_DEG, polygonCentroid, shareArcSpan } from './shareArc';

export interface BoardProps {
  readonly geometry: GeometryPort;
  readonly layout: TilingLayout;
  readonly state: GameState;
  readonly viewport: Viewport;
  readonly arrows: readonly ArrowId[];
  readonly vertices: ReadonlySet<VertexId>;
  readonly highlights: InputHighlights;
  /** The selected halo — computed by `selectionPaint` in App. */
  readonly chrome: SelectionPaint;
  /**
   * The route being drafted (P34), quietest tier first: full reach, the three
   * rays, their turn arrows, then the draft itself. Computed by `routePaint`.
   */
  readonly route: RoutePaint;
  /** Stacks of the active player that still have a legal step. */
  readonly movable: ReadonlySet<ArrowId>;
  /** The spawner under the cursor, if any — ringed here, detailed in `SpawnerTip`. */
  readonly hoveredSpawner?: VertexId;
  /** Narrate focus rings (P43) — named arrows only, never a second selection. */
  readonly focus?: ReadonlySet<ArrowId>;
  /**
   * Live gameplay effects, resolved from state transitions (see `fx/events.ts`).
   *
   * Additive: the board below already renders the authoritative state, so an
   * empty queue is a correct board, never a stale one.
   */
  readonly effects?: readonly FxItem[];
  /** Match-over celebration — computed once in App, shared with Hud. */
  readonly victory: VictoryFx;
  readonly onPointerDown: (e: PointerEvent<SVGSVGElement>) => void;
  readonly onPointerMove: (e: PointerEvent<SVGSVGElement>) => void;
  readonly onPointerUp: (e: PointerEvent<SVGSVGElement>) => void;
  readonly onPointerLeave: (e: PointerEvent<SVGSVGElement>) => void;
  readonly onWheel: (e: WheelEvent<SVGSVGElement>) => void;
}

const fillFor = (arrow: ArrowId, state: GameState): { fill: string; stroke: string } => {
  const territoryOwner = state.territory.get(arrow);
  if (territoryOwner !== undefined) {
    const s = styleFor(territoryOwner);
    return { fill: s.fill, stroke: s.stroke };
  }
  for (const [player, trail] of state.trails) {
    if (trail.has(arrow)) {
      const s = styleFor(player);
      return { fill: s.trailFill, stroke: s.stroke };
    }
  }
  return { fill: EMPTY_FILL, stroke: EMPTY_STROKE };
};

interface PlayFlags {
  readonly isSelected: boolean;
  readonly selectedEmphasis: boolean;
  /** Faintest tier: reachable this turn, but not on offer as a run (P34). */
  readonly onReachWash: boolean;
  /** Primary tier: a lit spine along one out-slot. */
  readonly onRay: boolean;
  /** Subordinate to its ray: the one free turn at the end of a run. */
  readonly onTurn: boolean;
  /** Strongest tier: the route drafted so far, reading as the trail it becomes. */
  readonly onDraft: boolean;
  readonly isTip: boolean;
  /** Would be clickable from the hovered arrow (fine pointer only). */
  readonly onPreview: boolean;
  readonly isMovable: boolean;
  readonly refused: boolean;
}

const idleFlags: PlayFlags = {
  isSelected: false,
  selectedEmphasis: false,
  onReachWash: false,
  onRay: false,
  onTurn: false,
  onDraft: false,
  isTip: false,
  onPreview: false,
  isMovable: false,
  refused: false,
};

const playFlags = (args: {
  readonly play: boolean;
  readonly arrow: ArrowId;
  readonly chrome: SelectionPaint;
  readonly route: RoutePaint;
  readonly draft: ReadonlySet<ArrowId>;
  readonly highlights: InputHighlights;
  readonly movable: ReadonlySet<ArrowId>;
}): PlayFlags => {
  if (!args.play) return idleFlags;
  const { arrow, chrome, route, draft, highlights, movable } = args;
  const isSelected = chrome.selected === arrow;
  return {
    isSelected,
    selectedEmphasis: chrome.selectedEmphasis && isSelected,
    onReachWash: route.reachWash.has(arrow),
    onRay: route.rayArrows.has(arrow),
    onTurn: route.turnArrows.has(arrow),
    onDraft: draft.has(arrow),
    isTip: route.tip === arrow,
    onPreview: route.hoverPreview.has(arrow),
    isMovable: movable.has(arrow) && !isSelected,
    refused: highlights.refused?.has(arrow) === true,
  };
};

/** Loudest mark wins: draft, then tip, then ray, then turn, then wash. */
const tileStrokeWidth = (flags: PlayFlags, occupied: boolean): number => {
  if (flags.onDraft || flags.isTip) return 3.0;
  if (flags.onRay) return 2.6;
  if (flags.isSelected) return 2.55;
  if (flags.onTurn) return 1.9;
  if (flags.isMovable) return 3.1;
  if (occupied) return 2.55;
  if (flags.onReachWash || flags.onPreview) return 1.5;
  return 0.7;
};

const tileStrokeColor = (
  flags: PlayFlags,
  occupied: boolean,
  ownerStroke: string,
  baseStroke: string,
): string => {
  if (flags.onDraft) return PATH_STROKE;
  if (flags.isTip) return HIGHLIGHT_STROKE;
  if (flags.onRay) return PREVIEW_STROKE;
  if (flags.isSelected) return ownerStroke;
  if (flags.onTurn || flags.onPreview) return REACH_FILL;
  if (flags.isMovable) return MOVABLE_STROKE;
  if (occupied) return ownerStroke;
  if (flags.onReachWash) return REACH_FILL;
  return baseStroke;
};

const SelectedWash = ({ points }: { readonly points: string }): ReactElement => (
  <polygon points={points} fill={SELECTED_WASH} stroke="none" style={{ pointerEvents: 'none' }} />
);

/**
 * The route wash, one tier at a time (P34).
 *
 * Three weights and a floor, because the point is a *reading*: the draft is the
 * trail it will become, the rays are the offer, the turn arrows are subordinate to
 * their ray, and the full reach stays at P31's quiet floor so a shrunken clickable
 * set never reads as a shrunken reach.
 */
const RouteWash = ({
  points,
  flags,
}: {
  readonly points: string;
  readonly flags: PlayFlags;
}): ReactElement | null => {
  if (flags.onDraft) {
    return (
      <polygon
        points={points}
        fill={PATH_WASH}
        className="path-pulse"
        style={{ pointerEvents: 'none' }}
      />
    );
  }
  if (flags.isSelected) return null;
  const opacity = flags.onRay ? 0.3 : flags.onTurn ? 0.15 : REACH_WASH_FLOOR;
  if (!flags.onRay && !flags.onTurn && !flags.onReachWash) return null;
  return (
    <polygon
      points={points}
      fill={REACH_FILL}
      fillOpacity={opacity}
      style={{ pointerEvents: 'none' }}
    />
  );
};

/** Majority of three bordering territory shares; otherwise neutral. */
const shareOwner = (
  geometry: GeometryPort,
  state: GameState,
  vertex: VertexId,
): PlayerId | undefined => {
  const counts = new Map<PlayerId, number>();
  for (const arrow of geometry.borderArrows(vertex)) {
    const owner = state.territory.get(arrow);
    if (owner === undefined) continue;
    counts.set(owner, (counts.get(owner) ?? 0) + 1);
  }
  let best: PlayerId | undefined;
  let bestN = 0;
  for (const [p, n] of counts) {
    if (n > bestN) {
      best = p;
      bestN = n;
    }
  }
  return bestN >= 2 ? best : undefined;
};

// ── the spawner mark ──────────────────────────────────────────────────────────

const arcPath = (
  cx: number,
  cy: number,
  r: number,
  fromDeg: number,
  toDeg: number,
): string => {
  const rad = (d: number): number => ((d - 90) * Math.PI) / 180;
  const x0 = cx + r * Math.cos(rad(fromDeg));
  const y0 = cy + r * Math.sin(rad(fromDeg));
  const x1 = cx + r * Math.cos(rad(toDeg));
  const y1 = cy + r * Math.sin(rad(toDeg));
  const large = Math.abs(toDeg - fromDeg) > 180 ? 1 : 0;
  return `M ${String(x0)} ${String(y0)} A ${String(r)} ${String(r)} 0 ${String(large)} 1 ${String(x1)} ${String(y1)}`;
};

/**
 * A spawner as three short arcs — one per bordering arrow, tinted by whoever holds it and
 * filled by that share's accumulator — around a hub showing who holds the majority.
 */
const SpawnerMark = ({
  geometry,
  layout,
  state,
  vertex,
  cx,
  cy,
  r,
  hovered,
}: {
  geometry: GeometryPort;
  layout: TilingLayout;
  state: GameState;
  vertex: VertexId;
  cx: number;
  cy: number;
  r: number;
  hovered: boolean;
}): ReactElement => {
  const info = spawnerInfoAt(geometry, state, vertex);
  const owner = shareOwner(geometry, state, vertex);
  const hub = owner !== undefined ? styleFor(owner).fill : SPAWNER_HUB_IDLE;
  const shares = info?.shares ?? [];
  const width = Math.max(1.4, r * 0.3);
  const vertexPos = layout.vertexPosition(vertex);

  return (
    <g style={{ pointerEvents: 'none' }} opacity={hovered ? 1 : (info ? spawnerProminence(info) : 0.4)}>
      {hovered ? (
        <circle cx={cx} cy={cy} r={r * 1.7} fill="none" stroke={SPAWNER_CURSOR} strokeWidth={1.2} />
      ) : null}
      {shares.map((share, k) => {
        const poly = layout.polygon(share.arrow);
        const span = poly.length > 0
          ? shareArcSpan(vertexPos, polygonCentroid(poly))
          : { from: k * 120 + GAP_DEG / 2, to: (k + 1) * 120 - GAP_DEG / 2 };
        const { from, to } = span;
        const tint = share.owner === undefined ? SPAWNER_IDLE : styleFor(share.owner).fill;
        const d = arcPath(cx, cy, r, from, to);
        return (
          <g key={String(share.arrow)}>
            {/* Rim first so the track does not melt into tile fill. */}
            <path
              d={d}
              fill="none"
              stroke={SPAWNER_TRACK_RIM}
              strokeWidth={width + 1.6}
              strokeLinecap="butt"
            />
            <path
              d={d}
              fill="none"
              stroke={share.owner === undefined ? SPAWNER_TRACK : tint}
              strokeOpacity={share.owner === undefined ? 1 : 0.34}
              strokeWidth={width}
              strokeLinecap="butt"
            />
            {share.loaded > 0.001 ? (
              <path
                d={arcPath(cx, cy, r, from, from + (to - from) * share.loaded)}
                fill="none"
                stroke={tint}
                strokeWidth={width}
                strokeLinecap="butt"
              />
            ) : null}
          </g>
        );
      })}
      <circle cx={cx} cy={cy} r={r * 0.4} fill={hub} stroke={SPAWNER_RIM} strokeWidth={0.9} />
    </g>
  );
};

/** Diagonal shine clipped to the tile — full strength next accrual, half the one after. */
const YieldShine = ({
  clipId,
  points,
  soon,
  bounds,
  gradId = 'yieldShineGrad',
}: {
  clipId: string;
  points: string;
  soon: YieldSoon;
  bounds: { x: number; y: number; w: number; h: number };
  gradId?: string;
}): ReactElement => {
  const pad = Math.max(bounds.w, bounds.h) * 0.85;
  return (
    <g style={{ pointerEvents: 'none' }} opacity={soon === 1 ? 1 : 0.3}>
      <clipPath id={clipId}>
        <polygon points={points} />
      </clipPath>
      <g clipPath={`url(#${clipId})`}>
        <rect
          className="yield-shine-band"
          x={bounds.x - pad}
          y={bounds.y - pad}
          width={bounds.w + pad * 2}
          height={bounds.h + pad * 2}
          fill={`url(#${gradId})`}
        />
      </g>
    </g>
  );
};

// ── the board ─────────────────────────────────────────────────────────────────

export const Board = ({
  geometry,
  layout,
  state,
  viewport,
  arrows,
  vertices,
  highlights,
  chrome,
  route,
  movable,
  hoveredSpawner,
  focus,
  effects,
  victory: fx,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerLeave,
  onWheel,
}: BoardProps): ReactElement => {
  const yieldSoon = yieldSoonAllowed(fx)
    ? yieldSoonByArrow(geometry, state)
    : new Map<ArrowId, YieldSoon>();
  const play = playHighlightsAllowed(fx);
  const draftArrows = new Set<ArrowId>(route.draftArrows);
  const winnerFill = fx.kind === 'over' ? styleFor(fx.winner).fill : undefined;

  return (
    <svg
      className="board"
      width={viewport.width}
      height={viewport.height}
      style={{ background: BOARD_BG, touchAction: 'none', cursor: 'grab' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerLeave}
      onWheel={onWheel}
    >
      <defs>
        <linearGradient id="yieldShineGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="45%" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="50%" stopColor="#ffffff" stopOpacity="0.55" />
          <stop offset="55%" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        {winnerFill !== undefined ? (
          <linearGradient id="victoryShineGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={winnerFill} stopOpacity="0" />
            <stop offset="45%" stopColor={winnerFill} stopOpacity="0" />
            <stop offset="50%" stopColor={winnerFill} stopOpacity="0.55" />
            <stop offset="55%" stopColor={winnerFill} stopOpacity="0" />
            <stop offset="100%" stopColor={winnerFill} stopOpacity="0" />
          </linearGradient>
        ) : null}
      </defs>
      {arrows.map((arrow) => {
        const poly = layout.polygon(arrow);
        const points = polyPoints(viewport, poly);
        const base = fillFor(arrow, state);
        const flags = playFlags({
          play,
          arrow,
          chrome,
          route,
          draft: draftArrows,
          highlights,
          movable,
        });
        const pulse = fx.kind === 'over' ? fx.pulseArrows.has(arrow) : flags.isSelected;
        const dimmed = isMatchOverDimmed(fx, arrow, state);
        const soon = yieldSoon.get(arrow);
        const victoryShine = fx.kind === 'over' && fx.shineArrows.has(arrow);
        const shineSoon: YieldSoon | undefined = victoryShine ? 1 : soon;
        const c = centroidScreen(viewport, poly);
        const group = state.groups.get(arrow);
        const occupied = group !== undefined;
        const ownerStroke = group !== undefined ? styleFor(group.owner).stroke : base.stroke;
        const strokeWidth = tileStrokeWidth(flags, occupied);
        const strokeColor = tileStrokeColor(flags, occupied, ownerStroke, base.stroke);
        const tipWorld = layout.pointPosition(geometry.target(arrow));
        const tip = toScreen(viewport, tipWorld.x, tipWorld.y);
        // Bias the count toward the arrowhead — the chevron is widest there.
        const countX = c.x + (tip.x - c.x) * 0.42;
        const countY = c.y + (tip.y - c.y) * 0.42;
        const glyph = Math.max(8, viewport.scale * 0.26);
        const trailMarks: PlayerId[] = [];
        for (const [player, trail] of state.trails) {
          if (trail.has(arrow)) trailMarks.push(player);
        }
        const bounds = boxOf(viewport, poly);
        return (
          <g key={String(arrow)} className={dimmed ? 'match-over-dim' : undefined}>
            <polygon
              points={points}
              fill={base.fill}
              stroke={strokeColor}
              strokeWidth={strokeWidth}
              data-arrow={String(arrow)}
              style={flags.refused ? { cursor: 'not-allowed' } : undefined}
            />
            {flags.selectedEmphasis || focus?.has(arrow) === true ? (
              <SelectedWash points={points} />
            ) : null}
            {pulse ? (
              <polygon
                points={points}
                fill={HIGHLIGHT_STROKE}
                stroke={HIGHLIGHT_STROKE}
                strokeWidth={strokeWidth + 1.2}
                className="selected-pulse"
              />
            ) : null}
            {trailMarks.map((player) => {
              const originWorld = layout.pointPosition(geometry.origin(arrow));
              const origin = toScreen(viewport, originWorld.x, originWorld.y);
              const ink = styleFor(player).stroke;
              // Dashed = open trail, cuttable. Territory next door is a solid
              // fill, so "exposed" is legible from shape alone (§5). The drift is
              // only on the player to move: that is the trail being extended
              // right now, and the risk they are taking on.
              const live = play && player === state.activePlayer;
              return (
                <line
                  key={`trail-${String(player)}`}
                  className={
                    live
                      ? 'trail-chord trail-chord-open trail-chord-live'
                      : 'trail-chord trail-chord-open'
                  }
                  x1={origin.x}
                  y1={origin.y}
                  x2={tip.x}
                  y2={tip.y}
                  stroke={ink}
                  strokeWidth={Math.max(1.6, viewport.scale * 0.055)}
                  strokeOpacity={0.92}
                  style={{ pointerEvents: 'none' }}
                />
              );
            })}
            <RouteWash points={points} flags={flags} />
            {flags.onPreview && !flags.onRay && !flags.onTurn ? (
              <polygon
                points={points}
                fill="none"
                stroke={REACH_FILL}
                strokeWidth={1.4}
                strokeDasharray="3 3"
                style={{ pointerEvents: 'none' }}
              />
            ) : null}
            {flags.refused && !flags.isSelected ? (
              <polygon
                points={points}
                fill={TOLL_REACH_FILL}
                fillOpacity={0.32}
                style={{ pointerEvents: 'none' }}
              />
            ) : null}
            {flags.selectedEmphasis || focus?.has(arrow) === true ? (
              <polygon
                points={points}
                fill="none"
                stroke={SELECTED_HALO_STROKE}
                strokeWidth={SELECTED_STROKE_WIDTH}
                style={{ pointerEvents: 'none' }}
              />
            ) : null}
            {shineSoon !== undefined ? (
              <YieldShine
                clipId={`yield-clip-${String(arrow)}`}
                points={points}
                soon={shineSoon}
                gradId={victoryShine ? 'victoryShineGrad' : 'yieldShineGrad'}
                bounds={bounds}
              />
            ) : null}
            {group !== undefined ? (
              <text
                x={countX}
                y={countY}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={glyph}
                fontFamily="IBM Plex Sans, Segoe UI, sans-serif"
                fontWeight={650}
                fill={styleFor(group.owner).ink}
                stroke={COUNT_HALO}
                strokeWidth={Math.max(0.8, glyph * 0.1)}
                paintOrder="stroke fill"
                style={{ pointerEvents: 'none', userSelect: 'none' }}
              >
                {group.heads}
              </text>
            ) : null}
          </g>
        );
      })}
      {[...vertices].map((vertex) => {
        if (!state.spawners.has(vertex)) return null;
        const pos = layout.vertexPosition(vertex);
        const s = toScreen(viewport, pos.x, pos.y);
        return (
          <SpawnerMark
            key={String(vertex)}
            geometry={geometry}
            layout={layout}
            state={state}
            vertex={vertex}
            cx={s.x}
            cy={s.y}
            r={Math.max(4, viewport.scale * 0.15)}
            hovered={hoveredSpawner === vertex}
          />
        );
      })}
      <BoardFx
        geometry={geometry}
        layout={layout}
        viewport={viewport}
        items={effects ?? []}
      />
    </svg>
  );
};
