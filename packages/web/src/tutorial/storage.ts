/**
 * Progress storage (P43).
 *
 * Completion flags are meta, never match state — the engine's no-save/resume
 * property (SPEC §1) is untouched. The backing is a minimal read/write cell so
 * `localStorage` fits behind the same seam tests drive with memory.
 */

export interface StorageBacking {
  read(): string | undefined;
  write(value: string): void;
}

export interface ProgressStore {
  completions(): ReadonlySet<string>;
  markComplete(id: string): void;
  reset(): void;
  cardDismissed(): boolean;
  dismissCard(): void;
}

interface Stored {
  readonly completions: readonly string[];
  readonly cardDismissed: boolean;
}

const EMPTY: Stored = { completions: [], cardDismissed: false };

const parse = (raw: string | undefined): Stored => {
  if (raw === undefined) return EMPTY;
  try {
    const value = JSON.parse(raw) as Partial<Stored>;
    return {
      completions: Array.isArray(value.completions) ? value.completions.filter((x): x is string => typeof x === 'string') : [],
      cardDismissed: value.cardDismissed === true,
    };
  } catch {
    return EMPTY;
  }
};

/** Build the progress store over any backing cell. */
export const createProgressStore = (backing: StorageBacking): ProgressStore => {
  let current = parse(backing.read());
  const persist = (): void => {
    backing.write(JSON.stringify(current));
  };
  return {
    completions: () => new Set(current.completions),
    markComplete: (id: string): void => {
      if (current.completions.includes(id)) return;
      current = { ...current, completions: [...current.completions, id] };
      persist();
    },
    reset: (): void => {
      current = EMPTY;
      persist();
    },
    cardDismissed: () => current.cardDismissed,
    dismissCard: (): void => {
      if (current.cardDismissed) return;
      current = { ...current, cardDismissed: true };
      persist();
    },
  };
};
