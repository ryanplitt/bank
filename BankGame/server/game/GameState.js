export default class GameState {
  constructor() {
    this.players = []; // array of { name, socketId, score, bankedScore }
    this.host = null; // socket id of host
    this.round = 0;
    this.status = 'waiting'; // 'waiting', 'playing', 'player-turn', 'game-over'
    this.timer = null; // countdown timer reference
    this.currentPlayer = 0; // index of current player
    this.turnTimer = null; // turn timer reference
    this.currentTurnScore = 0; // score accumulated in current turn
    this.currentDice = []; // current dice values
    this.targetScore = 10000; // winning score
    this.turnTimeLimit = 30; // seconds per turn
  }

  addPlayer(name, socketId) {
    if (!this.players.some((p) => p.socketId === socketId)) {
      this.players.push({ 
        name, 
        socketId, 
        score: 0, 
        bankedScore: 0 
      });
      if (!this.host) {
        this.host = socketId;
      }
    }
  }

  removePlayer(socketId) {
    const playerIndex = this.players.findIndex(p => p.socketId === socketId);
    if (playerIndex !== -1) {
      this.players.splice(playerIndex, 1);
      
      // Adjust current player index if needed
      if (playerIndex <= this.currentPlayer && this.currentPlayer > 0) {
        this.currentPlayer--;
      }
      if (this.currentPlayer >= this.players.length) {
        this.currentPlayer = 0;
      }
    }
    
    if (this.host === socketId) {
      this.host = this.players[0] ? this.players[0].socketId : null;
    }
  }

  getPlayerNames() {
    return this.players.map((p) => p.name);
  }

  getPlayers() {
    return this.players.map(p => ({
      name: p.name,
      score: p.score,
      bankedScore: p.bankedScore,
      totalScore: p.score + p.bankedScore
    }));
  }

  getCurrentPlayer() {
    return this.players[this.currentPlayer];
  }

  isHost(socketId) {
    return this.host === socketId;
  }

  isCurrentPlayer(socketId) {
    return this.getCurrentPlayer()?.socketId === socketId;
  }

  startGame() {
    this.status = 'playing';
    this.round = 1;
    this.currentPlayer = 0;
    this.currentTurnScore = 0;
    this.players.forEach(p => {
      p.score = 0;
      p.bankedScore = 0;
    });
  }

  nextPlayer() {
    this.currentPlayer = (this.currentPlayer + 1) % this.players.length;
    this.currentTurnScore = 0;
    this.currentDice = [];
    
    if (this.currentPlayer === 0) {
      this.round++;
    }
  }

  rollDice(numDice = 6) {
    this.currentDice = [];
    for (let i = 0; i < numDice; i++) {
      this.currentDice.push(Math.floor(Math.random() * 6) + 1);
    }
    return this.currentDice;
  }

  calculateScore(dice) {
    let score = 0;
    const counts = [0, 0, 0, 0, 0, 0, 0]; // index 0 unused, 1-6 for dice values
    
    dice.forEach(die => counts[die]++);
    
    // Score triplets and more
    for (let i = 1; i <= 6; i++) {
      if (counts[i] >= 3) {
        const triplets = Math.floor(counts[i] / 3);
        if (i === 1) {
          score += triplets * 1000; // Triple 1s = 1000 points
        } else {
          score += triplets * (i * 100); // Triple anything else = face value * 100
        }
        counts[i] -= triplets * 3;
      }
    }
    
    // Score individual 1s and 5s
    score += counts[1] * 100; // Individual 1s = 100 points
    score += counts[5] * 50;  // Individual 5s = 50 points
    
    return score;
  }

  bankScore() {
    const currentPlayer = this.getCurrentPlayer();
    if (currentPlayer) {
      currentPlayer.bankedScore += currentPlayer.score + this.currentTurnScore;
      currentPlayer.score = 0;
      this.currentTurnScore = 0;
      
      // Check for winner
      if (currentPlayer.bankedScore >= this.targetScore) {
        this.status = 'game-over';
        return true; // Game over
      }
    }
    return false; // Game continues
  }

  bustTurn() {
    this.getCurrentPlayer().score = 0;
    this.currentTurnScore = 0;
  }

  checkWinner() {
    return this.players.find(p => p.bankedScore >= this.targetScore);
  }

  clearTimers() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.turnTimer) {
      clearInterval(this.turnTimer);
      this.turnTimer = null;
    }
  }
}
