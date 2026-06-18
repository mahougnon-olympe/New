// ── État global ─────────────────────────────────────────────────────────────
let myPlayer        = null;   // 'R' | 'Y'
let gameActive      = false;
let currentRoomCode = null;
let currentGame     = null;   // 'connect4' | 'tictactoe' | 'chess'
let selectedGameType = 'connect4';
let currentTurnPlayer = null;

// État échecs
let selectedSquare  = null;
let availableMoves  = [];
let currentFen      = null;
let lastMove        = null;   // { from, to }
let pendingPromoMove = null;

// ── DOM refs ─────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

// ── Socket ───────────────────────────────────────────────────────────────────
const socket = io(window.BACKEND_URL, { transports: ['websocket', 'polling'] });

// ── Navigation ───────────────────────────────────────────────────────────────
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById('screen-' + name);
  if (el) el.classList.add('active');
}

// ── Trivia : constantes ───────────────────────────────────────────────────────
const TRIVIA_CATS = [
  { id: 9,  name: 'Culture G.', icon: '🧠' },
  { id: 23, name: 'Histoire',   icon: '📜' },
  { id: 22, name: 'Géographie', icon: '🌍' },
  { id: 17, name: 'Sciences',   icon: '🔬' },
  { id: 21, name: 'Sports',     icon: '⚽' },
  { id: 11, name: 'Cinéma',     icon: '🎬' },
  { id: 12, name: 'Musique',    icon: '🎵' },
  { id: 14, name: 'Télévision', icon: '📺' },
  { id: 19, name: 'Maths',      icon: '🔢' },
  { id: 20, name: 'Info',       icon: '💻' },
  { id: 25, name: 'Arts',       icon: '🎨' },
  { id: 27, name: 'Animaux',    icon: '🐾' },
];
const TRIVIA_COLORS = ['#2563eb','#dc2626','#16a34a','#9333ea','#ea580c','#0891b2'];

// ── Trivia : état ─────────────────────────────────────────────────────────────
let selectedTriviaCategory = null;
let triviaRoomCode         = null;
let triviaIsHost           = false;
let triviaIsSolo           = false;
let triviaAnsweredThis     = false;
let triviaChoiceSelected   = null;
let triviaTimerInterval    = null;
let triviaQuestions        = [];
let triviaCurrentQ         = 0;
let triviaScore            = 0;
let triviaMySocketId       = null;

// ── Données par type de jeu ──────────────────────────────────────────────────
const GAME_NAMES  = { connect4: 'Puissance 4', tictactoe: 'Tic Tac Toe', chess: 'Échecs' };
const PLAYER_ICONS = {
  connect4:  { R: '🔴', Y: '🟡' },
  tictactoe: { R: '✕',  Y: '○' },
  chess:     { R: '♔',  Y: '♚' },
};
const PLAYER_NAMES = {
  connect4:  { R: 'Rouge',   Y: 'Jaune'  },
  tictactoe: { R: 'Croix',   Y: 'Rond'   },
  chess:     { R: 'Blancs',  Y: 'Noirs'  },
};

// ── Landing ───────────────────────────────────────────────────────────────────
$('btn-go-classic').addEventListener('click', () => showScreen('home'));
$('btn-go-trivia').addEventListener('click',  () => { buildTriviaThemes(); showScreen('trivia-home'); socket.emit('get-trivia-leaderboard'); });
$('btn-back-classic').addEventListener('click', () => showScreen('landing'));

// ── Pseudo ────────────────────────────────────────────────────────────────────
$('input-name').value = localStorage.getItem('playerName') || '';
$('input-name').addEventListener('input', e => {
  localStorage.setItem('playerName', e.target.value.trim());
});
function getPlayerName() { return ($('input-name').value.trim()) || ''; }

// ── Sélecteur de jeu (accueil) ───────────────────────────────────────────────
document.querySelectorAll('.game-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.game-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedGameType = btn.dataset.game;
  });
});

// ── Accueil ──────────────────────────────────────────────────────────────────
$('btn-create').addEventListener('click', () => {
  clearError();
  socket.emit('create-room', { gameType: selectedGameType, name: getPlayerName() });
});

$('btn-join').addEventListener('click', joinRoom);
$('input-code').addEventListener('keydown', e => { if (e.key === 'Enter') joinRoom(); });
$('input-code').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase(); });

function joinRoom() {
  const code = $('input-code').value.trim().toUpperCase();
  if (code.length !== 4) { showError('Entre un code à 4 lettres.'); return; }
  clearError();
  currentRoomCode = code;
  socket.emit('join-room', { code, name: getPlayerName() });
}

function showError(msg) { const e = $('error-msg'); e.textContent = msg; e.classList.remove('hidden'); }
function clearError()   { $('error-msg').classList.add('hidden'); }

// ── Session (reload) ──────────────────────────────────────────────────────────
function saveSession(code, player) {
  sessionStorage.setItem('p4session', JSON.stringify({ roomCode: code, player }));
}
function clearSession() { sessionStorage.removeItem('p4session'); }

// ── Attente ───────────────────────────────────────────────────────────────────
$('btn-copy').addEventListener('click', () => {
  navigator.clipboard.writeText($('room-code').textContent).then(() => {
    $('btn-copy').textContent = 'Copié !';
    setTimeout(() => { $('btn-copy').textContent = 'Copier le code'; }, 2000);
  });
});

// ── Header joueurs ────────────────────────────────────────────────────────────
function setPlayerBadges(gameType, yourPlayer) {
  const icons = PLAYER_ICONS[gameType];
  const names = PLAYER_NAMES[gameType];
  $('badge-r-icon').textContent = icons.R;
  $('badge-y-icon').textContent = icons.Y;
  $('label-r').textContent = names.R;
  $('label-y').textContent = names.Y;
  $('badge-r').classList.toggle('you', yourPlayer === 'R');
  $('badge-y').classList.toggle('you', yourPlayer === 'Y');
}

function updateTurnUI(currentPlayer, gameType) {
  currentTurnPlayer = currentPlayer;
  const isMyTurn = currentPlayer === myPlayer;
  $('turn-indicator').textContent = isMyTurn ? 'Ton tour' : 'Adversaire joue…';
  $('badge-r').classList.toggle('active', currentPlayer === 'R');
  $('badge-y').classList.toggle('active', currentPlayer === 'Y');

  // Activer/désactiver les contrôles selon le jeu
  if (gameType === 'connect4') setArrowsEnabled(isMyTurn && gameActive);
  if (gameType === 'tictactoe') setTTTEnabled(isMyTurn && gameActive);
  // Chess : géré par selectedSquare + clic
}

// ── Retour au menu principal ──────────────────────────────────────────────────
function goToHome() {
  socket.emit('leave-room');
  clearSession();

  myPlayer = null;
  gameActive = false;
  currentRoomCode = null;
  currentGame = null;
  currentTurnPlayer = null;
  selectedSquare = null;
  availableMoves = [];
  currentFen = null;
  lastMove = null;
  pendingPromoMove = null;

  $('board-area').innerHTML = '';
  $('game-status').classList.add('hidden');
  $('overlay-disconnect').classList.add('hidden');
  $('overlay-promotion').classList.add('hidden');
  clearChat();
  clearError();
  showScreen('home');
}

// ── Fin de partie ─────────────────────────────────────────────────────────────
function showGameOver(status, winner) {
  gameActive = false;
  if (currentGame === 'connect4') setArrowsEnabled(false);
  if (currentGame === 'tictactoe') setTTTEnabled(false);

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
  $('btn-menu').classList.remove('hidden');
}

// ── Appliquer l'état de jeu (game-start / reconnect-success) ─────────────────
function applyGameState({ gameType, state, yourPlayer, status, winner }) {
  currentGame = gameType;
  myPlayer    = yourPlayer;
  gameActive  = status === 'playing';
  currentTurnPlayer = state.currentPlayer;

  setPlayerBadges(gameType, yourPlayer);
  $('game-status').classList.add('hidden');
  $('btn-restart').classList.remove('hidden');
  $('btn-restart').disabled = false;
  $('restart-pending').classList.add('hidden');
  $('btn-menu').classList.add('hidden');

  clearChat();
  buildGameBoard(gameType, state, yourPlayer);

  if (status === 'playing') {
    updateTurnUI(state.currentPlayer, gameType);
  } else {
    $('turn-indicator').textContent = '';
    showGameOver(status, winner);
  }
}

// ── Construction du plateau selon le type de jeu ──────────────────────────────
function buildGameBoard(gameType, state, yourPlayer) {
  const area = $('board-area');
  area.innerHTML = '';
  selectedSquare = null;
  availableMoves = [];

  switch (gameType) {
    case 'connect4':  buildConnect4(area, state.board); break;
    case 'tictactoe': buildTTT(area, state.board);      break;
    case 'chess':     buildChess(area, state, yourPlayer); break;
  }
}

function updateGameBoard(gameType, state) {
  switch (gameType) {
    case 'connect4':  updateConnect4(state.board);                          break;
    case 'tictactoe': updateTTT(state.board, state.winLine);                break;
    case 'chess':     updateChess(state.fen, state.isCheck, state.currentPlayer); break;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// PUISSANCE 4
// ══════════════════════════════════════════════════════════════════════════════
function buildConnect4(container, board) {
  const arrows = document.createElement('div');
  arrows.id = 'col-arrows';
  arrows.className = 'col-arrows';

  for (let col = 0; col < 7; col++) {
    const btn = document.createElement('button');
    btn.className = 'col-btn';
    btn.textContent = '▼';
    btn.dataset.col = col;
    btn.setAttribute('aria-label', `Jouer colonne ${col + 1}`);
    btn.addEventListener('click', () => { if (gameActive) socket.emit('make-move', { col }); });
    arrows.appendChild(btn);
  }

  const boardEl = document.createElement('div');
  boardEl.id = 'c4-board';
  boardEl.className = 'c4-board';

  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < 7; col++) {
      const cell = document.createElement('div');
      cell.className = 'c4-cell';
      cell.dataset.row = row;
      cell.dataset.col = col;
      boardEl.appendChild(cell);
    }
  }

  container.appendChild(arrows);
  container.appendChild(boardEl);
  updateConnect4(board);
}

function updateConnect4(board) {
  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < 7; col++) {
      const cell = document.querySelector(`.c4-cell[data-row="${row}"][data-col="${col}"]`);
      if (!cell) continue;
      const val = board[row][col];
      const wasEmpty = !cell.classList.contains('red') && !cell.classList.contains('yellow');
      cell.classList.remove('red', 'yellow', 'win');
      if (val === 'R') { cell.classList.add('red');    if (wasEmpty) void cell.offsetWidth; }
      if (val === 'Y') { cell.classList.add('yellow'); if (wasEmpty) void cell.offsetWidth; }
    }
  }
}

function highlightConnect4Win(board, winner) {
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
  winning.forEach(k => {
    const [row, col] = k.split('-');
    document.querySelector(`.c4-cell[data-row="${row}"][data-col="${col}"]`)?.classList.add('win');
  });
}

function setArrowsEnabled(enabled) {
  document.querySelectorAll('.col-btn').forEach(b => { b.disabled = !enabled; });
}

// ══════════════════════════════════════════════════════════════════════════════
// TIC TAC TOE
// ══════════════════════════════════════════════════════════════════════════════
function buildTTT(container, board) {
  const boardEl = document.createElement('div');
  boardEl.className = 'ttt-board';

  for (let i = 0; i < 9; i++) {
    const cell = document.createElement('div');
    cell.className = 'ttt-cell';
    cell.dataset.idx = i;
    cell.addEventListener('click', () => {
      if (!gameActive || cell.classList.contains('played')) return;
      socket.emit('make-move', { cell: i });
    });
    boardEl.appendChild(cell);
  }

  container.appendChild(boardEl);
  updateTTT(board, null);
}

function updateTTT(board, winLine) {
  document.querySelectorAll('.ttt-cell').forEach((cell, i) => {
    cell.classList.remove('ttt-r', 'ttt-y', 'played', 'win-cell');
    const val = board[i];
    if (val === 'R') { cell.textContent = '✕'; cell.classList.add('ttt-r', 'played'); }
    else if (val === 'Y') { cell.textContent = '○'; cell.classList.add('ttt-y', 'played'); }
    else { cell.textContent = ''; }
    if (winLine?.includes(i)) cell.classList.add('win-cell');
  });
}

function setTTTEnabled(enabled) {
  document.querySelectorAll('.ttt-cell').forEach(c => {
    c.style.cursor = (enabled && !c.classList.contains('played')) ? 'pointer' : 'default';
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// ÉCHECS
// ══════════════════════════════════════════════════════════════════════════════
const CHESS_UNICODE = {
  K:'♔', Q:'♕', R:'♖', B:'♗', N:'♘', P:'♙',
  k:'♚', q:'♛', r:'♜', b:'♝', n:'♞', p:'♟',
};

function parseFenBoard(fen) {
  const board = {};
  const ranks = fen.split(' ')[0].split('/');
  for (let ri = 0; ri < 8; ri++) {
    let fi = 0;
    for (const ch of ranks[ri]) {
      if (isNaN(ch)) {
        board[`${String.fromCharCode(97 + fi)}${8 - ri}`] = ch;
        fi++;
      } else { fi += parseInt(ch); }
    }
  }
  return board;
}

function isPawnPromotion(from, to, fenBoard) {
  const piece = fenBoard[from];
  if (piece === 'P' && to[1] === '8') return true;
  if (piece === 'p' && to[1] === '1') return true;
  return false;
}

function buildChess(container, state, yourPlayer) {
  currentFen = state.fen;
  lastMove   = null;
  const flipped = yourPlayer === 'Y';

  // Rangée de labels de fichiers (a-h)
  function makeFilesRow(flipped) {
    const row = document.createElement('div');
    row.style.cssText = `display:grid;grid-template-columns:16px repeat(8,var(--chess-cell)) 16px;`;
    row.appendChild(document.createElement('span'));
    for (let c = 0; c < 8; c++) {
      const fi = flipped ? 7 - c : c;
      const span = document.createElement('span');
      span.className = 'chess-coord';
      span.textContent = String.fromCharCode(97 + fi);
      row.appendChild(span);
    }
    row.appendChild(document.createElement('span'));
    return row;
  }

  // Ligne centrale (rangs + plateau + rangs)
  const midRow = document.createElement('div');
  midRow.style.cssText = 'display:grid;grid-template-columns:16px auto 16px;align-items:center;';

  const leftRanks  = document.createElement('div');
  leftRanks.style.cssText = `display:grid;grid-template-rows:repeat(8,var(--chess-cell));`;
  const rightRanks = leftRanks.cloneNode();

  for (let r = 0; r < 8; r++) {
    const rank = flipped ? r + 1 : 8 - r;
    const mkSpan = () => {
      const s = document.createElement('span');
      s.className = 'chess-coord';
      s.textContent = rank;
      return s;
    };
    leftRanks.appendChild(mkSpan());
    rightRanks.appendChild(mkSpan());
  }

  const boardEl = document.createElement('div');
  boardEl.id = 'chess-board';
  boardEl.className = 'chess-board';

  for (let gridRow = 0; gridRow < 8; gridRow++) {
    for (let gridCol = 0; gridCol < 8; gridCol++) {
      const rank    = flipped ? gridRow + 1 : 8 - gridRow;
      const fileIdx = flipped ? 7 - gridCol : gridCol;
      const square  = `${String.fromCharCode(97 + fileIdx)}${rank}`;
      const isLight = (gridRow + gridCol) % 2 === 0;

      const sq = document.createElement('div');
      sq.className = `chess-sq ${isLight ? 'light' : 'dark'}`;
      sq.dataset.sq = square;
      sq.addEventListener('click', () => onChessClick(square));
      boardEl.appendChild(sq);
    }
  }

  midRow.appendChild(leftRanks);
  midRow.appendChild(boardEl);
  midRow.appendChild(rightRanks);

  const wrapper = document.createElement('div');
  wrapper.className = 'chess-wrapper';
  wrapper.appendChild(makeFilesRow(flipped));
  wrapper.appendChild(midRow);
  wrapper.appendChild(makeFilesRow(flipped));

  container.appendChild(wrapper);
  updateChess(state.fen, state.isCheck, state.currentPlayer);
}

function updateChess(fen, isCheck, currentPlayer) {
  currentFen = fen;
  const fenBoard = parseFenBoard(fen);

  document.querySelectorAll('.chess-sq').forEach(sq => {
    const square = sq.dataset.sq;
    const piece  = fenBoard[square];

    // Réinitialiser
    sq.classList.remove('selected', 'can-move', 'has-piece', 'in-check', 'last-move');

    // Pièce
    sq.textContent = piece ? CHESS_UNICODE[piece] : '';

    // Dernier coup
    if (lastMove && (square === lastMove.from || square === lastMove.to)) {
      sq.classList.add('last-move');
    }

    // Roi en échec
    if (isCheck) {
      const kingPiece = currentPlayer === 'R' ? 'K' : 'k';
      if (piece === kingPiece) sq.classList.add('in-check');
    }
  });

  // Re-appliquer la sélection si une case est encore sélectionnée
  if (selectedSquare) {
    document.querySelector(`.chess-sq[data-sq="${selectedSquare}"]`)?.classList.add('selected');
    availableMoves.forEach(mv => {
      const el = document.querySelector(`.chess-sq[data-sq="${mv}"]`);
      if (el) {
        el.classList.add('can-move');
        if (el.textContent) el.classList.add('has-piece');
      }
    });
  }
}

function clearChessSelection() {
  selectedSquare = null;
  availableMoves = [];
  document.querySelectorAll('.chess-sq.selected, .chess-sq.can-move, .chess-sq.has-piece').forEach(el => {
    el.classList.remove('selected', 'can-move', 'has-piece');
  });
}

function onChessClick(square) {
  if (!gameActive || currentTurnPlayer !== myPlayer) return;

  // Clic sur une case cible → jouer le coup
  if (selectedSquare && availableMoves.includes(square)) {
    const from = selectedSquare;
    const to   = square;
    clearChessSelection();

    const fenBoard = parseFenBoard(currentFen);
    if (isPawnPromotion(from, to, fenBoard)) {
      pendingPromoMove = { from, to };
      showPromoModal(myPlayer);
    } else {
      lastMove = { from, to };
      socket.emit('make-move', { from, to });
    }
    return;
  }

  // Clic sur une pièce → sélectionner
  clearChessSelection();
  const fenBoard = parseFenBoard(currentFen);
  const piece = fenBoard[square];
  if (!piece) return;

  // Vérifier que c'est bien notre pièce
  const isWhitePiece = piece === piece.toUpperCase();
  if ((myPlayer === 'R') !== isWhitePiece) return;

  selectedSquare = square;
  document.querySelector(`.chess-sq[data-sq="${square}"]`)?.classList.add('selected');
  socket.emit('get-moves', { square });
}

// ── Promotion du pion ─────────────────────────────────────────────────────────
function showPromoModal(player) {
  const choices = [
    { piece: 'q', icon: player === 'R' ? '♕' : '♛', label: 'Dame' },
    { piece: 'r', icon: player === 'R' ? '♖' : '♜', label: 'Tour' },
    { piece: 'b', icon: player === 'R' ? '♗' : '♝', label: 'Fou' },
    { piece: 'n', icon: player === 'R' ? '♘' : '♞', label: 'Cavalier' },
  ];

  const container = $('promo-choices');
  container.innerHTML = '';
  choices.forEach(({ piece, icon, label }) => {
    const btn = document.createElement('button');
    btn.className = 'promo-btn';
    btn.innerHTML = `${icon}<span>${label}</span>`;
    btn.addEventListener('click', () => {
      $('overlay-promotion').classList.add('hidden');
      if (pendingPromoMove) {
        lastMove = { ...pendingPromoMove };
        socket.emit('make-move', { ...pendingPromoMove, promotion: piece });
        pendingPromoMove = null;
      }
    });
    container.appendChild(btn);
  });

  $('overlay-promotion').classList.remove('hidden');
}

// ── Rejouer ───────────────────────────────────────────────────────────────────
$('btn-restart').addEventListener('click', () => {
  socket.emit('request-restart');
  $('btn-restart').disabled = true;
  $('restart-pending').classList.remove('hidden');
});

// ── Chat ──────────────────────────────────────────────────────────────────────
$('btn-clear-chat').addEventListener('click', () => { $('chat-messages').innerHTML = ''; });

$('chat-form').addEventListener('submit', e => {
  e.preventDefault();
  const input = $('chat-input');
  const text  = input.value.trim();
  if (!text) return;
  socket.emit('send-message', { text });
  input.value = '';
});

function appendMessage({ player, text, timestamp }) {
  const time = new Date(timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const mine = player === myPlayer;
  const msg  = document.createElement('div');
  msg.className = `msg ${mine ? 'msg-mine' : 'msg-theirs'}`;

  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';
  bubble.textContent = text;

  const meta = document.createElement('span');
  meta.className = 'msg-meta';
  meta.textContent = time;

  msg.appendChild(bubble);
  msg.appendChild(meta);

  const el = $('chat-messages');
  el.appendChild(msg);
  el.scrollTop = el.scrollHeight;
}

function clearChat() {
  $('chat-messages').innerHTML = '';
  $('chat-input').value = '';
}

// ── Classement ────────────────────────────────────────────────────────────────
function renderLeaderboard(data) {
  const list = $('leaderboard-list');
  if (!data || data.length === 0) {
    list.innerHTML = '<p class="lb-empty">Aucune partie jouée pour l\'instant.</p>';
    return;
  }
  const medals = ['🥇', '🥈', '🥉'];
  const classes = ['gold', 'silver', 'bronze'];
  list.innerHTML = data.map((entry, i) => `
    <div class="lb-row">
      <span class="lb-rank ${classes[i] || ''}">${medals[i] || i + 1}</span>
      <span class="lb-name">${entry.name}</span>
      <div class="lb-stats">
        <span class="lb-w">${entry.wins}V</span>
        <span class="lb-l">${entry.losses}D</span>
        <span class="lb-d">${entry.draws}N</span>
      </div>
    </div>
  `).join('');
}

// ── Trivia : utilitaires ──────────────────────────────────────────────────────
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function getTriviaName() { return ($('input-trivia-name').value.trim()) || ''; }

function showTriviaError(msg) { const e = $('trivia-error-msg'); e.textContent = msg; e.classList.remove('hidden'); }
function clearTriviaError()   { $('trivia-error-msg').classList.add('hidden'); }

function goToTriviaHome() {
  if (triviaRoomCode) socket.emit('leave-trivia-room');
  stopTriviaTimer();
  triviaRoomCode = null; triviaIsHost = false; triviaIsSolo = false;
  triviaAnsweredThis = false; triviaChoiceSelected = null;
  triviaQuestions = []; triviaCurrentQ = 0; triviaScore = 0;
  $('tg-choices').innerHTML = '';
  $('tg-reveal').classList.add('hidden');
  $('tg-finished').classList.add('hidden');
  clearTriviaError();
  showScreen('trivia-home');
}

// ── Trivia : thèmes ───────────────────────────────────────────────────────────
function buildTriviaThemes() {
  const container = $('trivia-themes');
  if (container.childElementCount > 0) return;
  container.innerHTML = TRIVIA_CATS.map(c => `
    <button class="theme-btn" data-id="${c.id}">
      <span>${c.icon}</span>
      <span>${c.name}</span>
    </button>
  `).join('');
  container.querySelectorAll('.theme-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.theme-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedTriviaCategory = parseInt(btn.dataset.id);
      clearTriviaError();
    });
  });
}

// Pseudo trivia sync avec classique
$('input-trivia-name').value = localStorage.getItem('playerName') || '';
$('input-trivia-name').addEventListener('input', e => {
  localStorage.setItem('playerName', e.target.value.trim());
});

// Boutons trivia home
$('btn-back-trivia-home').addEventListener('click', () => { clearTriviaError(); showScreen('landing'); });

$('btn-solo-trivia').addEventListener('click', async () => {
  if (!selectedTriviaCategory) { showTriviaError('Choisis un thème pour commencer.'); return; }
  clearTriviaError();
  $('btn-solo-trivia').disabled = true;
  $('btn-solo-trivia').textContent = '⏳ Chargement…';
  try {
    const url = `https://opentdb.com/api.php?amount=10&category=${selectedTriviaCategory}&type=multiple&encode=url3986`;
    const res  = await fetch(url);
    const data = await res.json();
    if (data.response_code !== 0) throw new Error('code:' + data.response_code);
    triviaQuestions = data.results.map(q => ({
      question: decodeURIComponent(q.question),
      choices:  shuffle([...q.incorrect_answers, q.correct_answer].map(decodeURIComponent)),
      correct:  decodeURIComponent(q.correct_answer),
    }));
  } catch {
    showTriviaError('Impossible de charger les questions. Vérifie ta connexion.');
    $('btn-solo-trivia').disabled = false;
    $('btn-solo-trivia').textContent = '▶ Solo';
    return;
  }
  $('btn-solo-trivia').disabled = false;
  $('btn-solo-trivia').textContent = '▶ Solo';
  const cat = TRIVIA_CATS.find(c => c.id === selectedTriviaCategory);
  triviaIsSolo = true; triviaCurrentQ = 0; triviaScore = 0; triviaRoomCode = null;
  $('tg-theme-label').textContent = cat ? `${cat.icon} ${cat.name}` : '';
  $('tg-scores').innerHTML = '';
  $('tg-finished').classList.add('hidden');
  showScreen('trivia-game');
  soloNextQuestion();
});

$('btn-create-trivia').addEventListener('click', () => {
  if (!selectedTriviaCategory) { showTriviaError('Choisis un thème pour commencer.'); return; }
  clearTriviaError();
  socket.emit('create-trivia-room', { category: selectedTriviaCategory, name: getTriviaName() });
});

$('btn-join-trivia').addEventListener('click',  joinTriviaRoom);
$('input-trivia-code').addEventListener('keydown', e => { if (e.key === 'Enter') joinTriviaRoom(); });
$('input-trivia-code').addEventListener('input',   e => { e.target.value = e.target.value.toUpperCase(); });

function joinTriviaRoom() {
  const code = $('input-trivia-code').value.trim().toUpperCase();
  if (code.length !== 4) { showTriviaError('Entre un code à 4 lettres.'); return; }
  clearTriviaError();
  socket.emit('join-trivia-room', { code, name: getTriviaName() });
}

// ── Trivia : salle d'attente ──────────────────────────────────────────────────
$('btn-trivia-copy').addEventListener('click', () => {
  navigator.clipboard.writeText($('trivia-room-code').textContent).then(() => {
    $('btn-trivia-copy').textContent = 'Copié !';
    setTimeout(() => { $('btn-trivia-copy').textContent = 'Copier le code'; }, 2000);
  });
});
$('btn-start-trivia').addEventListener('click', () => { socket.emit('start-trivia'); });
$('btn-leave-trivia-wait').addEventListener('click', goToTriviaHome);

function renderTriviaWaitPlayers(players, hostId) {
  $('trivia-wait-players').innerHTML = players.map(p => `
    <div class="tw-chip" style="background:${TRIVIA_COLORS[p.colorIndex] || '#64748b'}">
      <div class="tw-chip-dot"></div>
      <span>${p.name}${p.socketId === hostId ? ' 👑' : ''}</span>
    </div>
  `).join('');
  const isHost = players.some(p => p.socketId === triviaMySocketId && p.socketId === hostId);
  $('btn-start-trivia').classList.toggle('hidden', !isHost);
}

// ── Trivia : timer ────────────────────────────────────────────────────────────
function startTriviaTimer(seconds, onExpire) {
  stopTriviaTimer();
  let rem = seconds;
  $('tg-timer').textContent = rem;
  $('tg-timer').classList.remove('warning');
  triviaTimerInterval = setInterval(() => {
    rem--;
    $('tg-timer').textContent = rem;
    $('tg-timer').classList.toggle('warning', rem <= 5);
    if (rem <= 0) { stopTriviaTimer(); onExpire(); }
  }, 1000);
}
function stopTriviaTimer() {
  if (triviaTimerInterval) { clearInterval(triviaTimerInterval); triviaTimerInterval = null; }
}

// ── Trivia : affichage question ───────────────────────────────────────────────
const LETTERS = ['A','B','C','D'];

function showTriviaQuestion({ questionNum, totalQuestions, question, choices, timeLimit, scores }) {
  triviaAnsweredThis = false; triviaChoiceSelected = null;
  $('tg-q-num').textContent = `Q ${questionNum} / ${totalQuestions}`;
  $('tg-question').textContent = question;
  $('tg-reveal').classList.add('hidden');
  $('tg-finished').classList.add('hidden');
  if (scores) renderTriviaScores(scores);

  $('tg-choices').innerHTML = choices.map((c, i) => `
    <button class="tg-choice" data-choice="${c.replace(/"/g,'&quot;')}">
      <span class="tg-choice-letter">${LETTERS[i]}</span>
      <span>${c}</span>
    </button>
  `).join('');
  $('tg-choices').querySelectorAll('.tg-choice').forEach(btn => {
    btn.addEventListener('click', () => onTriviaChoice(btn.dataset.choice, btn));
  });
  startTriviaTimer(timeLimit, () => onTriviaTimeUp());
}

function onTriviaChoice(choice, btn) {
  if (triviaAnsweredThis) return;
  triviaAnsweredThis = true; triviaChoiceSelected = choice;
  $('tg-choices').querySelectorAll('.tg-choice').forEach(b => b.disabled = true);
  btn.classList.add('wrong'); // will be corrected at reveal
  if (triviaIsSolo) {
    stopTriviaTimer();
    soloReveal(choice);
  } else {
    socket.emit('trivia-answer', { choice });
  }
}

function onTriviaTimeUp() {
  if (triviaAnsweredThis) return;
  triviaAnsweredThis = true;
  $('tg-choices').querySelectorAll('.tg-choice').forEach(b => b.disabled = true);
  if (triviaIsSolo) soloReveal(null);
}

function showTriviaReveal({ correct, correctSocketIds, scores, myChoice }) {
  stopTriviaTimer();
  $('tg-choices').querySelectorAll('.tg-choice').forEach(btn => {
    const c = btn.dataset.choice;
    btn.classList.remove('wrong');
    if (c === correct) btn.classList.add('correct');
    else if (c === myChoice) btn.classList.add('wrong');
    else btn.classList.add('dimmed');
  });
  if (scores) renderTriviaScores(scores);
  const gotIt = triviaIsSolo ? myChoice === correct
    : (correctSocketIds || []).includes(triviaMySocketId);
  $('tg-reveal').textContent  = gotIt ? '✅ Bonne réponse !' : `❌ La réponse était : ${correct}`;
  $('tg-reveal').className    = `tg-reveal ${gotIt ? 'ok' : 'ko'}`;
}

function renderTriviaScores(scores) {
  $('tg-scores').innerHTML = scores.map(s => `
    <div class="tg-score-chip" style="background:${TRIVIA_COLORS[s.colorIndex] || '#64748b'}">
      <span>${s.name}</span>
      <span class="tg-score-check">${s.score}pt</span>
    </div>
  `).join('');
}

function showTriviaFinished(scores) {
  stopTriviaTimer();
  $('tg-choices').innerHTML = '';
  $('tg-reveal').classList.add('hidden');
  const medals = ['🥇','🥈','🥉'];
  $('tg-final-scores').innerHTML = scores.map((s, i) => `
    <div class="tg-final-row" style="background:${TRIVIA_COLORS[s.colorIndex] || '#64748b'}">
      <span class="tg-final-rank">${medals[i] || (i+1)+'.'}</span>
      <span class="tg-final-name">${s.name}</span>
      <span class="tg-final-score">${s.score} / ${triviaQuestions.length || 10} pts</span>
    </div>
  `).join('');
  $('tg-finished').classList.remove('hidden');
}

$('btn-leave-trivia-game').addEventListener('click', goToTriviaHome);

// ── Trivia solo : logique locale ──────────────────────────────────────────────
function soloNextQuestion() {
  if (triviaCurrentQ >= triviaQuestions.length) {
    const name = getTriviaName() || 'Anonyme';
    const scores = [{ name, score: triviaScore, colorIndex: 0 }];
    $('tg-q-num').textContent = '';
    $('tg-timer').textContent = '–';
    showTriviaFinished(scores);
    socket.emit('solo-trivia-finished', { name, score: triviaScore, total: triviaQuestions.length });
    return;
  }
  const q = triviaQuestions[triviaCurrentQ];
  showTriviaQuestion({ questionNum: triviaCurrentQ + 1, totalQuestions: triviaQuestions.length, question: q.question, choices: q.choices, timeLimit: 20, scores: null });
}

function soloReveal(myChoice) {
  const q = triviaQuestions[triviaCurrentQ];
  if (myChoice === q.correct) triviaScore++;
  showTriviaReveal({ correct: q.correct, correctSocketIds: [], scores: null, myChoice });
  triviaCurrentQ++;
  setTimeout(soloNextQuestion, 3000);
}

// ── Trivia : classement ───────────────────────────────────────────────────────
function renderTriviaLeaderboard(data) {
  const list = $('trivia-lb-list');
  if (!data || data.length === 0) { list.innerHTML = '<p class="lb-empty">Aucune partie jouée pour l\'instant.</p>'; return; }
  const medals = ['🥇','🥈','🥉'];
  list.innerHTML = data.map((entry, i) => `
    <div class="lb-row">
      <span class="lb-rank ${i===0?'gold':i===1?'silver':i===2?'bronze':''}">${medals[i] || i+1}</span>
      <span class="lb-name">${entry.name}</span>
      <div class="lb-stats">
        <span class="lb-w">${entry.points} pts</span>
        <span class="lb-d">${entry.games} quiz</span>
      </div>
    </div>
  `).join('');
}

// ── Overlay déconnexion ───────────────────────────────────────────────────────
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
function hideOverlay() { $('overlay-disconnect').classList.add('hidden'); }

$('btn-home').addEventListener('click', goToHome);

// ── Aide ──────────────────────────────────────────────────────────────────────
$('btn-help').addEventListener('click', () => {
  $('overlay-help').classList.remove('hidden');
});
document.getElementById('btn-help-game').addEventListener('click', () => {
  $('overlay-help').classList.remove('hidden');
});
$('btn-help-close').addEventListener('click', () => {
  $('overlay-help').classList.add('hidden');
});
$('overlay-help').addEventListener('click', e => {
  if (e.target === $('overlay-help')) $('overlay-help').classList.add('hidden');
});

document.querySelectorAll('.help-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.help-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.help-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    $(`help-tab-${tab.dataset.tab}`).classList.add('active');
  });
});
$('btn-menu').addEventListener('click', goToHome);

// ── Événements Socket.IO ──────────────────────────────────────────────────────

// ── Socket Trivia ─────────────────────────────────────────────────────────────
socket.on('trivia-room-created', ({ code, categoryName, roomState }) => {
  triviaRoomCode = code; triviaIsHost = true;
  $('trivia-room-code').textContent = code;
  $('trivia-wait-theme').textContent = categoryName;
  renderTriviaWaitPlayers(roomState.players, roomState.hostId);
  showScreen('trivia-waiting');
});

socket.on('trivia-room-joined', ({ code, categoryName }) => {
  triviaRoomCode = code; triviaIsHost = false;
  $('trivia-room-code').textContent = code;
  $('trivia-wait-theme').textContent = categoryName;
  showScreen('trivia-waiting');
});

socket.on('trivia-room-updated', (roomState) => {
  renderTriviaWaitPlayers(roomState.players, roomState.hostId);
});

socket.on('trivia-start', ({ totalQuestions, categoryName }) => {
  triviaIsSolo = false;
  triviaQuestions = { length: totalQuestions };
  $('tg-theme-label').textContent = categoryName;
  $('tg-scores').innerHTML = '';
  $('tg-finished').classList.add('hidden');
  showScreen('trivia-game');
});

socket.on('trivia-question', (data) => {
  showTriviaQuestion(data);
});

socket.on('trivia-player-answered', ({ socketId }) => {
  // Marquer visuellement qu'un joueur a répondu dans les scores
  document.querySelectorAll('.tg-score-chip').forEach(chip => {
    if (chip.dataset.sid === socketId) chip.style.outline = '2px solid #fff';
  });
});

socket.on('trivia-reveal', (data) => {
  showTriviaReveal({ ...data, myChoice: triviaChoiceSelected });
});

socket.on('trivia-finished', ({ scores }) => {
  showTriviaFinished(scores);
});

socket.on('trivia-leaderboard-update', (data) => { renderTriviaLeaderboard(data); });
socket.on('trivia-error', ({ message }) => { showTriviaError(message); showScreen('trivia-home'); });

// ── Reconnexion automatique après reload + chargement du classement ───────────
socket.on('connect', () => {
  triviaMySocketId = socket.id;
  socket.emit('get-leaderboard');
  socket.emit('get-trivia-leaderboard');
  const saved = sessionStorage.getItem('p4session');
  if (!saved) return;
  try {
    const { roomCode, player } = JSON.parse(saved);
    socket.emit('reconnect-room', { code: roomCode, player });
  } catch { clearSession(); }
});

socket.on('room-created', ({ code, gameType }) => {
  currentRoomCode = code;
  currentGame     = gameType;
  $('room-code').textContent     = code;
  $('waiting-game-name').textContent = GAME_NAMES[gameType];
  showScreen('waiting');
});

socket.on('game-start', ({ gameType, state, yourPlayer }) => {
  saveSession(currentRoomCode, yourPlayer);
  applyGameState({ gameType, state, yourPlayer, status: 'playing', winner: null });
  showScreen('game');
});

socket.on('reconnect-success', ({ gameType, state, yourPlayer, status, winner, roomCode }) => {
  currentRoomCode = roomCode;
  saveSession(roomCode, yourPlayer);
  hideOverlay();
  applyGameState({ gameType, state, yourPlayer, status, winner });
  showScreen('game');
});

socket.on('reconnect-failed', () => { clearSession(); });

socket.on('game-update', ({ gameType, state, status, winner }) => {
  if (gameType === 'chess') lastMove = null; // sera mis à jour via onChessClick
  updateGameBoard(gameType, state);

  if (status === 'playing') {
    updateTurnUI(state.currentPlayer, gameType);
    // Surligner la victoire Connect4
  } else {
    $('turn-indicator').textContent = '';
    if (gameType === 'connect4' && winner) highlightConnect4Win(state.board, winner);
    if (gameType === 'tictactoe' && state.winLine) updateTTT(state.board, state.winLine);
    showGameOver(status, winner);
  }
});

socket.on('legal-moves', ({ square, moves }) => {
  if (square !== selectedSquare) return;
  availableMoves = moves;
  moves.forEach(mv => {
    const el = document.querySelector(`.chess-sq[data-sq="${mv}"]`);
    if (el) {
      el.classList.add('can-move');
      if (el.textContent) el.classList.add('has-piece');
    }
  });
});

socket.on('opponent-reconnecting', () => {
  gameActive = false;
  if (currentGame === 'connect4') setArrowsEnabled(false);
  showReconnectingOverlay();
});

socket.on('opponent-reconnected', () => {
  hideOverlay();
  gameActive = true;
  if (currentGame === 'connect4') setArrowsEnabled(currentTurnPlayer === myPlayer);
});

socket.on('player-disconnected', () => {
  gameActive = false;
  clearSession();
  showDisconnectedOverlay();
});

socket.on('restart-requested', () => {
  if (!$('game-status').classList.contains('hidden')) {
    $('status-text').textContent += "\nL'adversaire veut rejouer !";
  }
});

socket.on('new-message',       (msg)  => { appendMessage(msg); });
socket.on('leaderboard-update', (data) => { renderLeaderboard(data); });

socket.on('error', ({ message }) => { showError(message); });
socket.on('connect_error', () => { showError('Impossible de joindre le serveur. Réessaie.'); });
