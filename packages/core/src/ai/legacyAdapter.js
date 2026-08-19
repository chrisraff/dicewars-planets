import { neighbors } from '../graph.js';
import { getPlayerNodeIds, largestConnectedRegionSize } from '../state.js';

const LEGACY_MIN_PLAYER_SLOTS = 8; // ai_default.js hardcodes `for (i=0; i<8; i++)`

/**
 * Wraps a classic dicewars-js AI — `function ai(game) { ... }`, called
 * repeatedly during its turn, writing `game.area_from`/`game.area_to` and
 * returning `0` to stop — as a native core Strategy: `(state, playerId) =>
 * {from, to} | null`. See runAiTurn.js for the native protocol.
 *
 * Node/player identity is assumed stable for the lifetime of the returned
 * strategy (true for core: nodes and player slots are never added/removed
 * mid-game, only owner/dice/adjacency change), so the 1-based legacy index
 * tables are built once, on first use, and reused for every later call.
 */
export function wrapLegacyAi(legacyFn) {
  let nodeOrder = null; // index i (1-based) -> nodeId
  let nodeIndex = null; // nodeId -> index i
  let playerOrder = null; // legacy index (0-based) -> playerId | undefined

  function ensureIndexes(state) {
    if (nodeOrder) return;
    nodeOrder = [...state.nodes.keys()];
    nodeIndex = new Map(nodeOrder.map((id, i) => [id, i + 1]));
    playerOrder = [...state.turnOrder];
  }

  function buildAreaData(state) {
    const AREA_MAX = nodeOrder.length + 1;
    const adat = new Array(AREA_MAX);
    adat[0] = { size: 0, arm: -1, dice: 0, join: new Array(AREA_MAX).fill(0) };

    for (let i = 1; i < AREA_MAX; i++) {
      const nodeId = nodeOrder[i - 1];
      const node = state.nodes.get(nodeId);
      const join = new Array(AREA_MAX).fill(0);
      for (const n of neighbors(state.graph, nodeId)) {
        join[nodeIndex.get(n)] = 1;
      }
      adat[i] = {
        size: 1,
        arm: playerOrder.indexOf(node.owner),
        dice: node.dice,
        join,
      };
    }
    return adat;
  }

  function buildPlayerData(state) {
    const slots = Math.max(LEGACY_MIN_PLAYER_SLOTS, playerOrder.length);
    const player = new Array(slots);

    const diceCounts = playerOrder.map(
      (id) => id === undefined
        ? 0
        : getPlayerNodeIds(state, id).reduce((sum, nid) => sum + state.nodes.get(nid).dice, 0)
    );
    // dice_jun: rank by total dice, highest first (ties keep original order) —
    // mirrors the original's bubble-sort-by-rank behaviour.
    const rank = diceCounts.map((_, i) => i);
    rank.sort((a, b) => diceCounts[b] - diceCounts[a]);
    const diceJun = new Array(playerOrder.length);
    rank.forEach((playerIdx, place) => { diceJun[playerIdx] = place; });

    for (let i = 0; i < slots; i++) {
      const id = playerOrder[i];
      if (id === undefined) {
        player[i] = { area_c: 0, dice_c: 0, dice_jun: i, area_tc: 0, stock: 0 };
        continue;
      }
      player[i] = {
        area_c: getPlayerNodeIds(state, id).length,
        dice_c: diceCounts[i],
        dice_jun: diceJun[i],
        area_tc: largestConnectedRegionSize(state, id),
        stock: state.players.get(id).reserve,
      };
    }
    return player;
  }

  return function legacyStrategy(state, playerId) {
    ensureIndexes(state);

    const pn = playerOrder.indexOf(playerId);
    const game = {
      AREA_MAX: nodeOrder.length + 1,
      adat: buildAreaData(state),
      player: buildPlayerData(state),
      jun: [pn],
      ban: 0,
      get_pn: () => pn,
      area_from: undefined,
      area_to: undefined,
    };

    const ret = legacyFn(game);
    if (ret === 0) return null;

    const { area_from, area_to } = game;
    if (
      !Number.isInteger(area_from) || !Number.isInteger(area_to) ||
      area_from < 1 || area_from >= game.AREA_MAX ||
      area_to < 1 || area_to >= game.AREA_MAX
    ) {
      throw new Error(
        `legacy AI did not return 0 but left area_from/area_to invalid: ${area_from} -> ${area_to}`
      );
    }

    return { from: nodeOrder[area_from - 1], to: nodeOrder[area_to - 1] };
  };
}
