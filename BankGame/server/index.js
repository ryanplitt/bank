import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import GameState from './game/GameState.js';
import { generateGameCode } from './utils/generateGameCode.js';

const PORT = 3000;
const app = express();
app.use(cors({ origin: 'http://localhost:5173' }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: 'http://localhost:5173',
  },
});

const games = {};

function rollAndBroadcast(game, code) {
  game.status = 'rolling';
  const rolls = game.players.map((p) => ({
    name: p.name,
    roll: Math.floor(Math.random() * 6) + 1,
  }));
  const banker = rolls[Math.floor(Math.random() * rolls.length)].name;
  game.round += 1;
  game.status = 'waiting';
  io.to(code).emit('roundResult', { round: game.round, rolls, banker });
}

io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  socket.on('createGame', () => {
    let code;
    do {
      code = generateGameCode();
    } while (games[code]);
    games[code] = new GameState();
    socket.emit('gameCreated', code);
    console.log(`Game created with code ${code}`);
  });

  socket.on('joinGame', ({ name, code }) => {
    const game = games[code];
    if (game) {
      socket.data.name = name;
      socket.data.code = code;
      game.addPlayer(name, socket.id);
      socket.join(code);
      io.to(code).emit('playerJoined', { players: game.getPlayerNames(), code });
      console.log(`${name} joined game ${code}`);
    } else {
      socket.emit('joinFailed');
      console.log(`Join failed for code ${code}`);
    }
  });

  socket.on('startRound', () => {
    const { code } = socket.data || {};
    const game = games[code];
    if (!game || !game.isHost(socket.id) || game.status !== 'waiting') {
      return;
    }

    if (game.timer) {
      clearInterval(game.timer);
      game.timer = null;
    }

    const COUNTDOWN = 5;
    let remaining = COUNTDOWN;
    game.status = 'countdown';
    io.to(code).emit('countdownTick', { secondsLeft: remaining });
    game.timer = setInterval(() => {
      remaining -= 1;
      if (remaining > 0) {
        io.to(code).emit('countdownTick', { secondsLeft: remaining });
      } else {
        clearInterval(game.timer);
        game.timer = null;
        rollAndBroadcast(game, code);
      }
    }, 1000);
  });

  socket.on('disconnect', () => {
    const { code, name } = socket.data || {};
    if (code && games[code]) {
      const game = games[code];
      game.removePlayer(socket.id);
      io.to(code).emit('playerJoined', { players: game.getPlayerNames(), code });
      console.log(`${name} left game ${code}`);
      if (game.getPlayerNames().length === 0) {
        delete games[code];
      }
    }
    console.log(`Socket disconnected: ${socket.id}`);
  });
});

app.get('/', (req, res) => {
  res.send('BankGame Server');
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
