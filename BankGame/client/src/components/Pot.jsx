import { useCountUp } from '../state/useCountUp.js';

const SPARKS = 8;

/**
 * The shared pot, shown big and unambiguous on every device.
 *
 * When the pot grows the number counts up to its new value, the whole card
 * pops with a golden glow, and a "+N" floats up out of it. A doubling or a big
 * gain also throws a ring of sparks. A bust jolts the card red. A drop (a bust,
 * a new round) just snaps: there is nothing to celebrate.
 */
export default function Pot({ value, busted }) {
  const { shown, gain } = useCountUp(value);

  const classes = ['pot'];
  if (busted) classes.push('pot--busted');
  if (gain) classes.push(gain.big ? 'pot--gain-big' : 'pot--gain');

  return (
    // Keyed by the gain so every increase restarts the pop from the top.
    <div className={classes.join(' ')} key={gain ? `g${gain.id}` : 'idle'}>
      <div className="pot-label">POT</div>
      <div className="pot-value">{shown}</div>
      {gain && (
        <>
          <span className="pot-float" aria-hidden="true">
            {gain.doubled ? '×2' : `+${gain.delta}`}
          </span>
          {gain.big &&
            Array.from({ length: SPARKS }, (_, i) => (
              <span
                key={i}
                className="pot-spark"
                aria-hidden="true"
                style={{ '--angle': `${(360 / SPARKS) * i}deg` }}
              />
            ))}
        </>
      )}
    </div>
  );
}
