/**
 * The one thing players spend the game doing: BANK. Large and thumb-reachable,
 * with the amount on the line right on the button so there is no second-guessing.
 */
export default function BankButton({ canBank, pot, disabled, onClick }) {
  const blocked = disabled || !canBank;
  return (
    <button
      type="button"
      className={`bank-button ${blocked ? 'muted' : ''}`}
      disabled={blocked}
      onClick={onClick}
    >
      <span className="bank-main">BANK</span>
      <span className="bank-sub">{blocked ? 'waiting…' : `take the pot · ${pot}`}</span>
    </button>
  );
}
