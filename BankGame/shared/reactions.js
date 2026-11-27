/**
 * Taunts and reactions players can fire at each other from their phones.
 *
 * A fixed, server-checked menu: clients send an id, never free text, so there
 * is nothing to moderate and nothing to inject. Every client renders the same
 * id with the emoji and line below.
 */

export const REACTIONS = Object.freeze([
  { id: 'flip', emoji: '🖕', label: 'Flip off', text: 'Up yours!' },
  { id: 'laugh', emoji: '😂', label: 'Laugh', text: 'Ha ha ha!' },
  { id: 'skull', emoji: '💀', label: 'Dead', text: "You're dead." },
  { id: 'chicken', emoji: '🐔', label: 'Chicken', text: 'Bank it, chicken!' },
  { id: 'clown', emoji: '🤡', label: 'Clown', text: 'Clown behavior.' },
  { id: 'fire', emoji: '🔥', label: 'On fire', text: 'Cooking!' },
  { id: 'cry', emoji: '😭', label: 'Cry', text: 'Sad pot noises.' },
  { id: 'money', emoji: '🤑', label: 'Greedy', text: 'Gimme that pot.' },
  { id: 'pray', emoji: '🙏', label: 'Pray', text: 'Please be a 7.' },
  { id: 'yawn', emoji: '🥱', label: 'Yawn', text: 'Boring.' },
]);

export const REACTION_IDS = Object.freeze(REACTIONS.map((r) => r.id));

const BY_ID = new Map(REACTIONS.map((r) => [r.id, r]));

/** The reaction definition for an id, or undefined. */
export function reactionById(id) {
  return BY_ID.get(id);
}

/** Minimum gap between one player's reactions (ms), enforced by the server. */
export const REACTION_COOLDOWN_MS = 700;
