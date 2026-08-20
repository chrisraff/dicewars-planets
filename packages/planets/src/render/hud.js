// The DOM layer over the canvas: whose turn it is, the end-turn button, the
// roll totals that float over a fight, and the game-over banner. Kept in HTML
// rather than drawn into the scene because text in WebGL is a lot of work for
// no gain when it's always facing the camera anyway.

const cssColor = ([r, g, b]) =>
  `rgb(${[r, g, b].map((c) => Math.round(c * 255)).join(', ')})`;

export function createHud(root, { playerColors, playerNames = new Map() } = {}) {
  root.innerHTML = `
    <div class="hud-bar">
      <span class="hud-turn"><i class="hud-dot"></i><span class="hud-turn-text"></span></span>
      <button class="hud-end-turn" type="button">End turn</button>
    </div>
    <div class="hud-roll hud-roll-attacker"></div>
    <div class="hud-roll hud-roll-defender"></div>
    <div class="hud-banner"></div>
  `;

  const dot = root.querySelector('.hud-dot');
  const turnText = root.querySelector('.hud-turn-text');
  const endTurnButton = root.querySelector('.hud-end-turn');
  const banner = root.querySelector('.hud-banner');
  const rolls = {
    attacker: root.querySelector('.hud-roll-attacker'),
    defender: root.querySelector('.hud-roll-defender'),
  };

  const nameOf = (playerId) => playerNames.get(playerId) ?? playerId;

  return {
    onEndTurn(handler) {
      endTurnButton.addEventListener('click', handler);
    },

    showTurn({ playerId, isHuman, canAct }) {
      dot.style.background = cssColor(playerColors.get(playerId) ?? [1, 1, 1]);
      turnText.textContent = isHuman ? 'Your turn' : `${nameOf(playerId)} is playing`;
      endTurnButton.disabled = !canAct;
      endTurnButton.style.visibility = isHuman ? 'visible' : 'hidden';
    },

    // `side` is 'attacker' or 'defender'; `screen` is a pixel position on the
    // canvas, or null to hide the label.
    showRoll(side, { total, screen, winning } = {}) {
      const element = rolls[side];
      if (!screen || total === undefined) {
        element.style.display = 'none';
        return;
      }
      element.style.display = 'block';
      element.style.left = `${screen.x}px`;
      element.style.top = `${screen.y}px`;
      element.textContent = String(total);
      element.classList.toggle('is-winning', Boolean(winning));
    },

    hideRolls() {
      this.showRoll('attacker');
      this.showRoll('defender');
    },

    showWinner(playerId) {
      banner.textContent = playerId ? `${nameOf(playerId)} wins` : 'Nobody wins';
      banner.style.color = cssColor(playerColors.get(playerId) ?? [1, 1, 1]);
      banner.classList.add('is-shown');
    },
  };
}
