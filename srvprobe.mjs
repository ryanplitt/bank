import { RoomManager } from './BankGame/server/rooms/RoomManager.js';
import { registerHandlers } from './BankGame/server/socket/handlers.js';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { io as client } from 'socket.io-client';
import { C2S, S2C } from '@bank/shared';

const httpServer = createServer();
const ioSrv = new Server(httpServer);
// 3s empty-grace so the abandoned-room reap is observable in a short run.
const manager = new RoomManager({ emptyTtlMs: 3000 });
registerHandlers(ioSrv, { manager });
await new Promise(r => httpServer.listen(0, r));
const URL = `http://localhost:${httpServer.address().port}`;
const conn = () => client(URL, { transports:['websocket'], forceNew:true });

const h = conn();
const { code, playerId, token } = await new Promise(res => { h.on(S2C.SESSION,res); h.emit(C2S.CREATE_GAME,{name:'Host'}); });
const room = manager.get(code);
const rep = t => console.log(`${t} rooms=${manager.size} players=${room.players.size} socketIds=${room.socketIds.size} liveSockets=${ioSrv.sockets.sockets.size} emptySince=${room.emptySince?'set':'null'}`);
rep('after create      ');

for (let i=0;i<25;i++){ const c=conn();
  await new Promise(res=>{c.on(S2C.STATE,res);c.emit(C2S.RESUME,{code,playerId,token});});
  await new Promise(r=>setTimeout(r,10)); c.disconnect(); await new Promise(r=>setTimeout(r,10)); }
rep('after 25 resumes  ');

const dupes=[];
for (let i=0;i<25;i++){ const c=conn();
  await new Promise(res=>{c.on(S2C.STATE,res);c.emit(C2S.RESUME,{code,playerId,token});}); dupes.push(c); }
rep('after 25 dup socks');
for (const c of dupes) c.disconnect();
await new Promise(r=>setTimeout(r,300));
rep('after dupes closed');

const j = conn();
await new Promise(res=>{j.on(S2C.SESSION,res);j.emit(C2S.JOIN_GAME,{name:'Pat',code});});
rep('after join        ');
j.disconnect(); h.disconnect();
await new Promise(r=>setTimeout(r,300));
rep('after ALL quit    ');
console.log(`  -> roster kept for resume: ${room.players.size} players, room alive: ${manager.has(code)}`);
await new Promise(r=>setTimeout(r,3200));
console.log('reaped by sweeper after grace:', manager.sweepOnce());
console.log('room still in manager?', manager.has(code), '| rooms now:', manager.size);
manager.stopSweeper(); ioSrv.close(); httpServer.close(); process.exit(0);
