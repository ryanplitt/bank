export default class GameState {
  constructor() {
    this.players = []; // array of { name, socketId }
    this.host = null; // socket id of host
    this.round = 0;
    this.status = 'waiting';
    this.timer = null; // countdown timer reference
  }

  addPlayer(name, socketId) {
    if (!this.players.some((p) => p.socketId === socketId)) {
      this.players.push({ name, socketId });
      if (!this.host) {
        this.host = socketId;
      }
    }
  }

  removePlayer(socketId) {
    this.players = this.players.filter((p) => p.socketId !== socketId);
    if (this.host === socketId) {
      this.host = this.players[0] ? this.players[0].socketId : null;
    }
  }

  getPlayerNames() {
    return this.players.map((p) => p.name);
  }

  isHost(socketId) {
    return this.host === socketId;
  }
}
