/**
 * The effect layer — one SVG group per live overlay, drawn over the board.
 *
 * Every effect here is *presentation of a transition that already happened*. The
 * board underneath renders `GameState`, so this layer is free to be dropped,
 * capped or interrupted at any point without the position ever being wrong.
 *
 * Three constraints shaped the implementation:
 *
 *   - **Timing is CSS, not React.** An overlay renders once; its `animationDelay`
 *     carries the causal offset and the per-cell spatial stagger. No timers drive
 *     frames, so a slow tab or a paused animation cannot desynchronise anything.
 *   - **No particles.** Each effect is a handful of shapes bounded by
 *     `MAX_FX_CELLS`. A capture of a hundred tiles draws a hundred polygons the
 *     board was already drawing anyway, not ten thousand sprites.
 *   - **Never occlude the board.** Fills stay translucent, text is small and
 *     short-lived, and nothing is drawn at screen centre. The board stays the
 *     interface.
 */

import type { ArrowId, GeometryPort } from '@conquarrow/contracts';
import type { TilingLayout } from '@conquarrow/geometry-tiling';
import type { CSSProperties, ReactElement } from 'react';
import { FX_COUNT_HALO, FX_NOW, styleFor } from '../colors';
import { arrowChord, centroidScreen, inkWidth, polyPoints } from '../boardGeom';
import { toScreen, type Viewport } from '../viewport';
import type { FxItem } from './queue';
import { REFUSAL_TEXT, type FxCell, type FxOverlay } from './present';

export interface BoardFxProps {
  readonly geometry: GeometryPort;
  readonly layout: TilingLayout;
  readonly viewport: Viewport;
  readonly items: readonly FxItem[];
}

interface Ctx {
  readonly geometry: GeometryPort;
  readonly layout: TilingLayout;
  readonly viewport: Viewport;
}

/** Delay and duration for one shape, as CSS. Custom props feed the keyframes. */
const anim = (
  offsetMs: number,
  durationMs: number,
  extra?: Readonly<Record<string, string>>,
): CSSProperties => ({
  animationDelay: `${String(offsetMs)}ms`,
  animationDuration: `${String(durationMs)}ms`,
  ...extra,
});

const pointsOf = (ctx: Ctx, arrow: ArrowId): string =>
  polyPoints(ctx.viewport, ctx.layout.polygon(arrow));

const centreOf = (ctx: Ctx, arrow: ArrowId): { readonly x: number; readonly y: number } =>
  centroidScreen(ctx.viewport, ctx.layout.polygon(arrow));

/** Same bias the board uses, so the hand-off numeral sits on the stack count. */
const COUNT_BIAS = 0.42;

const countAnchor = (
  ctx: Ctx,
  arrow: ArrowId,
): { readonly x: number; readonly y: number } => {
  const c = centreOf(ctx, arrow);
  const tipWorld = ctx.layout.pointPosition(ctx.geometry.target(arrow));
  const tip = toScreen(ctx.viewport, tipWorld.x, tipWorld.y);
  return {
    x: c.x + (tip.x - c.x) * COUNT_BIAS,
    y: c.y + (tip.y - c.y) * COUNT_BIAS,
  };
};

const glyphSize = (ctx: Ctx, factor = 0.24): number =>
  Math.max(9, ctx.viewport.scale * factor);

/** Small floating numeral — the only text this layer draws, and it is transient. */
const FxCount = ({
  ctx,
  x,
  y,
  text,
  ink,
  offsetMs,
  durationMs,
  dx,
  dy,
  className,
}: {
  readonly ctx: Ctx;
  readonly x: number;
  readonly y: number;
  readonly text: string;
  readonly ink: string;
  readonly offsetMs: number;
  readonly durationMs: number;
  readonly dx: number;
  readonly dy: number;
  readonly className: string;
}): ReactElement => (
  <text
    className={className}
    x={x}
    y={y}
    textAnchor="middle"
    dominantBaseline="central"
    fontSize={glyphSize(ctx)}
    fontFamily="IBM Plex Sans, Segoe UI, sans-serif"
    fontWeight={700}
    fill={ink}
    stroke={FX_COUNT_HALO}
    strokeWidth={Math.max(0.8, glyphSize(ctx) * 0.12)}
    paintOrder="stroke fill"
    style={anim(offsetMs, durationMs, {
      '--fx-dx': `${String(dx)}px`,
      '--fx-dy': `${String(dy)}px`,
    })}
  >
    {text}
  </text>
);

// ── capture: spatial fill, then a temporary "just gained" marker ──────────────

const CaptureFill = ({
  ctx,
  overlay,
}: {
  readonly ctx: Ctx;
  readonly overlay: Extract<FxOverlay, { kind: 'captureFill' }>;
}): ReactElement => {
  const style = styleFor(overlay.player);
  return (
    <g style={{ pointerEvents: 'none' }}>
      {overlay.cells.map((cell) => (
        <polygon
          key={String(cell.arrow)}
          className="fx-capture-fill"
          points={pointsOf(ctx, cell.arrow)}
          fill={style.fill}
          stroke={style.stroke}
          strokeWidth={1.6}
          style={anim(overlay.offsetMs + cell.delayMs, overlay.durationMs)}
        />
      ))}
    </g>
  );
};

/**
 * Newly captured ground, marked by an animated dashed rim rather than a brighter
 * colour — the distinction has to survive colour-blindness and a screenshot, and
 * it has to expire on its own so territory has exactly one permanent appearance.
 */
const CaptureFresh = ({
  ctx,
  overlay,
}: {
  readonly ctx: Ctx;
  readonly overlay: Extract<FxOverlay, { kind: 'captureFresh' }>;
}): ReactElement => {
  const width = inkWidth(ctx.viewport, 0.035, 1.4);
  return (
    <g style={{ pointerEvents: 'none' }}>
      {overlay.cells.map((cell) => (
        <polygon
          key={String(cell.arrow)}
          className="fx-capture-fresh"
          points={pointsOf(ctx, cell.arrow)}
          fill="none"
          stroke={FX_NOW}
          strokeWidth={width}
          strokeDasharray={`${String(width * 3)} ${String(width * 2.4)}`}
          style={anim(overlay.offsetMs + cell.delayMs, overlay.durationMs)}
        />
      ))}
    </g>
  );
};

/** Losing ground: the old owner's colour retracts, so the swap has two halves. */
const LossRetract = ({
  ctx,
  overlay,
}: {
  readonly ctx: Ctx;
  readonly overlay: Extract<FxOverlay, { kind: 'lossRetract' }>;
}): ReactElement => {
  const style = styleFor(overlay.player);
  return (
    <g style={{ pointerEvents: 'none' }}>
      {overlay.cells.map((cell) => (
        <polygon
          key={String(cell.arrow)}
          className="fx-loss-retract"
          points={pointsOf(ctx, cell.arrow)}
          fill={style.fill}
          stroke={style.accent}
          strokeWidth={1.4}
          style={anim(overlay.offsetMs + cell.delayMs, overlay.durationMs)}
        />
      ))}
    </g>
  );
};

// ── completion: a pulse that travels the loop's own geometry ──────────────────

const LoopPulse = ({
  ctx,
  overlay,
}: {
  readonly ctx: Ctx;
  readonly overlay: Extract<FxOverlay, { kind: 'loopPulse' }>;
}): ReactElement => {
  const style = styleFor(overlay.player);
  const width = inkWidth(ctx.viewport, 0.085, 2.4);
  const closing = overlay.closingArrow;
  return (
    <g style={{ pointerEvents: 'none' }}>
      {overlay.cells.map((cell) => {
        const seg = arrowChord(ctx.geometry, ctx.layout, ctx.viewport, cell.arrow);
        const isClosing = closing !== undefined && String(cell.arrow) === String(closing);
        return (
          <line
            key={String(cell.arrow)}
            className={isClosing ? 'fx-loop-pulse fx-loop-closing' : 'fx-loop-pulse'}
            x1={seg.x1}
            y1={seg.y1}
            x2={seg.x2}
            y2={seg.y2}
            stroke={style.accent}
            strokeWidth={isClosing ? width * 1.5 : width}
            strokeLinecap="round"
            style={anim(overlay.offsetMs + cell.delayMs, overlay.durationMs)}
          />
        );
      })}
    </g>
  );
};

/** A fresh trail cell, briefly brighter — the exposed part of an expansion. */
const TrailLaid = ({
  ctx,
  overlay,
}: {
  readonly ctx: Ctx;
  readonly overlay: Extract<FxOverlay, { kind: 'trailLaid' }>;
}): ReactElement => {
  const style = styleFor(overlay.player);
  const width = inkWidth(ctx.viewport, 0.06, 1.8);
  return (
    <g style={{ pointerEvents: 'none' }}>
      {overlay.cells.map((cell) => {
        const seg = arrowChord(ctx.geometry, ctx.layout, ctx.viewport, cell.arrow);
        return (
          <line
            key={String(cell.arrow)}
            className="fx-trail-laid"
            x1={seg.x1}
            y1={seg.y1}
            x2={seg.x2}
            y2={seg.y2}
            stroke={style.accent}
            strokeWidth={width}
            strokeLinecap="round"
            style={anim(overlay.offsetMs + cell.delayMs, overlay.durationMs)}
          />
        );
      })}
    </g>
  );
};

// ── severing: the break, then the two fronts burning outward ─────────────────

const Evaporate = ({
  ctx,
  overlay,
}: {
  readonly ctx: Ctx;
  readonly overlay: Extract<FxOverlay, { kind: 'evaporate' }>;
}): ReactElement => {
  const style = styleFor(overlay.victim);
  const width = inkWidth(ctx.viewport, 0.07, 2);
  return (
    <g style={{ pointerEvents: 'none' }}>
      {overlay.cells.map((cell: FxCell) => {
        const seg = arrowChord(ctx.geometry, ctx.layout, ctx.viewport, cell.arrow);
        const style2 = anim(overlay.offsetMs + cell.delayMs, overlay.durationMs);
        return (
          <g key={String(cell.arrow)}>
            <polygon
              className="fx-evaporate-fill"
              points={pointsOf(ctx, cell.arrow)}
              fill={style.fill}
              stroke={style.stroke}
              strokeWidth={1.4}
              style={style2}
            />
            <line
              className="fx-evaporate-chord"
              x1={seg.x1}
              y1={seg.y1}
              x2={seg.x2}
              y2={seg.y2}
              stroke={style.stroke}
              strokeWidth={width}
              strokeLinecap="round"
              style={style2}
            />
          </g>
        );
      })}
    </g>
  );
};

/**
 * A vanished seat's remnants: fill + chord in the seat's colour, flickering
 * together then fading. Same shapes as evaporate, not evaporate's CSS — a cut
 * staggers from the break; this does not.
 */
const SeatVanish = ({
  ctx,
  overlay,
}: {
  readonly ctx: Ctx;
  readonly overlay: Extract<FxOverlay, { kind: 'seatVanish' }>;
}): ReactElement => {
  const style = styleFor(overlay.player);
  const width = inkWidth(ctx.viewport, 0.07, 2);
  return (
    <g style={{ pointerEvents: 'none' }}>
      {overlay.cells.map((cell: FxCell) => {
        const seg = arrowChord(ctx.geometry, ctx.layout, ctx.viewport, cell.arrow);
        const style2 = anim(overlay.offsetMs + cell.delayMs, overlay.durationMs);
        return (
          <g key={String(cell.arrow)}>
            <polygon
              className="fx-seat-vanish-fill"
              points={pointsOf(ctx, cell.arrow)}
              fill={style.fill}
              stroke={style.stroke}
              strokeWidth={1.4}
              style={style2}
            />
            <line
              className="fx-seat-vanish-chord"
              x1={seg.x1}
              y1={seg.y1}
              x2={seg.x2}
              y2={seg.y2}
              stroke={style.stroke}
              strokeWidth={width}
              strokeLinecap="round"
              style={style2}
            />
          </g>
        );
      })}
    </g>
  );
};

/**
 * The cut itself: two short strokes recoiling apart across the arrow.
 *
 * Deliberately not an explosion. The metaphor is a severed line — the halves pull
 * away from a gap that was not there a moment ago — because what happened is a
 * topological break, not damage.
 */
const CutSnap = ({
  ctx,
  overlay,
}: {
  readonly ctx: Ctx;
  readonly overlay: Extract<FxOverlay, { kind: 'cutSnap' }>;
}): ReactElement => {
  const seg = arrowChord(ctx.geometry, ctx.layout, ctx.viewport, overlay.arrow);
  const mx = (seg.x1 + seg.x2) / 2;
  const my = (seg.y1 + seg.y2) / 2;
  const dx = seg.x2 - seg.x1;
  const dy = seg.y2 - seg.y1;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const recoil = Math.max(3, len * 0.16);
  const ink = styleFor(overlay.victim).accent;
  const width = inkWidth(ctx.viewport, 0.075, 2.2);
  const half = (sign: number): CSSProperties =>
    anim(overlay.offsetMs, overlay.durationMs, {
      '--fx-dx': `${String(ux * recoil * sign)}px`,
      '--fx-dy': `${String(uy * recoil * sign)}px`,
    });
  return (
    <g style={{ pointerEvents: 'none' }}>
      <line
        className="fx-cut-half"
        x1={seg.x1}
        y1={seg.y1}
        x2={mx - ux * 1.5}
        y2={my - uy * 1.5}
        stroke={ink}
        strokeWidth={width}
        strokeLinecap="butt"
        style={half(-1)}
      />
      <line
        className="fx-cut-half"
        x1={mx + ux * 1.5}
        y1={my + uy * 1.5}
        x2={seg.x2}
        y2={seg.y2}
        stroke={ink}
        strokeWidth={width}
        strokeLinecap="butt"
        style={half(1)}
      />
      {/* The gap, flashed once across the grain so the break has a location. */}
      <line
        className="fx-cut-gap"
        x1={mx - uy * recoil}
        y1={my + ux * recoil}
        x2={mx + uy * recoil}
        y2={my - ux * recoil}
        stroke={FX_NOW}
        strokeWidth={width * 0.8}
        strokeLinecap="round"
        style={anim(overlay.offsetMs, overlay.durationMs)}
      />
    </g>
  );
};

// ── impact: a local clash, sized by what it cost ──────────────────────────────

const Combat = ({
  ctx,
  overlay,
}: {
  readonly ctx: Ctx;
  readonly overlay: Extract<FxOverlay, { kind: 'combat' }>;
}): ReactElement => {
  const c = centreOf(ctx, overlay.arrow);
  const r = Math.max(7, ctx.viewport.scale * (overlay.heavy ? 0.34 : 0.24));
  const atk = styleFor(overlay.attacker);
  const def = styleFor(overlay.defender);
  const drift = r * 1.5;
  return (
    <g style={{ pointerEvents: 'none' }}>
      <circle
        className="fx-combat-ring"
        cx={c.x}
        cy={c.y}
        r={r}
        fill="none"
        stroke={FX_NOW}
        strokeWidth={Math.max(1.6, r * 0.16)}
        style={anim(overlay.offsetMs, overlay.durationMs)}
      />
      {/* Two opposed ticks: a clash between two sides, not a blast. */}
      <line
        className="fx-combat-tick"
        x1={c.x - r}
        y1={c.y - r * 0.55}
        x2={c.x + r}
        y2={c.y + r * 0.55}
        stroke={atk.accent}
        strokeWidth={Math.max(1.8, r * 0.2)}
        strokeLinecap="round"
        style={anim(overlay.offsetMs, overlay.durationMs)}
      />
      <line
        className="fx-combat-tick"
        x1={c.x - r}
        y1={c.y + r * 0.55}
        x2={c.x + r}
        y2={c.y - r * 0.55}
        stroke={def.accent}
        strokeWidth={Math.max(1.8, r * 0.2)}
        strokeLinecap="round"
        style={anim(overlay.offsetMs, overlay.durationMs)}
      />
      {overlay.attackerLost > 0 ? (
        <FxCount
          ctx={ctx}
          x={c.x - r * 0.9}
          y={c.y}
          text={`−${String(overlay.attackerLost)}`}
          ink={atk.accent}
          offsetMs={overlay.offsetMs + 40}
          durationMs={overlay.durationMs}
          dx={-drift}
          dy={-drift * 0.5}
          className="fx-float-loss"
        />
      ) : null}
      {overlay.defenderLost > 0 ? (
        <FxCount
          ctx={ctx}
          x={c.x + r * 0.9}
          y={c.y}
          text={`−${String(overlay.defenderLost)}`}
          ink={def.accent}
          offsetMs={overlay.offsetMs + 40}
          durationMs={overlay.durationMs}
          dx={drift}
          dy={-drift * 0.5}
          className="fx-float-loss"
        />
      ) : null}
    </g>
  );
};

// ── divergence / convergence: the two shapes a stack can change into ──────────

/**
 * Split: the portion that left physically travels, the rim that stayed contracts.
 *
 * The travelling numeral is the load-bearing part, not the stroke. Neighbouring
 * arrows are a few dozen pixels apart at normal zoom, so a line between their
 * centroids is far too short to read as motion — but a number that starts on the
 * old tile and ends on the new one is unmistakable at any spacing, and it says
 * *how many* went at the same time.
 */
const Divergence = ({
  ctx,
  overlay,
}: {
  readonly ctx: Ctx;
  readonly overlay: Extract<FxOverlay, { kind: 'divergence' }>;
}): ReactElement => {
  const a = centreOf(ctx, overlay.from);
  const b = centreOf(ctx, overlay.to);
  const style = styleFor(overlay.player);
  const width = inkWidth(ctx.viewport, 0.075, 2.2);
  return (
    <g style={{ pointerEvents: 'none' }}>
      <line
        className="fx-diverge-run"
        x1={a.x}
        y1={a.y}
        x2={b.x}
        y2={b.y}
        stroke={style.accent}
        strokeWidth={width}
        strokeLinecap="round"
        style={anim(overlay.offsetMs, overlay.durationMs)}
      />
      <polygon
        className="fx-diverge-hold"
        points={pointsOf(ctx, overlay.from)}
        fill="none"
        stroke={style.accent}
        strokeWidth={width * 0.8}
        style={anim(overlay.offsetMs, overlay.durationMs)}
      />
      <FxCount
        ctx={ctx}
        x={a.x}
        y={a.y}
        text={String(overlay.moved)}
        ink={style.accent}
        offsetMs={overlay.offsetMs}
        durationMs={overlay.durationMs}
        dx={b.x - a.x}
        dy={b.y - a.y}
        className="fx-float-move"
      />
    </g>
  );
};

/**
 * Merge: the arriving portion travels *in*, and the destination settles to its new
 * size. Same travelling-numeral trick, opposite reading — convergence, not conflict.
 */
const Convergence = ({
  ctx,
  overlay,
}: {
  readonly ctx: Ctx;
  readonly overlay: Extract<FxOverlay, { kind: 'convergence' }>;
}): ReactElement => {
  const a = centreOf(ctx, overlay.from);
  const b = centreOf(ctx, overlay.to);
  const style = styleFor(overlay.player);
  const width = inkWidth(ctx.viewport, 0.075, 2.2);
  return (
    <g style={{ pointerEvents: 'none' }}>
      <line
        className="fx-converge-run"
        x1={a.x}
        y1={a.y}
        x2={b.x}
        y2={b.y}
        stroke={style.accent}
        strokeWidth={width}
        strokeLinecap="round"
        style={anim(overlay.offsetMs, overlay.durationMs)}
      />
      <polygon
        className="fx-converge-settle"
        points={pointsOf(ctx, overlay.to)}
        fill={style.fill}
        fillOpacity={0.28}
        stroke={style.accent}
        strokeWidth={width}
        style={anim(overlay.offsetMs, overlay.durationMs)}
      />
      <FxCount
        ctx={ctx}
        x={a.x}
        y={a.y}
        text={String(overlay.total)}
        ink={style.accent}
        offsetMs={overlay.offsetMs}
        durationMs={overlay.durationMs}
        dx={b.x - a.x}
        dy={b.y - a.y}
        className="fx-float-move"
      />
    </g>
  );
};

/**
 * Heads that stayed: a planted dashed ring, and the count that did not travel.
 *
 * The pair is the point. Event 9 asks a player to tell "these continued" from
 * "these stayed here", so the split shows a number leaving while this shows a
 * number settling in place — one gesture each, in opposite directions.
 */
const Sentry = ({
  ctx,
  overlay,
}: {
  readonly ctx: Ctx;
  readonly overlay: Extract<FxOverlay, { kind: 'sentry' }>;
}): ReactElement => {
  const c = centreOf(ctx, overlay.arrow);
  const style = styleFor(overlay.player);
  const r = Math.max(5, ctx.viewport.scale * 0.18);
  return (
    <g style={{ pointerEvents: 'none' }}>
      <circle
        className="fx-sentry-set"
        cx={c.x}
        cy={c.y}
        r={r}
        fill="none"
        stroke={style.accent}
        strokeWidth={Math.max(1.4, r * 0.22)}
        strokeDasharray={`${String(r * 0.9)} ${String(r * 0.6)}`}
        style={anim(overlay.offsetMs, overlay.durationMs)}
      />
      <FxCount
        ctx={ctx}
        x={c.x}
        y={c.y - r * 0.9}
        text={String(overlay.heads)}
        ink={style.accent}
        offsetMs={overlay.offsetMs}
        durationMs={overlay.durationMs}
        dx={0}
        dy={r * 0.9}
        className="fx-float-stay"
      />
    </g>
  );
};

// ── emergence / transfer ─────────────────────────────────────────────────────

/** Production: heads rise out of the share that paid for them. */
const Emergence = ({
  ctx,
  overlay,
}: {
  readonly ctx: Ctx;
  readonly overlay: Extract<FxOverlay, { kind: 'emergence' }>;
}): ReactElement => {
  const c = centreOf(ctx, overlay.arrow);
  const style = styleFor(overlay.player);
  const r = Math.max(6, ctx.viewport.scale * 0.2);
  return (
    <g style={{ pointerEvents: 'none' }}>
      <circle
        className="fx-emerge-ring"
        cx={c.x}
        cy={c.y}
        r={r}
        fill={style.fill}
        fillOpacity={0.3}
        stroke={style.accent}
        strokeWidth={Math.max(1.4, r * 0.18)}
        style={anim(overlay.offsetMs, overlay.durationMs)}
      />
      <FxCount
        ctx={ctx}
        x={c.x}
        y={c.y}
        text={`+${String(overlay.amount)}`}
        ink={style.accent}
        offsetMs={overlay.offsetMs}
        durationMs={overlay.durationMs}
        dx={0}
        dy={-r * 1.8}
        className="fx-float-gain"
      />
    </g>
  );
};

/** Conversion: four-beat hand-off on the tile; the head count stays in the beat's ink. */
const Conversion = ({
  ctx,
  overlay,
}: {
  readonly ctx: Ctx;
  readonly overlay: Extract<FxOverlay, { kind: 'conversion' }>;
}): ReactElement => {
  const points = pointsOf(ctx, overlay.arrow);
  const count = countAnchor(ctx, overlay.arrow);
  const from = styleFor(overlay.from);
  const timed = anim(overlay.offsetMs, overlay.durationMs);
  const glyph = Math.max(8, ctx.viewport.scale * 0.26);
  return (
    <g style={{ pointerEvents: 'none' }}>
      <polygon
        className="fx-convert-out"
        points={points}
        fill={from.fill}
        stroke="none"
        style={timed}
      />
      <text
        className="fx-convert-out"
        x={count.x}
        y={count.y}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={glyph}
        fontFamily="IBM Plex Sans, Segoe UI, sans-serif"
        fontWeight={650}
        fill={from.ink}
        stroke={FX_COUNT_HALO}
        strokeWidth={Math.max(0.8, glyph * 0.1)}
        paintOrder="stroke fill"
        style={timed}
      >
        {overlay.heads}
      </text>
    </g>
  );
};

/** Ordinary movement: a directional streak and nothing else. */
const Advance = ({
  ctx,
  overlay,
}: {
  readonly ctx: Ctx;
  readonly overlay: Extract<FxOverlay, { kind: 'advance' }>;
}): ReactElement => {
  const a = centreOf(ctx, overlay.from);
  const b = centreOf(ctx, overlay.to);
  const style = styleFor(overlay.player);
  return (
    <line
      className="fx-advance"
      x1={a.x}
      y1={a.y}
      x2={b.x}
      y2={b.y}
      stroke={style.accent}
      strokeWidth={inkWidth(ctx.viewport, 0.05, 1.6)}
      strokeLinecap="round"
      style={{ ...anim(overlay.offsetMs, overlay.durationMs), pointerEvents: 'none' }}
    />
  );
};

/**
 * A refused click, answered where it happened.
 *
 * A cross at the tile plus the constraint named in one short phrase — enough to
 * learn the rule from, and nothing like a modal.
 */
const Refusal = ({
  ctx,
  overlay,
}: {
  readonly ctx: Ctx;
  readonly overlay: Extract<FxOverlay, { kind: 'refusal' }>;
}): ReactElement => {
  const c = centreOf(ctx, overlay.arrow);
  const r = Math.max(6, ctx.viewport.scale * 0.19);
  const width = Math.max(1.8, r * 0.24);
  return (
    <g className="fx-refusal" style={anim(overlay.offsetMs, overlay.durationMs)}>
      <polygon
        points={pointsOf(ctx, overlay.arrow)}
        fill="#e88a8a"
        fillOpacity={0.2}
        stroke="#f0a8a8"
        strokeWidth={width}
        strokeDasharray={`${String(r * 0.7)} ${String(r * 0.5)}`}
        style={{ pointerEvents: 'none' }}
      />
      <line
        x1={c.x - r * 0.5}
        y1={c.y - r * 0.5}
        x2={c.x + r * 0.5}
        y2={c.y + r * 0.5}
        stroke="#f0a8a8"
        strokeWidth={width}
        strokeLinecap="round"
      />
      <line
        x1={c.x - r * 0.5}
        y1={c.y + r * 0.5}
        x2={c.x + r * 0.5}
        y2={c.y - r * 0.5}
        stroke="#f0a8a8"
        strokeWidth={width}
        strokeLinecap="round"
      />
      <title>{REFUSAL_TEXT[overlay.reason]}</title>
    </g>
  );
};

const renderOverlay = (ctx: Ctx, overlay: FxOverlay): ReactElement | null => {
  switch (overlay.kind) {
    case 'captureFill':
      return <CaptureFill ctx={ctx} overlay={overlay} />;
    case 'captureFresh':
      return <CaptureFresh ctx={ctx} overlay={overlay} />;
    case 'lossRetract':
      return <LossRetract ctx={ctx} overlay={overlay} />;
    case 'loopPulse':
      return <LoopPulse ctx={ctx} overlay={overlay} />;
    case 'trailLaid':
      return <TrailLaid ctx={ctx} overlay={overlay} />;
    case 'evaporate':
      return <Evaporate ctx={ctx} overlay={overlay} />;
    case 'cutSnap':
      return <CutSnap ctx={ctx} overlay={overlay} />;
    case 'combat':
      return <Combat ctx={ctx} overlay={overlay} />;
    case 'divergence':
      return <Divergence ctx={ctx} overlay={overlay} />;
    case 'convergence':
      return <Convergence ctx={ctx} overlay={overlay} />;
    case 'sentry':
      return <Sentry ctx={ctx} overlay={overlay} />;
    case 'emergence':
      return <Emergence ctx={ctx} overlay={overlay} />;
    case 'conversion':
      return <Conversion ctx={ctx} overlay={overlay} />;
    case 'seatVanish':
      return <SeatVanish ctx={ctx} overlay={overlay} />;
    case 'advance':
      return <Advance ctx={ctx} overlay={overlay} />;
    case 'refusal':
      return <Refusal ctx={ctx} overlay={overlay} />;
    case 'turnHandover':
      // The handover is chrome, not board ink — the HUD and the stage ring own it.
      return null;
  }
};

/**
 * Paint order is the visual hierarchy from the brief: what happened sits on top of
 * what caused it, and both sit on top of the resulting state.
 */
const PAINT_ORDER: readonly FxOverlay['kind'][] = [
  'lossRetract',
  'captureFill',
  'captureFresh',
  'advance',
  'trailLaid',
  'convergence',
  'divergence',
  'sentry',
  'evaporate',
  'loopPulse',
  'conversion',
  'seatVanish',
  'emergence',
  'combat',
  'cutSnap',
  'refusal',
  'turnHandover',
];

export const BoardFx = ({ geometry, layout, viewport, items }: BoardFxProps): ReactElement => {
  const ctx: Ctx = { geometry, layout, viewport };
  const rank = new Map(PAINT_ORDER.map((kind, i) => [kind, i]));
  const ordered = items
    .map((item, index) => ({ item, index }))
    .toSorted((left, right) => {
      const a = rank.get(left.item.overlay.kind) ?? PAINT_ORDER.length;
      const b = rank.get(right.item.overlay.kind) ?? PAINT_ORDER.length;
      return a !== b ? a - b : left.index - right.index;
    });
  return (
    <g className="board-fx" style={{ pointerEvents: 'none' }}>
      {ordered.map(({ item }) => (
        <g key={item.overlay.id}>{renderOverlay(ctx, item.overlay)}</g>
      ))}
    </g>
  );
};
