const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const connect4 = require('./game');
const tictactoe = require('./game-tictactoe');
const chessGame = require('./game-chess');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const rooms = new Map();
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const RECONNECT_MS = 30_000;
const VALID_GAMES = new Set(['connect4', 'tictactoe', 'chess']);

// ── Helpers ────────────────────────────────────────────────────────────────

function generateCode() {
  let code;
  do {
    code = Array.from({ length: 4 }, () =>
      CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]
    ).join('');
  } while (rooms.has(code));
  return code;
}

function createInitialState(gameType) {
  switch (gameType) {
    case 'connect4':  return { board: connect4.createBoard(), currentPlayer: 'R' };
    case 'tictactoe': return tictactoe.createState();
    case 'chess':     return chessGame.createState();
  }
}

// ── Socket ─────────────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  let roomCode  = null;
  let myPlayer  = null;

  // ── Créer une room ──────────────────────────────────────────────────────
  socket.on('create-room', ({ gameType = 'connect4' } = {}) => {
    if (!VALID_GAMES.has(gameType)) return;

    const code = generateCode();
    rooms.set(code, {
      code,
      gameType,
      state: createInitialState(gameType),
      players: { R: socket.id, Y: null },
      status: 'waiting',
      winner: null,
      restartVotes: new Set(),
      reconnectTimers: { R: null, Y: null },
    });

    roomCode = code;
    myPlayer = 'R';
    socket.join(code);
    socket.emit('room-created', { code, gameType });
  });

  // ── Rejoindre une room ──────────────────────────────────────────────────
  socket.on('join-room', ({ code }) => {
    const key  = (code || '').toUpperCase().trim();
    const room = rooms.get(key);

    if (!room)          { socket.emit('error', { message: 'Room introuvable. Vérifie le code.' }); return; }
    if (room.players.Y) { socket.emit('error', { message: 'Cette room est déjà pleine.' });        return; }

    room.players.Y = socket.id;
    room.status    = 'playing';
    roomCode = key;
    myPlayer = 'Y';
    socket.join(key);

    for (const p of ['R', 'Y']) {
      io.to(room.players[p]).emit('game-start', {
        gameType:     room.gameType,
        state:        room.state,
        yourPlayer:   p,
      });
    }
  });

  // ── Reconnexion après reload ────────────────────────────────────────────
  socket.on('reconnect-room', ({ code, player }) => {
    const key  = (code || '').toUpperCase().trim();
    const room = rooms.get(key);

    if (!room || (player !== 'R' && player !== 'Y')) { socket.emit('reconnect-failed'); return; }

    const storedId     = room.players[player];
    const storedSocket = storedId ? io.sockets.sockets.get(storedId) : null;
    if (storedSocket?.connected) { socket.emit('reconnect-failed'); return; }

    if (room.reconnectTimers[player]) {
      clearTimeout(room.reconnectTimers[player]);
      room.reconnectTimers[player] = null;
    }

    room.players[player] = socket.id;
    roomCode = key;
    myPlayer = player;
    socket.join(key);

    socket.emit('reconnect-success', {
      gameType:   room.gameType,
      state:      room.state,
      yourPlayer: player,
      status:     room.status,
      winner:     room.winner,
      roomCode:   room.code,
    });

    const other = player === 'R' ? 'Y' : 'R';
    if (room.players[other]) io.to(room.players[other]).emit('opponent-reconnected');
  });

  // ── Jouer un coup ───────────────────────────────────────────────────────
  socket.on('make-move', (move) => {
    const room = rooms.get(roomCode);
    if (!room || room.status !== 'playing') return;
    if (room.state.currentPlayer !== myPlayer) return;

    let newState, status, winner;

    switch (room.gameType) {

      case 'connect4': {
        const col = parseInt(move.col, 10);
        if (isNaN(col) || col < 0 || col >= 7) return;

        const board = room.state.board.map(r => [...r]);
        const row   = connect4.dropPiece(board, col, myPlayer);
        if (row === -1) return;

        status = 'playing'; winner = null;
        if (connect4.checkWin(board, row, col, myPlayer)) { status = 'won';  winner = myPlayer; }
        else if (connect4.checkDraw(board))               { status = 'draw'; }

        newState = { board, currentPlayer: status === 'playing' ? (myPlayer === 'R' ? 'Y' : 'R') : myPlayer };
        break;
      }

      case 'tictactoe': {
        const result = tictactoe.applyMove(room.state, move.cell);
        if (!result) return;
        newState = { board: result.board, currentPlayer: result.currentPlayer, winLine: result.winLine };
        status   = result.status;
        winner   = result.winner;
        break;
      }

      case 'chess': {
        const result = chessGame.applyMove(room.state, move);
        if (!result) return;
        newState = { fen: result.fen, currentPlayer: result.currentPlayer, isCheck: result.isCheck };
        status   = result.status;
        winner   = result.winner;
        break;
      }

      default: return;
    }

    room.state  = newState;
    room.status = status;
    room.winner = winner;

    io.to(roomCode).emit('game-update', { gameType: room.gameType, state: newState, status, winner });
  });

  // ── Coups légaux (échecs uniquement) ────────────────────────────────────
  socket.on('get-moves', ({ square }) => {
    const room = rooms.get(roomCode);
    if (!room || room.gameType !== 'chess' || room.state.currentPlayer !== myPlayer) {
      socket.emit('legal-moves', { square, moves: [] });
      return;
    }
    socket.emit('legal-moves', { square, moves: chessGame.getLegalMoves(room.state.fen, square) });
  });

  // ── Rejouer ─────────────────────────────────────────────────────────────
  socket.on('request-restart', () => {
    const room = rooms.get(roomCode);
    if (!room || (room.status !== 'won' && room.status !== 'draw')) return;

    room.restartVotes.add(socket.id);

    if (room.restartVotes.size >= 2) {
      room.state  = createInitialState(room.gameType);
      room.status = 'playing';
      room.winner = null;
      room.restartVotes.clear();

      for (const p of ['R', 'Y']) {
        io.to(room.players[p]).emit('game-start', {
          gameType:   room.gameType,
          state:      room.state,
          yourPlayer: p,
        });
      }
    } else {
      socket.to(roomCode).emit('restart-requested');
      socket.emit('restart-vote-sent');
    }
  });

  // ── Quitter la room (retour menu) ───────────────────────────────────────
  socket.on('leave-room', () => {
    const room = rooms.get(roomCode);
    if (!room) return;
    if (room.players[myPlayer] !== socket.id) return;

    if (room.reconnectTimers[myPlayer]) {
      clearTimeout(room.reconnectTimers[myPlayer]);
      room.reconnectTimers[myPlayer] = null;
    }

    const other = myPlayer === 'R' ? 'Y' : 'R';
    if (room.status !== 'waiting' && room.players[other]) {
      io.to(room.players[other]).emit('player-disconnected');
    }
    rooms.delete(roomCode);
    roomCode = null;
    myPlayer = null;
  });

  // ── Chat ─────────────────────────────────────────────────────────────────
  socket.on('send-message', ({ text }) => {
    const room = rooms.get(roomCode);
    if (!room || !room.players.Y) return;
    const clean = String(text || '').trim().slice(0, 200);
    if (!clean) return;
    const time = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    io.to(roomCode).emit('new-message', { player: myPlayer, text: clean, time });
  });

  // ── Déconnexion ──────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    if (!roomCode) return;
    const room = rooms.get(roomCode);
    if (!room) return;
    if (room.players[myPlayer] !== socket.id) return;

    room.players[myPlayer] = null;

    if (room.status === 'waiting') { rooms.delete(roomCode); return; }

    const other = myPlayer === 'R' ? 'Y' : 'R';
    if (room.players[other]) io.to(room.players[other]).emit('opponent-reconnecting');

    room.reconnectTimers[myPlayer] = setTimeout(() => {
      if (room.players[myPlayer] !== null) return;
      if (room.players[other]) io.to(room.players[other]).emit('player-disconnected');
      rooms.delete(roomCode);
    }, RECONNECT_MS);
  });
});

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Serveur démarré sur le port ${PORT}`));
