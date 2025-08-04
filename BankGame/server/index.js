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

function broadcastGameState(game, code) {
  const gameState = {
    players: game.getPlayers(),
    currentPlayer: game.getCurrentPlayer()?.name,
    round: game.round,
    status: game.status,
    currentTurnScore: game.currentTurnScore,
    currentDice: game.currentDice,
    targetScore: game.targetScore
  };
  io.to(code).emit('gameStateUpdate', gameState);
}

function startTurnTimer(game, code) {
  if (game.turnTimer) {
    clearInterval(game.turnTimer);
  }
  
  let timeLeft = game.turnTimeLimit;
  io.to(code).emit('turnTimer', { timeLeft });
  
  game.turnTimer = setInterval(() => {
    timeLeft -= 1;
    io.to(code).emit('turnTimer', { timeLeft });
    
    if (timeLeft <= 0) {
      clearInterval(game.turnTimer);
      game.turnTimer = null;
      
      // Force end turn due to timeout
      game.bustTurn();
      game.nextPlayer();
      
      if (game.status === 'playing') {
        broadcastGameState(game, code);
        startTurnTimer(game, code);
      }
    }
  }, 1000);
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
      io.to(code).emit('playerJoined', { 
        players: game.getPlayerNames(), 
        code,
        gameState: {
          players: game.getPlayers(),
          status: game.status,
          round: game.round
        }
      });
      console.log(`${name} joined game ${code}`);
    } else {
      socket.emit('joinFailed');
      console.log(`Join failed for code ${code}`);
    }
  });

  socket.on('startGame', () => {
    const { code } = socket.data || {};
    const game = games[code];
    if (!game || !game.isHost(socket.id) || game.status !== 'waiting') {
      return;
    }

    game.startGame();
    broadcastGameState(game, code);
    startTurnTimer(game, code);
    console.log(`Game ${code} started`);
  });

  socket.on('rollDice', () => {
    const { code } = socket.data || {};
    const game = games[code];
    
    if (!game || !game.isCurrentPlayer(socket.id) || game.status !== 'playing') {
      return;
    }

    const dice = game.rollDice();
    const score = game.calculateScore(dice);
    
    if (score === 0) {
      // Bust! Player loses all points for this turn
      game.bustTurn();
      game.nextPlayer();
      
      io.to(code).emit('bust', { 
        player: socket.data.name,
        dice: dice
      });
      
      if (game.status === 'playing') {
        broadcastGameState(game, code);
        startTurnTimer(game, code);
      }
    } else {
      // Add score to current turn
      game.currentTurnScore += score;
      game.getCurrentPlayer().score += score;
      
      io.to(code).emit('diceRolled', {
        player: socket.data.name,
        dice: dice,
        score: score,
        turnScore: game.currentTurnScore
      });
      
      broadcastGameState(game, code);
    }
  });

  socket.on('bankScore', () => {
    const { code } = socket.data || {};
    const game = games[code];
    
    if (!game || !game.isCurrentPlayer(socket.id) || game.status !== 'playing') {
      return;
    }

    const gameOver = game.bankScore();
    
    if (gameOver) {
      const winner = game.checkWinner();
      game.clearTimers();
      io.to(code).emit('gameOver', { winner: winner.name });
    } else {
      io.to(code).emit('scoreBanked', {
        player: socket.data.name,
        bankedScore: game.getCurrentPlayer().bankedScore
      });
      
      game.nextPlayer();
      broadcastGameState(game, code);
      startTurnTimer(game, code);
    }
  });

  socket.on('endTurn', () => {
    const { code } = socket.data || {};
    const game = games[code];
    
    if (!game || !game.isCurrentPlayer(socket.id) || game.status !== 'playing') {
      return;
    }

    game.nextPlayer();
    broadcastGameState(game, code);
    startTurnTimer(game, code);
  });

  socket.on('disconnect', () => {
    const { code, name } = socket.data || {};
    if (code && games[code]) {
      const game = games[code];
      game.removePlayer(socket.id);
      game.clearTimers();
      
      io.to(code).emit('playerJoined', { 
        players: game.getPlayerNames(), 
        code,
        gameState: {
          players: game.getPlayers(),
          status: game.status,
          round: game.round
        }
      });
      
      console.log(`${name} left game ${code}`);
      
      if (game.getPlayerNames().length === 0) {
        delete games[code];
      } else if (game.status === 'playing') {
        // If current player left, move to next player
        broadcastGameState(game, code);
        if (game.players.length > 0) {
          startTurnTimer(game, code);
        }
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
