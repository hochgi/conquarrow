import type { ReactElement } from 'react';
import type { LessonStep } from './tutorial/types';
import { stageBanner, type CardBox } from './tutorial/stage';

/** Narrate / end card, or expect/objective stage banner. */
export const TutorialOverlay = ({
  step,
  halted,
  haltDetail,
  onNext,
  coach,
  cardBox,
}: {
  readonly step: LessonStep;
  readonly halted: boolean;
  readonly haltDetail: string | undefined;
  readonly onNext: () => void;
  readonly coach?: string;
  readonly cardBox?: CardBox;
}): ReactElement | null => {
  if (halted) {
    return (
      <div className="tutorial-overlay" role="status">
        <p>This lesson halted — a demo move was refused.</p>
        <p className="lobby-byok-warn">{haltDetail ?? 'unknown'}</p>
      </div>
    );
  }
  const banner = stageBanner(step, coach);
  if (banner !== undefined) {
    return (
      <div className="tutorial-banner" role="status">
        {banner.title !== undefined ? <p className="tutorial-banner-title">{banner.title}</p> : null}
        {banner.body !== undefined ? <p>{banner.body}</p> : null}
      </div>
    );
  }
  if (step.kind !== 'narrate' && step.kind !== 'end') return null;
  const text = step.kind === 'narrate' ? step.text : step.summary;
  const placed = cardBox !== undefined;
  return (
    <div
      className={placed ? 'tutorial-overlay tutorial-overlay-placed' : 'tutorial-overlay'}
      style={
        cardBox === undefined
          ? undefined
          : {
              left: cardBox.x,
              top: cardBox.y,
              width: cardBox.width,
              maxHeight: cardBox.height,
            }
      }
    >
      <p>{text}</p>
      <button type="button" className="lobby-start" onClick={onNext}>
        {step.kind === 'end' ? 'Done' : 'Next'}
      </button>
    </div>
  );
};
