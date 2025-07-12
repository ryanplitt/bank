import React, { useState, useEffect } from 'react';
import socket from '../socket.js';

export default function Lobby({ username, code, isHost }) {
  const [players, setPlayers] = useState([]);
  const [countdown, setCountdown] = useState(null);
  const [result, setResult] = useState(null);

  useEffect(() => {
    function handlePlayerJoined({ players: list, code: joinedCode }) {
      if (joinedCode === code) {
        setPlayers(list);
      }
    }
    function handleCountdownTick({ secondsLeft }) {
      setCountdown(secondsLeft);
    }

    function handleRoundResult(res) {
      setCountdown(null);
      setResult(res);
    }

    socket.on('playerJoined', handlePlayerJoined);
    socket.on('countdownTick', handleCountdownTick);
    socket.on('roundResult', handleRoundResult);
    return () => {
      socket.off('playerJoined', handlePlayerJoined);
      socket.off('countdownTick', handleCountdownTick);
      socket.off('roundResult', handleRoundResult);
    };
  }, [code]);

  const start = () => {
    socket.emit('startRound');
  };

  return (
    <div>
      <h2>Game Code: {code}</h2>
      <p>You are: {username}</p>
      <h3>Players</h3>
      <ul>
        {players.map((p, i) => (
          <li key={i}>{p}</li>
        ))}
      </ul>
      {countdown !== null && <p>Round starting in: {countdown}</p>}
      {result && (
        <div>
          <h4>Round {result.round} Results</h4>
          <ul>
            {result.rolls.map((r) => (
              <li key={r.name}>
                {r.name}: {r.roll}
                {r.name === result.banker ? ' (banker)' : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
      {isHost && <button onClick={start}>Start Round</button>}
    </div>
  );
}

