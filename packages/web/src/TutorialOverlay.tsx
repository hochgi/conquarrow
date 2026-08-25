import type { ReactElement } from 'react';
import type { LessonStep } from './tutorial/types';

/** Narrate / end card. Sits over the dimmed board; Next is the only control. */
export const TutorialOverlay = ({
  step,
  halted,
  haltDetail,
  onNext,
}: {
  readonly step: LessonStep;
  readonly halted: boolean;
  readonly haltDetail: string | undefined;
  readonly onNext: () => void;
}): ReactElement | null => {
  if (halted) {
    return (
      <div className="tutorial-overlay" role="status">
        <p>This lesson halted — a demo move was refused.</p>
        <p className="lobby-byok-warn">{haltDetail ?? 'unknown'}</p>
      </div>
    );
  }
  if (step.kind !== 'narrate' && step.kind !== 'end') return null;
  const text = step.kind === 'narrate' ? step.text : step.summary;
  return (
    <div className="tutorial-overlay">
      <p>{text}</p>
      <button type="button" className="lobby-start" onClick={onNext}>
        {step.kind === 'end' ? 'Done' : 'Next'}
      </button>
    </div>
  );
};
