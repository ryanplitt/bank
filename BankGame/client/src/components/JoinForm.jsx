import React, { useState, useEffect } from 'react';
import socket from '../socket.js';

export default function JoinForm({ onJoin }) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [waiting, setWaiting] = useState(false);
  const [hostMode, setHostMode] = useState(false);
  const [joinedGame, setJoinedGame] = useState(false);

  useEffect(() => {
    function handleGameCreated(gameCode) {
      setCode(gameCode);
      setHostMode(true);
      socket.emit('joinGame', { name, code: gameCode });
      onJoin(name, gameCode, true);
      setJoinedGame(true);
      setWaiting(false);
    }

    function handlePlayerJoined({ players, code: joinedCode }) {
      if (!joinedGame && joinedCode === code && players.includes(name)) {
        onJoin(name, joinedCode, hostMode);
        setJoinedGame(true);
        setWaiting(false);
      }
    }

    function handleJoinFailed() {
      setError('Failed to join game');
      setWaiting(false);
      setJoinedGame(false);
    }

    socket.on('gameCreated', handleGameCreated);
    socket.on('playerJoined', handlePlayerJoined);
    socket.on('joinFailed', handleJoinFailed);
    return () => {
      socket.off('gameCreated', handleGameCreated);
      socket.off('playerJoined', handlePlayerJoined);
      socket.off('joinFailed', handleJoinFailed);
    };
  }, [name, code, hostMode, joinedGame, onJoin]);

  const create = (e) => {
    e.preventDefault();
    if (!name) {
      setError('Enter a name');
      return;
    }
    setWaiting(true);
    setJoinedGame(false);
    setHostMode(true);
    socket.emit('createGame', { name });
  };

  const join = (e) => {
    e.preventDefault();
    if (!name || !code) {
      setError('Enter name and code');
      return;
    }
    setWaiting(true);
    setJoinedGame(false);
    setHostMode(false);
    socket.emit('joinGame', { name, code });
  };

  return (
    <div>
      <div>{error}</div>
      <input
        type="text"
        placeholder="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <input
        type="text"
        placeholder="Game Code"
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
      />
      <button onClick={create} disabled={waiting}>Create Game</button>
      <button onClick={join} disabled={waiting}>Join Game</button>
    </div>
  );
}
