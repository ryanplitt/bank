import { useEffect, useRef } from 'react';

/**
 * The shared pot, shown big and unambiguous on every device. It pulses briefly
 * whenever the pot value changes so a climbing pot is impossible to miss.
 */
export default function Pot({ value, busted }) {
  const ref = useRef(null);
  const prev = useRef(value);

  useEffect(() => {
    if (ref.current && prev.current !== value) {
      // Restart the pulse animation.
      ref.current.classList.remove('pot-pulse');
      // Force a reflow so the re-add restarts the animation.
      void ref.current.offsetWidth;
      ref.current.classList.add('pot-pulse');
      prev.current = value;
    }
  }, [value]);

  return (
    <div className={`pot ${busted ? 'pot--busted' : ''}`} ref={ref}>
      <div className="pot-label">POT</div>
      <div className="pot-value">{value}</div>
    </div>
  );
}
