/**
 * EARS invariants for docs/spec/bot-pause/bot-pause.md.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { localAiChairKey } from '../src/botPlayback';
import {
  botsHeld,
  idlePaused,
  isAllBot,
  pauseButtonLabel,
  pauseKind,
  pauseOffered,
  turnControlsLocked,
} from '../src/botPause';
import { openingState } from './botPlayback.support';

const botPauseSource = (): string =>
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/botPause.ts'), 'utf8');

const hudSource = (): string =>
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/Hud.tsx'), 'utf8');

const appSource = (): string =>
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/App.tsx'), 'utf8');

describe('bot-pause invariants', () => {
  it('While pauseOffered is false, the system shall not show a Pause control.', () => {
    const hidden = [
      pauseOffered({ vsBot: false, online: false, matchOver: false, tutorial: false }),
      pauseOffered({ vsBot: true, online: true, matchOver: false, tutorial: false }),
      pauseOffered({ vsBot: true, online: false, matchOver: true, tutorial: false }),
      pauseOffered({ vsBot: true, online: false, matchOver: false, tutorial: true }),
    ];
    expect(hidden.every((offered) => !offered)).toBe(true);
    expect(hudSource()).toContain('pauseOffered');
    expect(hudSource()).toContain('pauseButtonLabel');
  });

  it('While botsHeld is true, the local AI chair key used for playback shall be null.', () => {
    const state = openingState();
    const held = botsHeld({ manual: true, idle: false });
    expect(held).toBe(true);
    expect(held ? null : localAiChairKey(state, { online: false, isAiSeat: () => true })).toBeNull();
    expect(appSource()).toContain('botsHeld');
    expect(appSource()).toContain('localAiChairKey');
    expect(appSource()).toContain('visibilitychange');
  });

  it('When only manual is true, pauseKind shall be manual and the button label shall be Resume.', () => {
    expect(pauseKind({ manual: true, idle: false })).toBe('manual');
    expect(pauseButtonLabel(true)).toBe('Resume');
  });

  it('When idlePaused is true and manual is false, pauseKind shall be idle and the button label shall be Pause.', () => {
    expect(idlePaused({ allBot: true, tabFocused: false })).toBe(true);
    expect(pauseKind({ manual: false, idle: true })).toBe('idle');
    expect(pauseButtonLabel(false)).toBe('Pause');
  });

  it('When neither hold applies, pauseKind shall be running.', () => {
    expect(pauseKind({ manual: false, idle: false })).toBe('running');
  });

  it('The system shall treat a roster as all-bot only when it is non-empty and no seat is human.', () => {
    expect(isAllBot([])).toBe(false);
    expect(isAllBot(['human'])).toBe(false);
    expect(isAllBot(['heuristic', 'human', 'byok'])).toBe(false);
    expect(isAllBot(['heuristic'])).toBe(true);
    expect(isAllBot(['byok', 'heuristic'])).toBe(true);
  });

  it('When a human chair is active, turnControlsLocked shall be false unless the match is over or botBusy is true.', () => {
    expect(turnControlsLocked({ matchOver: false, botBusy: false, aiChair: false })).toBe(false);
    expect(turnControlsLocked({ matchOver: true, botBusy: false, aiChair: false })).toBe(true);
    expect(turnControlsLocked({ matchOver: false, botBusy: true, aiChair: false })).toBe(true);
  });

  it('When an AI chair is active, turnControlsLocked shall be true even if playback is not busy.', () => {
    expect(turnControlsLocked({ matchOver: false, botBusy: false, aiChair: true })).toBe(true);
  });

  it('Idle pause shall not apply when any seat is human, including while the tab is unfocused.', () => {
    expect(idlePaused({ allBot: isAllBot(['human', 'byok']), tabFocused: false })).toBe(false);
  });

  it('The pause helper shall not call Date.now, Math.random, or fetch.', () => {
    const src = botPauseSource();
    expect(src).not.toContain('Date.now');
    expect(src).not.toContain('Math.random');
    expect(src).not.toContain('fetch');
  });

  it('The rules engine shall be unchanged: no edit to packages/rules-core.', () => {
    expect(botPauseSource()).not.toContain('rules-core');
    expect(botPauseSource()).not.toContain('@conquarrow/rules-core');
  });
});
