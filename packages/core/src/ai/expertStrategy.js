import { neighbors } from '../graph.js';
import { isLegalAttack } from '../reducer.js';
import { MAX_DICE_PER_NODE } from '../state.js';
import { winProbability } from './battleOdds.js';

/**
 * What a thing is worth, all in one unit so they can be added up. A territory
 * is 1 by definition and everything else is priced against it.
 *
 * - `income` — one territory's worth of *reinforcement*, which is what the
 *   largest connected region pays out every turn. It is the difference
 *   between a player who is winning and one who merely holds a lot of ground,
 *   and it is why this AI will pass up a fat easy prize for a thin one that
 *   joins two regions together.
 * - `land` — a territory as a territory: somewhere to put dice, and one more
 *   thing that has to be taken before anyone is eliminated.
 * - `dice` — one die of material, mine or an opponent's. Under a territory,
 *   because dice are spent and ground is kept.
 * - `denial` — what an opponent's loss is worth to me. Below 1 on purpose: in
 *   a six-player game, hurting one rival helps the other four exactly as much
 *   as it helps me.
 * - `elimination` — taking a player's last territory. It is not the territory
 *   that is worth this much, it is the turn: every round from then on has one
 *   fewer player taking ground. Anywhere from a dozen territories to two dozen
 *   plays identically, so it sits at the low end of the range that works.
 * - `risk` — how seriously to take the counter-attack. At 0 the AI plays every
 *   fight as though the turn ended the game.
 * - `relief` — how much credit an attacker gets for the danger it was already
 *   in. Its own weight rather than a share of `risk`, because it pushes the
 *   opposite way: `risk` makes the AI careful, and this is the term that says
 *   a stack about to be taken anyway may as well be spent.
 * - `refill` — how much of the reinforcement due at the end of the turn to
 *   count on when judging what a territory can survive. At 0 the AI assumes
 *   every territory it empties stays empty. Above 1 — a *more* than even
 *   share — because reinforcement only lands where there is room, and drops a
 *   territory out of the running once it fills: the emptiest ground collects
 *   the most, which is exactly the ground this term is asked about.
 * - `minGain` — what a move has to be worth before it is worth making. Above
 *   0 it passes rather than take a marginal fight.
 *
 * The numbers were found by playing, not derived: a coordinate search over
 * several thousand six-player games against the other two strategies here.
 * They pull against each other hard enough that changing one on its own can
 * mislead — dropping `denial` to nothing looked harmless until `relief` moved,
 * and then cost thirty points — so anything retuned here wants re-measuring
 * against the whole set rather than in isolation.
 */
export const EXPERT_WEIGHTS = Object.freeze({
  income: 2,
  land: 1,
  dice: 0.7,
  denial: 0.15,
  elimination: 12,
  risk: 1,
  relief: 0.6,
  refill: 1.5,
  minGain: 0,
});

/**
 * The board carved into connected regions — every player's, not just mine,
 * because what a capture does to an opponent's income is worth as much as
 * what it does to my own. One pass over the territories; each one is walked
 * exactly once.
 */
function readBoard(state, playerId) {
  const regionOf = new Map(); // nodeId -> region index
  const size = []; // region index -> territories in it
  const owner = []; // region index -> whose it is
  const members = []; // region index -> its territories
  const holdings = new Map(); // playerId -> territories held
  const mine = [];

  for (const [id, node] of state.nodes) {
    holdings.set(node.owner, (holdings.get(node.owner) ?? 0) + 1);
    if (node.owner === playerId) mine.push(id);
  }

  for (const [start, node] of state.nodes) {
    if (regionOf.has(start)) continue;
    const index = size.length;
    const found = [];
    const stack = [start];
    regionOf.set(start, index);
    while (stack.length > 0) {
      const id = stack.pop();
      found.push(id);
      for (const next of neighbors(state.graph, id)) {
        if (regionOf.has(next) || state.nodes.get(next).owner !== node.owner) continue;
        regionOf.set(next, index);
        stack.push(next);
      }
    }
    size.push(found.length);
    owner.push(node.owner);
    members.push(found);
  }

  const incomeOf = new Map();
  for (let i = 0; i < size.length; i++) {
    if (size[i] > (incomeOf.get(owner[i]) ?? 0)) incomeOf.set(owner[i], size[i]);
  }

  return {
    mine,
    holdings,
    regionOf,
    size,
    owner,
    members,
    incomeOf,
    income: incomeOf.get(playerId) ?? 0,
  };
}

/**
 * What the owner of this territory would be earning without it.
 *
 * Losing one territory does not always cost one die a turn. Lose the wrong
 * one and a region of thirty becomes two of fifteen, and its owner's income
 * halves on the spot. That is the single most damaging thing that can be done
 * to a player who is ahead, and the single worst thing to do to yourself, so
 * it is worked out properly rather than guessed at: the region is walked again
 * with the territory taken out of it. Only that one region can have changed.
 */
function largestWithout(state, board, nodeId) {
  const index = board.regionOf.get(nodeId);
  const owner = board.owner[index];

  let best = 0;
  for (let i = 0; i < board.size.length; i++) {
    if (i !== index && board.owner[i] === owner && board.size[i] > best) best = board.size[i];
  }

  const seen = new Set([nodeId]); // walled off, so nothing walks through it
  for (const start of board.members[index]) {
    if (seen.has(start)) continue;
    let found = 0;
    const stack = [start];
    seen.add(start);
    while (stack.length > 0) {
      const id = stack.pop();
      found++;
      for (const next of neighbors(state.graph, id)) {
        if (seen.has(next) || state.nodes.get(next).owner !== owner) continue;
        seen.add(next);
        stack.push(next);
      }
    }
    if (found > best) best = found;
  }
  return best;
}

/**
 * What my largest region would be if I took this territory: every region it
 * touches merges into one, and every region it doesn't touch is left alone.
 */
function incomeAfterTaking(state, board, to, playerId) {
  const merging = new Set();
  for (const next of neighbors(state.graph, to)) {
    const index = board.regionOf.get(next);
    if (index !== undefined && board.owner[index] === playerId) merging.add(index);
  }

  let best = 1; // the territory itself
  for (const index of merging) best += board.size[index];
  for (let index = 0; index < board.size.length; index++) {
    if (board.owner[index] !== playerId || merging.has(index)) continue;
    if (board.size[index] > best) best = board.size[index];
  }
  return best;
}

/**
 * The chance the strongest rival next to a territory of mine takes it off me,
 * were it standing there with `dice` on it. The strongest rather than all of
 * them together, because a territory is only lost once and whoever has the
 * best chance of taking it is the one who will.
 *
 * `ignoring` drops a neighbour from the reckoning: a territory in the middle
 * of being captured is about to stop being a threat, which is most of what
 * makes an attack that seals a border better than one that merely widens it.
 */
function exposure(state, nodeId, dice, playerId, ignoring = null) {
  let worst = 0;
  for (const next of neighbors(state.graph, nodeId)) {
    if (next === ignoring) continue;
    const node = state.nodes.get(next);
    if (node.owner === playerId) continue;
    const chance = holdChance(node.dice, dice);
    if (chance > worst) worst = chance;
  }
  return worst;
}

// `winProbability` between whole stacks, read off in between them for a
// fractional one — which is what a territory holding its dice plus a share of
// the reinforcement still to land amounts to.
function holdChance(rivalDice, dice) {
  const whole = Math.floor(dice);
  const part = dice - whole;
  if (part === 0) return winProbability(rivalDice, whole);
  return winProbability(rivalDice, whole) * (1 - part)
    + winProbability(rivalDice, whole + 1) * part;
}

/**
 * Every attack worth making, best first, each with the score it was ranked on
 * — the expected change in the value of the position, in territories.
 *
 * Every score has the same shape: what winning is worth times how likely that
 * is, plus what losing costs times how likely *that* is, and then the risk the
 * attacker was already under handed back, because that part is not a
 * consequence of attacking. A stack that is about to be taken off the board
 * anyway has little left to lose by spending itself first, and that last term
 * is what says so.
 */
export function expertMovesFor(state, playerId, weights = EXPERT_WEIGHTS) {
  const w = { ...EXPERT_WEIGHTS, ...weights };
  const board = readBoard(state, playerId);
  const moves = [];

  // Each of these is asked about the same territory several times over — once
  // per attacker that can reach it — so each is worked out once.
  const memo = (fn) => {
    const cache = new Map();
    return (id) => {
      if (!cache.has(id)) cache.set(id, fn(id));
      return cache.get(id);
    };
  };
  const takenIncome = memo((to) => incomeAfterTaking(state, board, to, playerId));
  const withoutIt = memo((id) => largestWithout(state, board, id));

  // A counter-attack lands *after* the end of my turn, so what my territories
  // will actually be standing on is what is on them now plus their share of
  // the reinforcement to come. It is the sprawl term: the same income spread
  // over twice the ground is half as much cover, so an empire that has grown
  // thin knows to stop emptying its border.
  const refill = w.refill * (board.income / Math.max(1, board.mine.length));
  const holding = (dice) => Math.min(MAX_DICE_PER_NODE, dice + refill);

  // What losing a territory of mine would cost: the ground, the dice standing
  // on it, and whatever it was holding my largest region together with.
  const costOfLosing = (id, dice) =>
    w.land + w.dice * dice + w.income * (board.income - withoutIt(id));

  for (const from of board.mine) {
    const attacker = state.nodes.get(from);
    if (attacker.dice <= 1) continue;
    const strength = attacker.dice;

    // The attacker ends the fight on a single die whichever way it goes.
    // `emptied` is how exposed that leaves it when the attack *fails* and the
    // target is still a rival; the winning case has to be worked out per
    // target, because the target itself stops being one.
    const emptied = exposure(state, from, holding(1), playerId);
    const spent = costOfLosing(from, 1);
    // And the danger it was in before any of this, which is not a cost of
    // attacking and so is handed back at the end.
    const before = exposure(state, from, holding(strength), playerId)
      * costOfLosing(from, strength);

    for (const to of neighbors(state.graph, from)) {
      if (!isLegalAttack(state, from, to)) continue;
      const defender = state.nodes.get(to);
      const chance = winProbability(strength, defender.dice);

      const gained = takenIncome(to) - board.income;
      const theirLoss = (board.incomeOf.get(defender.owner) ?? 0) - withoutIt(to);
      const lastOfThem = board.holdings.get(defender.owner) === 1;

      // Taking a territory lifts a threat off every one of mine that touches
      // it, not only the one doing the attacking — which is what makes a
      // capture into the middle of my own ground worth more than its size.
      let relieved = 0;
      for (const next of neighbors(state.graph, to)) {
        if (next === from) continue;
        const node = state.nodes.get(next);
        if (node.owner !== playerId) continue;
        const lifted = exposure(state, next, holding(node.dice), playerId)
          - exposure(state, next, holding(node.dice), playerId, to);
        relieved += lifted * costOfLosing(next, node.dice);
      }

      const won =
        w.income * gained
        + w.land
        + w.dice * defender.dice // dice taken off the board along with it
        + w.denial * (w.land + w.income * theirLoss)
        + (lastOfThem ? w.elimination : 0)
        + w.risk * relieved
        // what is left standing: an emptied attacker that no longer has the
        // territory it just took to worry about, and the prize itself, whose
        // loss would hand back the income that made it worth taking
        - w.risk * exposure(state, from, holding(1), playerId, to) * spent
        - w.risk * exposure(state, to, holding(strength - 1), playerId)
          * (w.land + w.dice * (strength - 1) + w.income * gained);

      const lost =
        -w.dice * (strength - 1) // the stack, spent for nothing
        - w.risk * emptied * spent;

      const score = chance * won + (1 - chance) * lost + w.relief * before;
      if (score > w.minGain) moves.push({ from, to, score });
    }
  }

  moves.sort((a, b) => b.score - a.score);
  return moves;
}

/**
 * The hard opponent: it prices every attack available to it and takes the best
 * one while any of them is worth making.
 *
 * Four things separate it from the other two strategies here, in the order
 * they matter:
 *
 * 1. **It plays for income, not for ground.** Reinforcement is paid on the
 *    largest *connected* region, so a territory that joins two regions of ten
 *    is worth twenty of the one that adds an eleventh. Neither of the others
 *    can tell those apart. This one prices both, on both sides of the board:
 *    it will go out of its way to take the territory holding a leader's region
 *    together, because splitting it halves what they earn every turn from then
 *    on.
 * 2. **It knows the real odds.** `battleOdds.js`, not a dice difference: five
 *    against four is a 72% fight and eight against seven is a 67% one, and
 *    calling both "one die up" throws away the judgement that decides close
 *    games.
 * 3. **It counts the counter-attack on both sides of the ledger.** The prize
 *    is netted against what it costs to hold, what the emptied attacker is
 *    worth losing, the threat the capture lifts off everything of mine around
 *    it — and the risk the attacker was under before it moved, which is the
 *    term that turns a doomed stack into a free swing.
 * 4. **It knows what a territory is holding together.** Losing one territory
 *    can cost far more than one die a turn if it was the join between two
 *    halves of a region, so that is priced too — in what it is willing to
 *    risk, and in what it goes looking for.
 *
 * Everything it believes is in `EXPERT_WEIGHTS`, so it can be made greedier or
 * more cautious without touching the reasoning. Deterministic, like
 * `createDefensiveStrategy`: the same board always produces the same move.
 */
export function createExpertStrategy(weights = EXPERT_WEIGHTS) {
  return function expertStrategy(state, playerId) {
    const [best] = expertMovesFor(state, playerId, weights);
    return best ? { from: best.from, to: best.to } : null;
  };
}
