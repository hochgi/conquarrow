/**
 * The cogwheel panel — exactly two controls (P48).
 *
 * Auto-focus and opponent playback speed are preferences: you set them once and
 * forget them. Bot-pause deliberately stays on the HUD, because it is an
 * in-the-moment action and behind a gear it would be useless.
 */

import type { ReactElement } from 'react';
import { useState } from 'react';
import type { Prefs } from './prefs';
import { SPEED_MAX, SPEED_MIN } from './spectate';

export const SPEED_STEP = 0.25;

export const speedLabel = (speed: number): string => `${String(speed)}×`;

export const Settings = ({
  prefs,
  onChange,
}: {
  readonly prefs: Prefs;
  readonly onChange: (next: Prefs) => void;
}): ReactElement => {
  const [open, setOpen] = useState(false);
  return (
    <div className={open ? 'settings open' : 'settings'}>
      <button
        type="button"
        className="settings-gear"
        aria-expanded={open}
        aria-label="Settings"
        title="Settings"
        onClick={() => {
          setOpen((prev) => !prev);
        }}
      >
        ⚙
      </button>
      {open ? (
        <div className="settings-panel" role="group" aria-label="Settings">
          <label>
            <input
              type="checkbox"
              checked={prefs.autoFocus}
              onChange={(e) => {
                onChange({ ...prefs, autoFocus: e.currentTarget.checked });
              }}
            />
            Auto-focus opponents
          </label>
          <label>
            Opponent playback speed
            <input
              type="range"
              min={SPEED_MIN}
              max={SPEED_MAX}
              step={SPEED_STEP}
              value={prefs.playbackSpeed}
              onChange={(e) => {
                onChange({ ...prefs, playbackSpeed: Number(e.currentTarget.value) });
              }}
            />
            <span className="settings-value">{speedLabel(prefs.playbackSpeed)}</span>
          </label>
        </div>
      ) : null}
    </div>
  );
};
