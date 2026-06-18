// ── State ──────────────────────────────────────────────────────────────────
let myPlayer = null;       // 'R' | 'Y'
let gameActive = false;
let currentRoomCode = null;

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

// ── Session persistence (survives reload) ──────────────────────────────────
function saveSession(roomCode, player) {
  sessionStorage.setItem('p4session', JSON.stringify({ roomCode, player }));
}

function clearSession() {
  sessionStorage.removeItem('p4session');
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
  currentRoomCode = code;
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
  const boardEl  = $('board');
  const arrowsEl = $('col-arrows');
  boardEl.innerHTML  = '';
  arrowsEl.innerHTML = '';

  for (let col = 0; col < 7; col++) {
    const btn = document.createElement('button');
    btn.className   = 'col-btn';
    btn.textContent = '▼';
    btn.dataset.col = col;
    btn.setAttribute('aria-label', `Jouer colonne ${col + 1}`);
    btn.addEventListener('click', () => {
      if (!gameActive) return;
      socket.emit('make-move', { col });
    });
    arrowsEl.appendChild(btn);
  }

  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < 7; col++) {
      const cell = document.createElement('div');
      cell.className   = 'cell';
      cell.dataset.row = row;
      cell.dataset.col = col;
      boardEl.appendChild(cell);
    }
  }
}

function renderBoard(board) {
  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < 7; col++) {
      const cell = document.querySelector(`.cell[data-row="${row}"][data-col="${col}"]`);
      if (!cell) continue;
      const val = board[row][col];
      const wasEmpty = !cell.classList.contains('red') && !cell.classList.contains('yellow');
      cell.classList.remove('red', 'yellow', 'win');
      if (val === 'R') {
        cell.classList.add('red');
        if (wasEmpty) void cell.offsetWidth;
      } else if (val === 'Y') {
        cell.classList.add('yellow');
        if (wasEmpty) void cell.offsetWidth;
      }
    }
  }
}

function highlightWin(board, winner) {
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
  document.querySelectorAll('.col-btn').forEach(btn => { btn.disabled = !enabled; });
}

// ── Turn / status UI ───────────────────────────────────────────────────────
function updateTurnUI(currentPlayer) {
  const isMyTurn = currentPlayer === myPlayer;
  $('turn-indicator').textContent = isMyTurn ? 'Ton tour' : 'Adversaire joue…';
  $('badge-r').classList.toggle('active', currentPlayer === 'R');
  $('badge-y').classList.toggle('active', currentPlayer === 'Y');
  setArrowsEnabled(isMyTurn && gameActive);
}

function showGameOver(status, winner, board) {
  gameActive = false;
  setArrowsEnabled(false);

  if (winner) highlightWin(board, winner);

  const isWinner = winner === myPlayer;
  if (status === 'won') {
    $('status-text').textContent = isWinner ? '🏆 Tu as gagné !' : '😞 Tu as perdu.';
  } else {
    $('status-text').textContent = '🤝 Match nul !';
  }

  $('game-status').classList.remove('hidden');
  $('btn-restart').classList.remove('hidden');
  $('btn-restart').disabled = false;
  $('restart-pending').classList.add('hidden');
}

function applyGameState({ board, currentPlayer, yourPlayer, status, winner }) {
  myPlayer   = yourPlayer;
  gameActive = status === 'playing';

  $('badge-r').classList.toggle('you', yourPlayer === 'R');
  $('badge-y').classList.toggle('you', yourPlayer === 'Y');

  $('game-status').classList.add('hidden');
  $('btn-restart').classList.remove('hidden');
  $('btn-restart').disabled = false;
  $('restart-pending').classList.add('hidden');

  clearChat();
  buildBoard();
  renderBoard(board);

  if (status === 'playing') {
    updateTurnUI(currentPlayer);
  } else {
    $('turn-indicator').textContent = '';
    showGameOver(status, winner, board);
  }
}

// ── Restart ────────────────────────────────────────────────────────────────
$('btn-restart').addEventListener('click', () => {
  socket.emit('request-restart');
  $('btn-restart').disabled = true;
  $('restart-pending').classList.remove('hidden');
});

// ── Chat ───────────────────────────────────────────────────────────────────
$('btn-clear-chat').addEventListener('click', () => {
  $('chat-messages').innerHTML = '';
});

$('chat-form').addEventListener('submit', e => {
  e.preventDefault();
  const input = $('chat-input');
  const text  = input.value.trim();
  if (!text) return;
  socket.emit('send-message', { text });
  input.value = '';
});

function appendMessage({ player, text, time }) {
  const mine = player === myPlayer;

  const msg = document.createElement('div');
  msg.className = `msg ${mine ? 'msg-mine' : 'msg-theirs'}`;

  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';
  bubble.textContent = text;

  const meta = document.createElement('span');
  meta.className = 'msg-meta';
  meta.textContent = time;

  msg.appendChild(bubble);
  msg.appendChild(meta);

  const messagesEl = $('chat-messages');
  messagesEl.appendChild(msg);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function clearChat() {
  $('chat-messages').innerHTML = '';
  $('chat-input').value = '';
}

// ── Disconnect overlay helpers ─────────────────────────────────────────────
function showReconnectingOverlay() {
  $('dc-icon').textContent  = '⏳';
  $('dc-title').textContent = 'Connexion interrompue';
  $('dc-msg').textContent   = "L'adversaire se reconnecte… (30 s)";
  $('btn-home').classList.add('hidden');
  $('overlay-disconnect').classList.remove('hidden');
}

function showDisconnectedOverlay() {
  $('dc-icon').textContent  = '⚠️';
  $('dc-title').textContent = 'Adversaire déconnecté';
  $('dc-msg').textContent   = "L'adversaire a quitté la partie.";
  $('btn-home').classList.remove('hidden');
  $('overlay-disconnect').classList.remove('hidden');
}

function hideOverlay() {
  $('overlay-disconnect').classList.add('hidden');
}

$('btn-home').addEventListener('click', () => {
  clearSession();
  location.reload();
});

// ── Socket events ──────────────────────────────────────────────────────────

// Auto-reconnect on (re)connect if a session is saved
socket.on('connect', () => {
  const saved = sessionStorage.getItem('p4session');
  if (!saved) return;
  try {
    const { roomCode, player } = JSON.parse(saved);
    socket.emit('reconnect-room', { code: roomCode, player });
  } catch {
    clearSession();
  }
});

socket.on('room-created', ({ code }) => {
  currentRoomCode = code;
  $('room-code').textContent = code;
  showScreen('waiting');
});

socket.on('game-start', ({ board, currentPlayer, yourPlayer }) => {
  saveSession(currentRoomCode, yourPlayer);
  applyGameState({ board, currentPlayer, yourPlayer, status: 'playing', winner: null });
  showScreen('game');
});

socket.on('reconnect-success', ({ board, currentPlayer, yourPlayer, status, winner, roomCode }) => {
  currentRoomCode = roomCode;
  saveSession(roomCode, yourPlayer);
  hideOverlay();
  applyGameState({ board, currentPlayer, yourPlayer, status, winner });
  showScreen('game');
});

socket.on('reconnect-failed', () => {
  clearSession();
  // Stay on home screen (page already reloaded, showing home by default)
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

socket.on('opponent-reconnecting', () => {
  gameActive = false;
  setArrowsEnabled(false);
  showReconnectingOverlay();
});

socket.on('opponent-reconnected', () => {
  hideOverlay();
  // The reconnected player receives reconnect-success which resets state;
  // we just need to re-enable play for the waiting player
  gameActive = true;
  // Turn indicator will be set correctly by the next game-update or current state
  // Re-read current turn from the server isn't needed — just restore arrows if it's our turn
  // (the server is authoritative; next move will validate anyway)
  const currentTurnBadge = document.querySelector('.player-badge.active');
  const currentTurnPlayer = currentTurnBadge?.id === 'badge-r' ? 'R' : 'Y';
  setArrowsEnabled(currentTurnPlayer === myPlayer);
});

socket.on('player-disconnected', () => {
  gameActive = false;
  setArrowsEnabled(false);
  clearSession();
  showDisconnectedOverlay();
});

socket.on('restart-requested', () => {
  if (!$('game-status').classList.contains('hidden')) {
    $('status-text').textContent += "\nL'adversaire veut rejouer !";
  }
});

socket.on('new-message', (msg) => {
  appendMessage(msg);
});

socket.on('error', ({ message }) => {
  showError(message);
});

socket.on('connect_error', () => {
  showError('Impossible de joindre le serveur. Réessaie.');
});
