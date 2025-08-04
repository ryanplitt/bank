# Bank Dice Game

A multiplayer implementation of the classic "Bank" dice game with real-time gameplay using WebSockets.

## What is Bank?

Bank is a dice game where players take turns rolling dice to accumulate points, with the goal of being the first to reach 10,000 points. Players must balance risk and reward - they can keep rolling to increase their score, but if they roll without scoring any points, they "bust" and lose all points accumulated in that turn.

### Scoring Rules

- **Individual 1s**: 100 points each
- **Individual 5s**: 50 points each  
- **Three 1s**: 1,000 points
- **Three 2s**: 200 points
- **Three 3s**: 300 points
- **Three 4s**: 400 points
- **Three 5s**: 500 points
- **Three 6s**: 600 points
- **Four or more of a kind**: Additional sets of three count separately

### How to Play

1. Players take turns rolling 6 dice
2. On each roll, you must score at least some points or you "bust"
3. After a successful roll, you can:
   - **Roll Again**: Risk your current turn points for a chance at more
   - **Bank Score**: Keep your current turn points safe and end your turn
   - **End Turn**: End your turn without banking (lose current turn points)
4. Each player has 30 seconds per turn
5. First player to bank 10,000+ points wins!

## Getting Started

### Prerequisites

- Node.js (v14 or higher)
- npm

### Installation & Running

1. **Install dependencies** (VS Code):
   - Open the Command Palette (`Cmd+Shift+P` on macOS)
   - Run: `Tasks: Run Task` → `Install All Dependencies`

2. **Start the game** (VS Code):
   - Run: `Tasks: Run Task` → `Start Bank Game (Full Stack)`
   - Or press `Cmd+Shift+P` → `Tasks: Run Build Task`

3. **Manual setup**:
   ```bash
   # Install server dependencies
   cd BankGame/server
   npm install
   
   # Install client dependencies  
   cd ../client
   npm install
   
   # Start server (in one terminal)
   cd ../server
   npm start
   
   # Start client (in another terminal)
   cd ../client
   npm run dev
   ```

4. **Play the game**:
   - Server runs on: http://localhost:3000
   - Client runs on: http://localhost:5173
   - Open the client URL in multiple browser tabs/windows to play with friends

### Game Features

- **Real-time multiplayer**: Join games with unique room codes
- **Turn-based gameplay**: Automatic turn management with 30-second timer
- **Live scoring**: Real-time score updates and dice rolls
- **Bust detection**: Automatic handling of failed rolls
- **Game state persistence**: Players can rejoin if disconnected
- **Host controls**: Host can start games when ready

### VS Code Integration

The project includes:
- **Launch configuration**: Debug the server directly from VS Code
- **Task automation**: Build and run tasks for easy development
- **Integrated terminals**: Separate terminals for client and server

Press `F5` to start debugging the server, or use the task runner for full-stack development.

## Project Structure

```
bank/
├── BankGame/
│   ├── client/           # React frontend with Vite
│   │   ├── src/
│   │   │   ├── components/
│   │   │   │   ├── JoinForm.jsx
│   │   │   │   └── Lobby.jsx
│   │   │   ├── App.jsx
│   │   │   ├── main.jsx
│   │   │   └── socket.js
│   │   ├── package.json
│   │   └── vite.config.js
│   └── server/           # Node.js backend with Socket.IO
│       ├── game/
│       │   └── GameState.js
│       ├── utils/
│       │   └── generateGameCode.js
│       ├── index.js
│       └── package.json
└── .vscode/
    ├── launch.json       # Debug configuration
    └── tasks.json        # Build automation
```

## Development

- **Backend**: Node.js + Express + Socket.IO
- **Frontend**: React + Vite + Socket.IO Client  
- **Real-time Communication**: WebSockets via Socket.IO
- **Game Logic**: Custom Bank dice game implementation

Enjoy playing Bank! 🎲
