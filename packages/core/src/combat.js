import { MAX_DICE_PER_NODE, MAX_RESERVE, largestConnectedRegionSize } from './state.js';

const defaultRollDie = () => 1 + Math.floor(Math.random() * 6);

function rollSum(count, rollDie) {
  let sum = 0;
  for (let i = 0; i < count; i++) sum += rollDie();
  return sum;
}

// Pure: returns a new nodes Map plus a description of what happened, so a
// renderer can animate dice without recomputing anything.
export function resolveAttack(nodes, { from, to }, { rollDie = defaultRollDie } = {}) {
  const attacker = nodes.get(from);
  const defender = nodes.get(to);

  const attackRoll = rollSum(attacker.dice, rollDie);
  const defendRoll = rollSum(defender.dice, rollDie);
  const attackerWins = attackRoll > defendRoll;

  const next = new Map(nodes);
  if (attackerWins) {
    const movingDice = Math.min(attacker.dice - 1, MAX_DICE_PER_NODE);
    next.set(from, { ...attacker, dice: 1 });
    next.set(to, { owner: attacker.owner, dice: movingDice });
  } else {
    next.set(from, { ...attacker, dice: 1 });
  }

  return {
    nodes: next,
    result: { from, to, attackRoll, defendRoll, attackerWins },
  };
}

// End-of-turn reinforcement: the player earns one die per territory in their
// largest connected region, banked in `reserve` (capped) then handed out to
// under-full owned territories.
export function applyReinforcement(state, playerId) {
  const player = state.players.get(playerId);
  const earned = largestConnectedRegionSize(state, playerId);

  let reserve = Math.min(player.reserve + earned, MAX_RESERVE);
  const nodes = new Map(state.nodes);
  const ownedIds = [...nodes].filter(([, n]) => n.owner === playerId).map(([id]) => id);

  let i = 0;
  while (reserve > 0 && ownedIds.length > 0) {
    const id = ownedIds[i % ownedIds.length];
    const node = nodes.get(id);
    if (node.dice < MAX_DICE_PER_NODE) {
      nodes.set(id, { ...node, dice: node.dice + 1 });
      reserve--;
    }
    i++;
    if (i % ownedIds.length === 0 && ownedIds.every((id) => nodes.get(id).dice >= MAX_DICE_PER_NODE)) {
      break; // everything is full; whatever's left sits in reserve
    }
  }

  const players = new Map(state.players);
  players.set(playerId, { ...player, reserve });

  return { state: { ...state, nodes, players }, earned };
}
