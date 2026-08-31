import {
  MAX_DICE_PER_NODE,
  MAX_RESERVE,
  bodiesOf,
  bodyOf,
  largestConnectedRegionSize,
  reserveOn,
  withReserveOn,
} from './state.js';

const defaultRollDie = () => 1 + Math.floor(Math.random() * 6);

function rollDice(count, rollDie) {
  const rolls = [];
  for (let i = 0; i < count; i++) rolls.push(rollDie());
  return rolls;
}

const sum = (values) => values.reduce((a, b) => a + b, 0);

// Pure: returns a new nodes Map plus a description of what happened, so a
// renderer can animate dice without recomputing anything.
export function resolveAttack(nodes, { from, to }, { rollDie = defaultRollDie } = {}) {
  const attacker = nodes.get(from);
  const defender = nodes.get(to);

  // every individual face, not just the totals — a renderer showing the dice
  // land on their values needs to know what each one came up as
  const attackRolls = rollDice(attacker.dice, rollDie);
  const defendRolls = rollDice(defender.dice, rollDie);
  const attackRoll = sum(attackRolls);
  const defendRoll = sum(defendRolls);
  const attackerWins = attackRoll > defendRoll;

  const next = new Map(nodes);
  if (attackerWins) {
    const movingDice = attacker.dice - 1;
    next.set(from, { ...attacker, dice: 1 });
    // The *defender* spread, not a node built from scratch: everything about a
    // territory except who holds it and how many dice are on it survives being
    // captured, and the one such field there is says which world it is on.
    // Built fresh, a captured moon territory quietly became a planet one, and
    // the two economies leaked into each other from the first capture.
    next.set(to, { ...defender, owner: attacker.owner, dice: movingDice });
  } else {
    next.set(from, { ...attacker, dice: 1 });
  }

  return {
    nodes: next,
    result: {
      from,
      to,
      attackRolls,
      defendRolls,
      attackRoll,
      defendRoll,
      attackerWins,
      attackerOwner: attacker.owner,
      defenderOwner: defender.owner,
    },
  };
}

/**
 * End-of-turn reinforcement: the player earns one die per territory in their
 * largest connected region, banked in `reserve` (capped) then handed out to
 * under-full owned territories.
 *
 * Where the dice land is drawn from `deps.rng`, for the same reason the dice
 * themselves are: walking the territories in board order would pile every
 * reinforcement onto the same few territories, every turn, every game.
 *
 * **Paid once per body, and paid separately.** A world with a moon in it is
 * two economies rather than one board that happens to be in two pieces: the
 * region is measured within a body and the dice it earns are scattered over
 * that body's territories only. Without that second half a moon holding
 * quietly funds a war on the planet, at no cost of transport, which is
 * exactly the runaway the mode exists to avoid. The bank follows the same
 * rule, or dice that could not land on a full moon would spill onto the
 * planet a turn later and go round the rule anyway.
 *
 * A single-world board has one body, so the loop runs once over the same
 * territories in the same order and draws the same numbers from `rng` as it
 * did before any of this: the earnings, the landings and the bank are
 * identical, which is what lets a replay recorded before moon mode still
 * play back exactly.
 */
export function applyReinforcement(state, playerId, { rng = Math.random } = {}) {
  let player = state.players.get(playerId);
  const nodes = new Map(state.nodes);

  let earned = 0;
  // Which territory each die landed on, one entry per die and in the order
  // they were placed — a renderer wanting to drop the payout onto the board
  // one die at a time needs to know where each one actually went, the same
  // reason an attack carries every individual roll rather than just a total.
  const landed = [];
  const byBody = [];

  for (const body of bodiesOf(state)) {
    const due = largestConnectedRegionSize(state, playerId, body);
    let reserve = Math.min(reserveOn(player, body) + due, MAX_RESERVE);

    // the territories on this body a die could actually land on right now
    const withRoom = [];
    for (const [id, node] of nodes) {
      if (node.owner === playerId && node.dice < MAX_DICE_PER_NODE && bodyOf(node) === body) {
        withRoom.push(id);
      }
    }

    const here = [];
    while (reserve > 0 && withRoom.length > 0) {
      // `Math.min` because an injected rng is only promised to be in [0, 1] —
      // a generator that can return exactly 1 would otherwise index off the end
      const pick = Math.min(withRoom.length - 1, Math.floor(rng() * withRoom.length));
      const id = withRoom[pick];
      const node = nodes.get(id);
      const dice = node.dice + 1;

      nodes.set(id, { ...node, dice });
      here.push(id);
      reserve--;

      // full now, so it is out of the running — swap-with-last keeps this O(1)
      // and the order of what remains does not matter, since the pick is random
      if (dice >= MAX_DICE_PER_NODE) {
        withRoom[pick] = withRoom[withRoom.length - 1];
        withRoom.pop();
      }
    }

    // anything that could not land stays banked for a later turn, on the body
    // that earned it
    player = withReserveOn(player, body, reserve);
    earned += due;
    landed.push(...here);
    byBody.push({ body, earned: due, landed: here, reserve });
  }

  const players = new Map(state.players);
  players.set(playerId, player);

  return { state: { ...state, nodes, players }, earned, landed, byBody };
}
