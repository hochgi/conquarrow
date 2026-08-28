/**
 * docs/spec/bot-pause/bot-pause.edge-cases.feature
 * One it() per Gherkin scenario. Pure helpers — no RTL, no jsdom.
 */

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
import { isAiSeatOf, localAiOpts, openingState } from './botPlayback.support';

describe('Pause edges — online, tutorial, human chair, cancel', () => {
  it('Online play does not offer Pause', () => {
    expect(
      pauseOffered({ vsBot: true, online: true, matchOver: false, tutorial: false }),
    ).toBe(false);
  });

  it('A finished match does not offer Pause', () => {
    expect(
      pauseOffered({ vsBot: true, online: false, matchOver: true, tutorial: false }),
    ).toBe(false);
  });

  it('Tutorial does not offer Pause', () => {
    expect(
      pauseOffered({ vsBot: true, online: false, matchOver: false, tutorial: true }),
    ).toBe(false);
  });

  it('Hotseat with no bots does not offer Pause', () => {
    expect(
      pauseOffered({ vsBot: false, online: false, matchOver: false, tutorial: false }),
    ).toBe(false);
  });

  it('Manual pause outranks idle', () => {
    const idle = idlePaused({ allBot: true, tabFocused: false, online: false });
    expect(pauseKind({ manual: true, idle })).toBe('manual');
    expect(pauseButtonLabel(true)).toBe('Resume');
  });

  it('Returning focus does not clear a click-pause', () => {
    const idle = idlePaused({ allBot: true, tabFocused: true, online: false });
    expect(botsHeld({ manual: true, idle })).toBe(true);
    expect(pauseKind({ manual: true, idle })).toBe('manual');
  });

  it('Empty roster is not all-bot', () => {
    expect(isAllBot([])).toBe(false);
    expect(idlePaused({ allBot: isAllBot([]), tabFocused: false, online: false })).toBe(false);
  });

  it('Online all-bot does not idle-pause on blur', () => {
    expect(isAllBot(['heuristic', 'byok'])).toBe(true);
    const idle = idlePaused({ allBot: true, tabFocused: false, online: true });
    expect(idle).toBe(false);
    expect(pauseKind({ manual: false, idle })).toBe('running');
  });

  it('Human chair stays playable while bots are held', () => {
    expect(
      turnControlsLocked({ matchOver: false, botBusy: false, aiChair: false }),
    ).toBe(false);
  });

  it('AI chair stays locked while held', () => {
    expect(
      turnControlsLocked({ matchOver: false, botBusy: false, aiChair: true }),
    ).toBe(true);
  });

  it('Hold makes the playback chair key unused', () => {
    const state = openingState();
    const held = botsHeld({
      manual: true,
      idle: idlePaused({ allBot: true, tabFocused: true, online: false }),
    });
    const key = held
      ? null
      : localAiChairKey(state, {
          ...localAiOpts(state),
          isAiSeat: isAiSeatOf(String(state.activePlayer)),
        });
    expect(key).toBeNull();
  });
});
