// ── State ──────────────────────────────────────────────────────────────────
let myPlayer = null; // 'R' | 'Y'
let gameActive = false;

// ── DOM refs ───────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const screens = {
  home:    $('screen-home'),
  waiting: $('screen-waiting'),
  game:    $('screen-game'),
};

// ── Socket ─────────────────────────────────────────────────────────────────
const socket = io(window.BACKEND_URL, { transports: ['websocket', 'polling'] });

// ── Screen navigation ──────────────────────────────────────────────────────
function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
}

// ── Home screen ────────────────────────────────────────────────────────────
$('btn-create').addEventListener('click', () => {
  clearError();
  socket.emit('create-room');
});

$('btn-join').addEventListener('click', joinRoom);

$('input-code').addEventListener('keydown', e => {
  if (e.key === 'Enter') joinRoom();
});

// Auto-uppercase while typing
$('input-code').addEventListener('input', e => {
  e.target.value = e.target.value.toUpperCase();
});

function joinRoom() {
  const code = $('input-code').value.trim().toUpperCase();
  if (code.length !== 4) {
    showError('Entre un code à 4 lettres.');
    return;
  }
  clearError();
  socket.emit('join-room', { code });
}

function showError(msg) {
  const el = $('error-msg');
  el.textContent = msg;
  el.classList.remove('hidden');
}

function clearError() {
  $('error-msg').classList.add('hidden');
}

// ── Waiting screen ─────────────────────────────────────────────────────────
$('btn-copy').addEventListener('click', () => {
  const code = $('room-code').textContent;
  navigator.clipboard.writeText(code).then(() => {
    $('btn-copy').textContent = 'Copié !';
    setTimeout(() => { $('btn-copy').textContent = 'Copier le code'; }, 2000);
  });
});

// ── Game board ─────────────────────────────────────────────────────────────
function buildBoard() {
  const boardEl   = $('board');
  const arrowsEl  = $('col-arrows');
  boardEl.innerHTML  = '';
  arrowsEl.innerHTML = '';

  // Arrow buttons (one per column)
  for (let col = 0; col < 7; col++) {
    const btn = document.createElement('button');
    btn.className    = 'col-btn';
    btn.textContent  = '▼';
    btn.dataset.col  = col;
    btn.setAttribute('aria-label', `Jouer colonne ${col + 1}`);
    btn.addEventListener('click', () => {
      if (!gameActive) return;
      socket.emit('make-move', { col });
    });
    arrowsEl.appendChild(btn);
  }

  // 6 × 7 cells
  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < 7; col++) {
      const cell = document.createElement('div');
      cell.className       = 'cell';
      cell.dataset.row     = row;
      cell.dataset.col     = col;
      boardEl.appendChild(cell);
    }
  }
}

function renderBoard(board) {
  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < 7; col++) {
      const cell = document.querySelector(`.cell[data-row="${row}"][data-col="${col}"]`);
      if (!cell) continue;
      // Re-attach animation by cloning
      const val = board[row][col];
      const wasEmpty = !cell.classList.contains('red') && !cell.classList.contains('yellow');

      cell.classList.remove('red', 'yellow', 'win');
      if (val === 'R') {
        cell.classList.add('red');
        if (wasEmpty) void cell.offsetWidth; // reflow to restart animation
      } else if (val === 'Y') {
        cell.classList.add('yellow');
        if (wasEmpty) void cell.offsetWidth;
      }
    }
  }
}

function highlightWin(board, winner) {
  // Walk the board to find 4-in-a-row belonging to winner
  const ROWS = 6, COLS = 7;
  const dirs = [[0,1],[1,0],[1,1],[1,-1]];
  const winning = new Set();

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (board[r][c] !== winner) continue;
      for (const [dr, dc] of dirs) {
        const cells = [[r, c]];
        for (let i = 1; i < 4; i++) {
          const nr = r + dr * i, nc = c + dc * i;
          if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS || board[nr][nc] !== winner) break;
          cells.push([nr, nc]);
        }
        if (cells.length === 4) cells.forEach(([row, col]) => winning.add(`${row}-${col}`));
      }
    }
  }

  winning.forEach(key => {
    const [row, col] = key.split('-');
    document.querySelector(`.cell[data-row="${row}"][data-col="${col}"]`)?.classList.add('win');
  });
}

function setArrowsEnabled(enabled) {
  document.querySelectorAll('.col-btn').forEach(btn => {
    btn.disabled = !enabled;
  });
}

// ── Turn / status UI ───────────────────────────────────────────────────────
function updateTurnUI(currentPlayer) {
  const isMyTurn = currentPlayer === myPlayer;
  const turnEl   = $('turn-indicator');
  turnEl.textContent = isMyTurn ? 'Ton tour' : 'Adversaire joue…';

  $('badge-r').classList.toggle('active', currentPlayer === 'R');
  $('badge-y').classList.toggle('active', currentPlayer === 'Y');

  setArrowsEnabled(isMyTurn && gameActive);
}

function showGameOver(status, winner, board) {
  gameActive = false;
  setArrowsEnabled(false);

  if (winner) highlightWin(board, winner);

  const isWinner = winner === myPlayer;
  const statusEl = $('status-text');

  if (status === 'won') {
    statusEl.textContent = isWinner ? '🏆 Tu as gagné !' : '😞 Tu as perdu.';
  } else {
    statusEl.textContent = '🤝 Match nul !';
  }

  $('game-status').classList.remove('hidden');
  $('btn-restart').classList.remove('hidden');
  $('restart-pending').classList.add('hidden');
}

// ── Restart ────────────────────────────────────────────────────────────────
$('btn-restart').addEventListener('click', () => {
  socket.emit('request-restart');
  $('btn-restart').disabled = true;
  $('restart-pending').classList.remove('hidden');
});

// ── Disconnect overlay ─────────────────────────────────────────────────────
$('btn-home').addEventListener('click', () => {
  location.reload();
});

// ── Socket events ──────────────────────────────────────────────────────────
socket.on('room-created', ({ code }) => {
  $('room-code').textContent = code;
  showScreen('waiting');
});

socket.on('game-start', ({ board, currentPlayer, yourPlayer }) => {
  myPlayer   = yourPlayer;
  gameActive = true;

  // Label "moi" on the right badge
  $('badge-r').classList.toggle('you', yourPlayer === 'R');
  $('badge-y').classList.toggle('you', yourPlayer === 'Y');

  // Hide status banner & reset restart button
  $('game-status').classList.add('hidden');
  $('btn-restart').classList.remove('hidden');
  $('btn-restart').disabled = false;
  $('restart-pending').classList.add('hidden');

  buildBoard();
  renderBoard(board);
  updateTurnUI(currentPlayer);
  showScreen('game');
});

socket.on('game-update', ({ board, currentPlayer, status, winner }) => {
  renderBoard(board);

  if (status === 'playing') {
    updateTurnUI(currentPlayer);
  } else {
    $('turn-indicator').textContent = '';
    showGameOver(status, winner, board);
  }
});

socket.on('restart-requested', () => {
  // The other player wants a rematch — show the button if game is over
  if (!$('game-status').classList.contains('hidden')) {
    $('status-text').textContent += '\nL\'adversaire veut rejouer !';
  }
});

socket.on('restart-vote-sent', () => {
  // Confirmation that vote was received (already handled in click handler)
});

socket.on('player-disconnected', () => {
  gameActive = false;
  setArrowsEnabled(false);
  $('overlay-disconnect').classList.remove('hidden');
});

socket.on('error', ({ message }) => {
  showError(message);
});

socket.on('connect_error', () => {
  showError('Impossible de joindre le serveur. Réessaie.');
});
