/**
 * docs/spec/bot-pause/bot-pause.core.feature
 * One it() per Gherkin scenario. Pure helpers — no RTL, no jsdom.
 */

import { describe, expect, it } from 'vitest';
import {
  botsHeld,
  idlePaused,
  isAllBot,
  pauseButtonLabel,
  pauseKind,
  pauseOffered,
} from '../src/botPause';

describe('Hold local bot seats without ending the match', () => {
  it('Pause is offered on a local vs-bot match that is not over', () => {
    expect(
      pauseOffered({ vsBot: true, online: false, matchOver: false, tutorial: false }),
    ).toBe(true);
    expect(pauseButtonLabel(false)).toBe('Pause');
  });

  it('Manual pause holds bots until Resume', () => {
    const idle = idlePaused({ allBot: true, tabFocused: true, online: false });
    expect(idle).toBe(false);
    expect(botsHeld({ manual: true, idle })).toBe(true);
    expect(pauseKind({ manual: true, idle })).toBe('manual');
    expect(pauseButtonLabel(true)).toBe('Resume');
  });

  it('Resume releases a manual hold', () => {
    const idle = idlePaused({ allBot: false, tabFocused: true, online: false });
    expect(botsHeld({ manual: false, idle })).toBe(false);
    expect(pauseKind({ manual: false, idle })).toBe('running');
    expect(pauseButtonLabel(false)).toBe('Pause');
  });

  it('All-bot unfocused tab is idle-paused', () => {
    expect(isAllBot(['heuristic', 'byok', 'heuristic'])).toBe(true);
    const idle = idlePaused({ allBot: true, tabFocused: false, online: false });
    expect(idle).toBe(true);
    expect(botsHeld({ manual: false, idle })).toBe(true);
    expect(pauseKind({ manual: false, idle })).toBe('idle');
    expect(pauseButtonLabel(false)).toBe('Pause');
  });

  it('Mixed match does not idle-pause on blur', () => {
    expect(isAllBot(['human', 'byok', 'heuristic'])).toBe(false);
    const idle = idlePaused({ allBot: false, tabFocused: false, online: false });
    expect(idle).toBe(false);
    expect(botsHeld({ manual: false, idle })).toBe(false);
    expect(pauseKind({ manual: false, idle })).toBe('running');
  });
});
