// Status is also in hidden words and a check mark, never the circle's color alone.
export function Steps({ label, steps, current }: { label: string; steps: string[]; current: number }) {
  return (
    <ol className="steps" aria-label={label}>
      {steps.map((step, index) => {
        const status = index < current ? 'done' : index === current ? 'current' : 'upcoming';
        return (
          <li key={index} className={`steps__step steps__step--${status}`} aria-current={status === 'current' ? 'step' : undefined}>
            <span className="steps__circle" aria-hidden="true">{status === 'done' ? '✓' : index + 1}</span>
            <span className="usa-sr-only">Step {index + 1}: </span>
            {step}
            <span className="usa-sr-only">, {status === 'done' ? 'done' : status === 'current' ? 'current step' : 'not started'}</span>
          </li>
        );
      })}
    </ol>
  );
}
