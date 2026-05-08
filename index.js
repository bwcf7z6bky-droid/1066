// =====================================================
// Regia Sol — Express + Socket.IO server
// =====================================================

const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const { newGameState, setOrder, resolveTurn, FACTIONS, ROSTERS } = require('./engine');

const PORT = process.env.PORT || 3000;
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

// Static client
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('/healthz', (_req, res) => res.status(200).send('ok'));

// ============== Room state ==============
// rooms[code] = {
//   code, hostId,
//   players: [{ socketId, name, faction, ready }, ...],
//   state: GameState | null,
//   pendingInputs: { [unitId]: { mult } },
//   inputsReceived: { 0: bool, 1: bool }
// }
const rooms = new Map();

function genCode() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = '';
    for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  } while (rooms.has(code));
  return code;
}

function publicRoomState(room) {
  return {
    code: room.code,
    players: room.players.map(p => ({
      name: p.name,
      faction: p.faction,
      ready: p.ready,
      connected: p.connected
    })),
    state: room.state
  };
}

function broadcastRoom(room) {
  io.to(room.code).emit('room:update', publicRoomState(room));
}

function sanitize(name) {
  if (typeof name !== 'string') return 'Anonymous';
  return name.replace(/[^\w\s\-]/g, '').slice(0, 20).trim() || 'Anonymous';
}

// ============== Socket handlers ==============
io.on('connection', (socket) => {
  let currentRoom = null;
  let playerIdx = -1;

  socket.on('room:create', (data, ack) => {
    const name = sanitize(data?.name);
    const faction = (data?.faction in FACTIONS) ? data.faction : 'english';
    const code = genCode();
    const room = {
      code,
      hostId: socket.id,
      players: [{ socketId: socket.id, name, faction, ready: false, connected: true }],
      state: null,
      pendingInputs: {},
      inputsReceived: { 0: false, 1: false }
    };
    rooms.set(code, room);
    socket.join(code);
    currentRoom = code;
    playerIdx = 0;
    ack && ack({ ok: true, code, playerIdx: 0 });
    broadcastRoom(room);
  });

  socket.on('room:join', (data, ack) => {
    const code = (data?.code || '').toUpperCase();
    const room = rooms.get(code);
    if (!room) return ack && ack({ ok: false, error: 'No room with that code.' });
    if (room.players.length >= 2) return ack && ack({ ok: false, error: 'Room is full.' });
    const name = sanitize(data?.name);
    const faction = (data?.faction in FACTIONS) ? data.faction : 'norman';
    // can't take same faction as host
    if (room.players.some(p => p.faction === faction)) {
      // pick something else automatically
      const used = new Set(room.players.map(p => p.faction));
      const all = Object.keys(FACTIONS);
      const fallback = all.find(f => !used.has(f));
      room.players.push({ socketId: socket.id, name, faction: fallback || faction, ready: false, connected: true });
    } else {
      room.players.push({ socketId: socket.id, name, faction, ready: false, connected: true });
    }
    socket.join(code);
    currentRoom = code;
    playerIdx = 1;
    ack && ack({ ok: true, code, playerIdx: 1 });
    broadcastRoom(room);
  });

  // Pick / change faction in lobby
  socket.on('room:pickFaction', (data) => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room || room.state) return;
    const f = data?.faction;
    if (!(f in FACTIONS)) return;
    // can't duplicate
    if (room.players.some((p, i) => i !== playerIdx && p.faction === f)) return;
    room.players[playerIdx].faction = f;
    broadcastRoom(room);
  });

  // Toggle ready in lobby
  socket.on('room:ready', (data) => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room || room.state) return;
    room.players[playerIdx].ready = !!data?.ready;

    if (room.players.length === 2 && room.players.every(p => p.ready)) {
      // start the battle
      room.state = newGameState(room.players.map(p => ({
        id: p.socketId,
        name: p.name,
        faction: p.faction
      })));
    }
    broadcastRoom(room);
  });

  // Submit a single unit's order in planning phase
  socket.on('order:set', (data, ack) => {
    if (!currentRoom) return ack && ack({ ok: false });
    const room = rooms.get(currentRoom);
    if (!room || !room.state || room.state.phase !== 'planning') return ack && ack({ ok: false });
    const result = setOrder(room.state, playerIdx, data?.unitId, data?.order);
    if (result.ok) {
      broadcastRoom(room);
      ack && ack({ ok: true });
    } else {
      ack && ack({ ok: false, error: result.error });
    }
  });

  // Player declares "I am done planning"
  socket.on('turn:ready', (data) => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room || !room.state || room.state.phase !== 'planning') return;
    room.state.players[playerIdx].ready = true;

    if (room.state.players.every(p => p.ready)) {
      // Both ready — request input multipliers from each (for combat timing)
      // We move into a brief "input collection" sub-phase.
      // For simplicity we just ask each client to submit final inputs now.
      room.state.phase = 'resolving';
      room.inputsReceived = { 0: false, 1: false };
      room.pendingInputs = {};
      io.to(room.code).emit('turn:collectInputs', { state: room.state });
    } else {
      broadcastRoom(room);
    }
  });

  // Each client submits its modifier inputs (combat timing scores) for the units it owns.
  socket.on('turn:submitInputs', (data) => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room || !room.state || room.state.phase !== 'resolving') return;
    const inputs = data?.inputs || {};
    for (const [unitIdStr, val] of Object.entries(inputs)) {
      const unitId = Number(unitIdStr);
      const u = room.state.units.find(x => x.id === unitId);
      if (!u) continue;
      if (u.owner !== playerIdx) continue; // can only score own units
      const mult = Number(val?.mult);
      if (Number.isFinite(mult)) {
        room.pendingInputs[unitId] = { mult };
      }
    }
    room.inputsReceived[playerIdx] = true;

    if (room.inputsReceived[0] && room.inputsReceived[1]) {
      const events = resolveTurn(room.state, room.pendingInputs);
      io.to(room.code).emit('turn:resolved', { state: room.state, events });
      room.pendingInputs = {};
      room.inputsReceived = { 0: false, 1: false };
    }
  });

  // Chat
  socket.on('chat:send', (data) => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room) return;
    const msg = String(data?.text || '').slice(0, 200);
    if (!msg.trim()) return;
    io.to(room.code).emit('chat:msg', {
      from: room.players[playerIdx]?.name || 'unknown',
      text: msg,
      ts: Date.now()
    });
  });

  socket.on('disconnect', () => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room) return;
    if (playerIdx >= 0 && room.players[playerIdx]) {
      room.players[playerIdx].connected = false;
    }
    // If both gone, clean up after delay
    const allGone = room.players.every(p => !p.connected);
    if (allGone) {
      setTimeout(() => {
        const r = rooms.get(currentRoom);
        if (r && r.players.every(p => !p.connected)) rooms.delete(currentRoom);
      }, 60_000);
    } else {
      broadcastRoom(room);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Regia Sol listening on :${PORT}`);
});
