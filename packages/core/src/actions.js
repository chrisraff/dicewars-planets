export const attack = (from, to) => ({ type: 'ATTACK', from, to });
export const endTurn = () => ({ type: 'END_TURN' });

// Dynamic-topology hook (moving moon, or any world that reshapes itself
// between rounds). `patch` is an iterable of [nodeId, neighborIds].
export const updateAdjacency = (patch) => ({ type: 'UPDATE_ADJACENCY', patch });
