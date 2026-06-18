const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { createBoard, dropPiece, checkWin, checkDraw } = require('./game');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: '*' },
});

// rooms: Map<code, RoomState>
const rooms = new Map();

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const RECONNECT_TIMEOUT_MS = 30_000;

function generateCode() {
  let code;
  do {
    code = Array.from({ length: 4 }, () =>
      CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]
    ).join('');
  } while (rooms.has(code));
  return code;
}

function createRoom(code) {
  return {
    code,
    board: createBoard(),
    currentPlayer: 'R',
    players: { R: null, Y: null },
    status: 'waiting', // waiting | playing | won | draw
    winner: null,
    restartVotes: new Set(),
    reconnectTimers: { R: null, Y: null },
  };
}

io.on('connection', (socket) => {
  let roomCode = null;
  let myPlayer = null;

  socket.on('create-room', () => {
    const code = generateCode();
    const room = createRoom(code);
    room.players.R = socket.id;
    rooms.set(code, room);

    roomCode = code;
    myPlayer = 'R';

    socket.join(code);
    socket.emit('room-created', { code });
  });

  socket.on('join-room', ({ code }) => {
    const key = (code || '').toUpperCase().trim();
    const room = rooms.get(key);

    if (!room) {
      socket.emit('error', { message: 'Room introuvable. Vérifie le code.' });
      return;
    }
    if (room.players.Y) {
      socket.emit('error', { message: 'Cette room est déjà pleine.' });
      return;
    }

    room.players.Y = socket.id;
    room.status = 'playing';

    roomCode = key;
    myPlayer = 'Y';

    socket.join(key);

    io.to(room.players.R).emit('game-start', {
      board: room.board,
      currentPlayer: room.currentPlayer,
      yourPlayer: 'R',
    });
    io.to(room.players.Y).emit('game-start', {
      board: room.board,
      currentPlayer: room.currentPlayer,
      yourPlayer: 'Y',
    });
  });

  socket.on('reconnect-room', ({ code, player }) => {
    const key = (code || '').toUpperCase().trim();
    const room = rooms.get(key);

    if (!room || (player !== 'R' && player !== 'Y')) {
      socket.emit('reconnect-failed');
      return;
    }

    // Race condition guard: the new socket may arrive before the old disconnect event
    // fires on the server. Check whether the stored socket is actually still alive.
    const storedId = room.players[player];
    if (storedId !== null) {
      const storedSocket = io.sockets.sockets.get(storedId);
      if (storedSocket?.connected) {
        // Slot is genuinely held by an active socket — refuse
        socket.emit('reconnect-failed');
        return;
      }
      // Stored socket is already gone; proceed as if slot were empty
    }

    // Cancel the pending delete timer (may or may not have started yet)
    if (room.reconnectTimers[player]) {
      clearTimeout(room.reconnectTimers[player]);
      room.reconnectTimers[player] = null;
    }

    room.players[player] = socket.id;
    roomCode = key;
    myPlayer = player;

    socket.join(key);

    socket.emit('reconnect-success', {
      board: room.board,
      currentPlayer: room.currentPlayer,
      yourPlayer: player,
      status: room.status,
      winner: room.winner,
      roomCode: room.code,
    });

    // Notify the other player directly by socket ID to avoid room-membership issues
    const other = player === 'R' ? 'Y' : 'R';
    if (room.players[other]) {
      io.to(room.players[other]).emit('opponent-reconnected');
    }
  });

  socket.on('make-move', ({ col }) => {
    const room = rooms.get(roomCode);
    if (!room || room.status !== 'playing') return;

    if (room.players[room.currentPlayer] !== socket.id) return;

    const colIndex = parseInt(col, 10);
    if (isNaN(colIndex) || colIndex < 0 || colIndex >= 7) return;

    const row = dropPiece(room.board, colIndex, room.currentPlayer);
    if (row === -1) return;

    let status = 'playing';
    let winner = null;

    if (checkWin(room.board, row, colIndex, room.currentPlayer)) {
      status = 'won';
      winner = room.currentPlayer;
    } else if (checkDraw(room.board)) {
      status = 'draw';
    }

    if (status === 'playing') {
      room.currentPlayer = room.currentPlayer === 'R' ? 'Y' : 'R';
    }
    room.status = status;
    room.winner = winner;

    io.to(roomCode).emit('game-update', {
      board: room.board,
      currentPlayer: room.currentPlayer,
      status,
      winner,
    });
  });

  socket.on('request-restart', () => {
    const room = rooms.get(roomCode);
    if (!room || (room.status !== 'won' && room.status !== 'draw')) return;

    room.restartVotes.add(socket.id);

    if (room.restartVotes.size >= 2) {
      room.board = createBoard();
      room.currentPlayer = 'R';
      room.status = 'playing';
      room.winner = null;
      room.restartVotes.clear();

      io.to(room.players.R).emit('game-start', {
        board: room.board,
        currentPlayer: room.currentPlayer,
        yourPlayer: 'R',
      });
      io.to(room.players.Y).emit('game-start', {
        board: room.board,
        currentPlayer: room.currentPlayer,
        yourPlayer: 'Y',
      });
    } else {
      socket.to(roomCode).emit('restart-requested');
      socket.emit('restart-vote-sent');
    }
  });

  socket.on('send-message', ({ text }) => {
    const room = rooms.get(roomCode);
    if (!room || !room.players.Y) return;

    const clean = String(text || '').trim().slice(0, 200);
    if (!clean) return;

    const time = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    io.to(roomCode).emit('new-message', { player: myPlayer, text: clean, time });
  });

  socket.on('disconnect', () => {
    if (!roomCode) return;
    const room = rooms.get(roomCode);
    if (!room) return;

    // If reconnect-room already replaced this socket with a new one, do nothing
    if (room.players[myPlayer] !== socket.id) return;

    room.players[myPlayer] = null;

    // If the game hasn't started yet (only 1 player), delete immediately
    if (room.status === 'waiting') {
      rooms.delete(roomCode);
      return;
    }

    // Notify the other player directly by socket ID
    const other = myPlayer === 'R' ? 'Y' : 'R';
    if (room.players[other]) {
      io.to(room.players[other]).emit('opponent-reconnecting');
    }

    // Give 30s for the player to reload and reconnect before ending the game
    room.reconnectTimers[myPlayer] = setTimeout(() => {
      if (room.players[myPlayer] !== null) return; // already reconnected
      if (room.players[other]) {
        io.to(room.players[other]).emit('player-disconnected');
      }
      rooms.delete(roomCode);
    }, RECONNECT_TIMEOUT_MS);
  });
});

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Serveur démarré sur le port ${PORT}`);
});
