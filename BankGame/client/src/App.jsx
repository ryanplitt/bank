import React, { useState } from 'react';
import JoinForm from './components/JoinForm.jsx';
import Lobby from './components/Lobby.jsx';

export default function App() {
  const [joined, setJoined] = useState(false);
  const [username, setUsername] = useState('');
  const [gameCode, setGameCode] = useState('');
  const [isHost, setIsHost] = useState(false);

  const handleJoin = (name, code, host) => {
    setUsername(name);
    setGameCode(code);
    setIsHost(host);
    setJoined(true);
  };

  return (
    <div>
      <h1>BankGame</h1>
      {joined ? (
        <Lobby username={username} code={gameCode} isHost={isHost} />
      ) : (
        <JoinForm onJoin={handleJoin} />
      )}
    </div>
  );
}
