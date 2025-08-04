import React, { useState, useEffect } from 'react';
import socket from '../socket.js';

export default function Lobby({ username, code, isHost }) {
  const [players, setPlayers] = useState([]);
  const [gameState, setGameState] = useState({
    status: 'waiting',
    players: [],
    currentPlayer: null,
    round: 0,
    currentTurnScore: 0,
    currentDice: [],
    targetScore: 10000
  });
  const [turnTimer, setTurnTimer] = useState(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    function handlePlayerJoined({ players: list, code: joinedCode, gameState: state }) {
      if (joinedCode === code) {
        setPlayers(list);
        if (state) {
          setGameState(prev => ({ ...prev, ...state }));
        }
      }
    }

    function handleGameStateUpdate(state) {
      setGameState(prev => ({ ...prev, ...state }));
    }

    function handleTurnTimer({ timeLeft }) {
      setTurnTimer(timeLeft);
    }

    function handleDiceRolled({ player, dice, score, turnScore }) {
      setMessage(`${player} rolled ${dice.join(', ')} for ${score} points! Turn total: ${turnScore}`);
    }

    function handleBust({ player, dice }) {
      setMessage(`${player} rolled ${dice.join(', ')} and BUSTED! No points this turn.`);
    }

    function handleScoreBanked({ player, bankedScore }) {
      setMessage(`${player} banked their score! Total: ${bankedScore} points.`);
    }

    function handleGameOver({ winner }) {
      setMessage(`🎉 ${winner} wins the game! 🎉`);
      setGameState(prev => ({ ...prev, status: 'game-over' }));
    }

    socket.on('playerJoined', handlePlayerJoined);
    socket.on('gameStateUpdate', handleGameStateUpdate);
    socket.on('turnTimer', handleTurnTimer);
    socket.on('diceRolled', handleDiceRolled);
    socket.on('bust', handleBust);
    socket.on('scoreBanked', handleScoreBanked);
    socket.on('gameOver', handleGameOver);

    return () => {
      socket.off('playerJoined', handlePlayerJoined);
      socket.off('gameStateUpdate', handleGameStateUpdate);
      socket.off('turnTimer', handleTurnTimer);
      socket.off('diceRolled', handleDiceRolled);
      socket.off('bust', handleBust);
      socket.off('scoreBanked', handleScoreBanked);
      socket.off('gameOver', handleGameOver);
    };
  }, [code]);

  const startGame = () => {
    socket.emit('startGame');
  };

  const rollDice = () => {
    socket.emit('rollDice');
  };

  const bankScore = () => {
    socket.emit('bankScore');
  };

  const endTurn = () => {
    socket.emit('endTurn');
  };

  const isMyTurn = gameState.currentPlayer === username;
  const canRoll = isMyTurn && gameState.status === 'playing';

  return (
    <div style={{ padding: '20px', fontFamily: 'Arial, sans-serif' }}>
      <h2>Bank Dice Game - Code: {code}</h2>
      <p><strong>You are:</strong> {username} {isHost && '(Host)'}</p>
      
      {gameState.status === 'waiting' && (
        <div>
          <h3>Waiting for game to start...</h3>
          {isHost && players.length >= 2 && (
            <button 
              onClick={startGame}
              style={{ 
                padding: '10px 20px', 
                fontSize: '16px', 
                backgroundColor: '#4CAF50', 
                color: 'white', 
                border: 'none', 
                borderRadius: '5px',
                cursor: 'pointer'
              }}
            >
              Start Game
            </button>
          )}
          {players.length < 2 && <p>Need at least 2 players to start!</p>}
        </div>
      )}

      <div style={{ display: 'flex', gap: '20px', marginTop: '20px' }}>
        <div style={{ flex: 1 }}>
          <h3>Players & Scores</h3>
          <div style={{ border: '1px solid #ccc', padding: '10px', borderRadius: '5px' }}>
            {gameState.players.map((player, i) => (
              <div 
                key={i} 
                style={{ 
                  padding: '8px',
                  backgroundColor: player.name === gameState.currentPlayer ? '#e3f2fd' : 'transparent',
                  border: player.name === gameState.currentPlayer ? '2px solid #2196F3' : 'none',
                  borderRadius: '3px',
                  margin: '2px 0'
                }}
              >
                <strong>{player.name}</strong>
                {player.name === gameState.currentPlayer && <span> 👈 Current Player</span>}
                <br />
                <small>
                  Current: {player.score} | 
                  Banked: {player.bankedScore} | 
                  Total: {player.totalScore}
                </small>
              </div>
            ))}
          </div>
        </div>

        {gameState.status === 'playing' && (
          <div style={{ flex: 1 }}>
            <h3>Game Status</h3>
            <p><strong>Round:</strong> {gameState.round}</p>
            <p><strong>Target Score:</strong> {gameState.targetScore}</p>
            <p><strong>Current Turn Score:</strong> {gameState.currentTurnScore}</p>
            
            {turnTimer !== null && (
              <p style={{ color: turnTimer <= 5 ? 'red' : 'black' }}>
                <strong>Time Left:</strong> {turnTimer}s
              </p>
            )}

            {gameState.currentDice.length > 0 && (
              <div>
                <strong>Last Roll:</strong> 
                <div style={{ fontSize: '24px', margin: '10px 0' }}>
                  {gameState.currentDice.map((die, i) => (
                    <span key={i} style={{ 
                      margin: '0 5px', 
                      padding: '5px 10px', 
                      border: '2px solid #333', 
                      borderRadius: '5px',
                      backgroundColor: '#f9f9f9'
                    }}>
                      {die}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {isMyTurn && (
              <div style={{ marginTop: '15px' }}>
                <h4>Your Turn!</h4>
                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                  <button 
                    onClick={rollDice}
                    disabled={!canRoll}
                    style={{ 
                      padding: '10px 15px', 
                      fontSize: '14px',
                      backgroundColor: '#2196F3', 
                      color: 'white', 
                      border: 'none', 
                      borderRadius: '5px',
                      cursor: canRoll ? 'pointer' : 'not-allowed'
                    }}
                  >
                    Roll Dice
                  </button>
                  <button 
                    onClick={bankScore}
                    disabled={gameState.currentTurnScore === 0}
                    style={{ 
                      padding: '10px 15px', 
                      fontSize: '14px',
                      backgroundColor: '#4CAF50', 
                      color: 'white', 
                      border: 'none', 
                      borderRadius: '5px',
                      cursor: gameState.currentTurnScore > 0 ? 'pointer' : 'not-allowed'
                    }}
                  >
                    Bank Score ({gameState.currentTurnScore})
                  </button>
                  <button 
                    onClick={endTurn}
                    style={{ 
                      padding: '10px 15px', 
                      fontSize: '14px',
                      backgroundColor: '#ff9800', 
                      color: 'white', 
                      border: 'none', 
                      borderRadius: '5px',
                      cursor: 'pointer'
                    }}
                  >
                    End Turn
                  </button>
                </div>
              </div>
            )}

            {!isMyTurn && gameState.currentPlayer && (
              <p><strong>Waiting for {gameState.currentPlayer} to play...</strong></p>
            )}
          </div>
        )}
      </div>

      {message && (
        <div style={{ 
          marginTop: '20px', 
          padding: '10px', 
          backgroundColor: '#f0f0f0', 
          borderRadius: '5px',
          border: '1px solid #ccc'
        }}>
          <strong>Latest:</strong> {message}
        </div>
      )}

      {gameState.status === 'game-over' && (
        <div style={{ 
          marginTop: '20px', 
          padding: '20px', 
          backgroundColor: '#e8f5e8', 
          borderRadius: '10px',
          border: '2px solid #4CAF50',
          textAlign: 'center'
        }}>
          <h2>Game Over!</h2>
          {message}
        </div>
      )}

      <div style={{ marginTop: '30px', fontSize: '12px', color: '#666' }}>
        <h4>How to Play Bank:</h4>
        <ul style={{ textAlign: 'left', maxWidth: '600px' }}>
          <li>Roll dice to accumulate points in your turn</li>
          <li>1s = 100 points each, 5s = 50 points each</li>
          <li>Three of a kind: 1s = 1000, others = face value × 100</li>
          <li>Bank your score to keep it safe, or risk losing it all!</li>
          <li>If you roll and get 0 points, you BUST and lose all turn points</li>
          <li>First to {gameState.targetScore} points wins!</li>
        </ul>
      </div>
    </div>
  );
}

