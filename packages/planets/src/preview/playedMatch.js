import {
  createExpertStrategy,
  createInitialState,
  createSimpleStrategy,
  livingPlayerIds,
  runAiTurn,
  seededRng,
} from '@dicewars/core';
import { generatePlanetWorld } from '../world/generateWorld.js';

/**
 * A whole match, played out, as the board after every turn.
 *
 * Shared by the two rigs that want to look at a game rather than play one —
 * the GIF page and the stills page — because they want exactly the same thing
 * and a second copy of it would drift. Everything is the real rules:
 * `runAiTurn` is the game playing itself, and the only chance in it is the
 * dice and the scatter, both seeded here.
 *
 * Two seeds, and keeping them apart is the point. `seed` grows the planet and
 * `play` fights over it, so the same world can be fought over differently and
 * the same fight can be moved to another world. One seed for both would make
 * every interesting board a coincidence you could not chase.
 *
 * The boards are kept rather than the moves. A frame — or a still — is a whole
 * board, and playing the match once is cheaper than rebuilding each board from
 * a log every time somebody drags a scrubber.
 */
export const MATCH_PLAYERS = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'];

export function playedMatch({
  seed,
  play,
  players = 4,
  difficulty = 'expert',
  turns = 200,
  subdivisions = 3,
}) {
  const ids = MATCH_PLAYERS.slice(0, players);
  const world = generatePlanetWorld({ subdivisions, playerIds: ids, rng: seededRng(seed) });

  const roll = seededRng(play);
  const deps = { rollDie: () => 1 + Math.floor(roll() * 6), rng: seededRng(play + 1) };
  const strategy = difficulty === 'expert'
    ? createExpertStrategy()
    : createSimpleStrategy({ rng: seededRng(play + 2) });

  let state = createInitialState({ ...world, turnOrder: ids });
  const boards = [state.nodes];

  for (let turn = 0; turn < turns; turn++) {
    if (state.phase === 'gameover') break;
    state = runAiTurn(state, strategy, deps).state;
    boards.push(state.nodes);
  }

  return {
    world,
    ids,
    boards,
    over: state.phase === 'gameover',
    left: livingPlayerIds(state).length,
  };
}
