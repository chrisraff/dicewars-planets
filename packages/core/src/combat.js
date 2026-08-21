import { MAX_DICE_PER_NODE, MAX_RESERVE, largestConnectedRegionSize } from './state.js';

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
    next.set(to, { owner: attacker.owner, dice: movingDice });
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

// End-of-turn reinforcement: the player earns one die per territory in their
// largest connected region, banked in `reserve` (capped) then handed out to
// under-full owned territories.
//
// Where the dice land is drawn from `deps.rng`, for the same reason the dice
// themselves are: walking the territories in board order would pile every
// reinforcement onto the same few territories, every turn, every game.
export function applyReinforcement(state, playerId, { rng = Math.random } = {}) {
  const player = state.players.get(playerId);
  const earned = largestConnectedRegionSize(state, playerId);

  let reserve = Math.min(player.reserve + earned, MAX_RESERVE);
  const nodes = new Map(state.nodes);

  // the territories a die could actually land on right now
  const withRoom = [];
  for (const [id, node] of nodes) {
    if (node.owner === playerId && node.dice < MAX_DICE_PER_NODE) withRoom.push(id);
  }

  while (reserve > 0 && withRoom.length > 0) {
    // `Math.min` because an injected rng is only promised to be in [0, 1] —
    // a generator that can return exactly 1 would otherwise index off the end
    const pick = Math.min(withRoom.length - 1, Math.floor(rng() * withRoom.length));
    const id = withRoom[pick];
    const node = nodes.get(id);
    const dice = node.dice + 1;

    nodes.set(id, { ...node, dice });
    reserve--;

    // full now, so it is out of the running — swap-with-last keeps this O(1)
    // and the order of what remains does not matter, since the pick is random
    if (dice >= MAX_DICE_PER_NODE) {
      withRoom[pick] = withRoom[withRoom.length - 1];
      withRoom.pop();
    }
  }

  // anything that could not land stays banked for a later turn
  const players = new Map(state.players);
  players.set(playerId, { ...player, reserve });

  return { state: { ...state, nodes, players }, earned };
}
