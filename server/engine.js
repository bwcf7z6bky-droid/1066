// =====================================================
// Regia Sol — server-side game engine (authoritative)
// =====================================================

const { FACTIONS, ROSTERS, COLS, ROWS, TERRAIN } = require('./factions');

let UID = 1;

function nextId() { return UID++; }

// Build a fresh battle state for two players. Player 0 spawns left, player 1 right.
function newGameState(players) {
  // players: [{ id, name, faction }, { id, name, faction }]
  const units = [];
  for (let p = 0; p < 2; p++) {
    const roster = ROSTERS[players[p].faction];
    const isLeft = p === 0;
    const colA = isLeft ? 0 : COLS - 1;
    const colB = isLeft ? 1 : COLS - 2;
    // 6 unit slots, distributed across 2 columns x 4 rows of the back area
    const slots = [
      { col: colA, row: 1 },
      { col: colA, row: 3 },
      { col: colA, row: 5 },
      { col: colB, row: 2 },
      { col: colB, row: 4 },
      { col: colB, row: 6 }
    ];
    roster.forEach((tpl, i) => {
      units.push({
        id: nextId(),
        owner: p,
        faction: players[p].faction,
        ...tpl,
        maxHp: tpl.hp,
        row: slots[i].row,
        col: slots[i].col,
        order: null,
        hasMoved: false,
        morale: 100,
        facing: isLeft ? 1 : -1
      });
    });
  }
  return {
    players: players.map(p => ({
      id: p.id,
      name: p.name,
      faction: p.faction,
      ready: false,
      morale: 100,
      connected: true
    })),
    units,
    turn: 1,
    phase: 'planning', // planning | resolving | over
    log: [],
    winner: null,
    pendingResolve: null
  };
}

// Distance (Chebyshev — diagonals same as orthogonal)
function dist(a, b) {
  return Math.max(Math.abs(a.row - b.row), Math.abs(a.col - b.col));
}

function unitAt(state, row, col) {
  return state.units.find(u => u.hp > 0 && u.row === row && u.col === col);
}

// Validate and apply a player's planned order to one of their units.
// Returns { ok, error?, unit? }
function setOrder(state, playerIdx, unitId, order) {
  const u = state.units.find(x => x.id === unitId);
  if (!u) return { ok: false, error: 'no such unit' };
  if (u.owner !== playerIdx) return { ok: false, error: 'not your unit' };
  if (u.hp <= 0) return { ok: false, error: 'unit is dead' };
  if (state.phase !== 'planning') return { ok: false, error: 'not planning phase' };

  if (!order || !order.kind) {
    u.order = null;
    return { ok: true, unit: u };
  }

  if (order.kind === 'hold') {
    u.order = { kind: 'hold' };
    return { ok: true, unit: u };
  }

  if (order.kind === 'move') {
    const r = order.row | 0, c = order.col | 0;
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return { ok: false, error: 'out of bounds' };
    if (TERRAIN[r][c] === 'w') return { ok: false, error: 'cannot enter water' };
    if (dist({ row: r, col: c }, u) > u.move) return { ok: false, error: 'too far' };
    if (unitAt(state, r, c)) return { ok: false, error: 'occupied' };
    u.order = { kind: 'move', row: r, col: c };
    return { ok: true, unit: u };
  }

  if (order.kind === 'attack' || order.kind === 'archery' || order.kind === 'charge') {
    const t = state.units.find(x => x.id === order.targetId && x.hp > 0);
    if (!t) return { ok: false, error: 'no target' };
    if (t.owner === playerIdx) return { ok: false, error: 'cannot target ally' };

    if (order.kind === 'archery') {
      if (u.type !== 'ranged') return { ok: false, error: 'cannot fire' };
      if (dist(u, t) > u.range) return { ok: false, error: 'out of range' };
    }
    if (order.kind === 'attack') {
      if (dist(u, t) !== 1) return { ok: false, error: 'must be adjacent' };
    }
    if (order.kind === 'charge') {
      if (u.type !== 'cavalry' && u.special !== 'charge') return { ok: false, error: 'cannot charge' };
      const path = findChargePath(state, u, t);
      if (!path) return { ok: false, error: 'cannot reach' };
      u.order = { kind: 'charge', targetId: t.id, path };
      return { ok: true, unit: u };
    }
    u.order = { kind: order.kind, targetId: t.id };
    return { ok: true, unit: u };
  }

  return { ok: false, error: 'unknown order' };
}

function findChargePath(state, from, target) {
  // adjacent to target, reachable within from.move steps, unoccupied, not water
  let best = null, bestD = Infinity;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const r = target.row + dr, c = target.col + dc;
      if (r < 0 || r >= ROWS || c < 0 || c >= COLS) continue;
      if (TERRAIN[r][c] === 'w' || TERRAIN[r][c] === 'r') continue;
      if (unitAt(state, r, c)) continue;
      const d = dist({ row: r, col: c }, from);
      if (d <= from.move && d < bestD) {
        bestD = d;
        best = { row: r, col: c };
      }
    }
  }
  return best;
}

// Resolve a turn — produces a sequence of "events" which the client animates.
// Player input modifiers (mid-animation timing) are passed in via clientInputs.
// clientInputs: { [unitId]: { mult, hitTime } }
function resolveTurn(state, clientInputs = {}) {
  const events = [];
  const order = (kind) => state.units
    .filter(u => u.hp > 0 && u.order && u.order.kind === kind)
    .sort((a, b) => a.id - b.id);

  // Phase 1: ranged
  for (const u of order('archery')) {
    const t = state.units.find(x => x.id === u.order.targetId);
    if (!t || t.hp <= 0) continue;
    if (dist(u, t) > u.range) continue;
    const inp = clientInputs[u.id] || {};
    const mult = clamp(inp.mult ?? 1, 0.4, 2.5);
    let dmg = u.atk * mult * (0.85 + Math.random() * 0.3);
    if (TERRAIN[t.row][t.col] === 'f') dmg *= 0.65;
    if (TERRAIN[t.row][t.col] === 'h') dmg *= 0.85;
    dmg = Math.max(1, dmg - t.def * 0.4);
    dmg = Math.round(dmg);
    events.push({
      kind: 'arrow',
      from: { id: u.id, row: u.row, col: u.col },
      to:   { id: t.id, row: t.row, col: t.col },
      dmg
    });
    t.hp -= dmg;
    if (t.hp <= 0) {
      events.push({ kind: 'death', id: t.id });
      // morale loss to owner
      state.players[t.owner].morale = clamp(state.players[t.owner].morale - 8, 0, 100);
      events.push({ kind: 'morale', player: t.owner, value: state.players[t.owner].morale });
    }
  }

  // Phase 2: movement (move + charge approach)
  for (const u of [...order('move'), ...order('charge')]) {
    if (u.hp <= 0) continue;
    let dest;
    if (u.order.kind === 'move') {
      dest = { row: u.order.row, col: u.order.col };
    } else {
      dest = u.order.path;
    }
    if (!dest || unitAt(state, dest.row, dest.col)) continue;
    const fromRow = u.row, fromCol = u.col;
    u.row = dest.row; u.col = dest.col;
    u.facing = dest.col >= fromCol ? 1 : -1;
    events.push({
      kind: 'move',
      id: u.id,
      from: { row: fromRow, col: fromCol },
      to:   { row: dest.row, col: dest.col }
    });

    // charge impact
    if (u.order.kind === 'charge') {
      const t = state.units.find(x => x.id === u.order.targetId);
      if (t && t.hp > 0) {
        const inp = clientInputs[u.id] || {};
        const mult = clamp(inp.mult ?? 1, 0.5, 2.5);
        let dmg = u.atk * 1.5 * mult * (0.9 + Math.random() * 0.2);
        // anti-cavalry spear soaks charge
        if (t.special === 'antichg') dmg *= 0.5;
        dmg = Math.max(1, dmg - t.def * 0.4);
        dmg = Math.round(dmg);
        events.push({
          kind: 'charge_impact',
          attackerId: u.id,
          defenderId: t.id,
          dmg
        });
        t.hp -= dmg;
        if (t.hp <= 0) {
          events.push({ kind: 'death', id: t.id });
          state.players[t.owner].morale = clamp(state.players[t.owner].morale - 10, 0, 100);
          events.push({ kind: 'morale', player: t.owner, value: state.players[t.owner].morale });
        }
      }
    }
  }

  // Phase 3: melee
  for (const u of order('attack')) {
    if (u.hp <= 0) continue;
    const t = state.units.find(x => x.id === u.order.targetId);
    if (!t || t.hp <= 0) continue;
    if (dist(u, t) !== 1) continue;
    const inp = clientInputs[u.id] || {};
    const mult = clamp(inp.mult ?? 1, 0.4, 2.5);
    let dmg = u.atk * mult * (0.85 + Math.random() * 0.3);
    if (t.special === 'shieldwall') dmg *= 0.75;
    if (TERRAIN[t.row][t.col] === 'h') dmg *= 0.9;
    dmg = Math.max(1, dmg - t.def * 0.45);
    dmg = Math.round(dmg);

    // Counter-attack (defender swings back if alive)
    let counter = 0;
    if (t.hp - dmg > 0) {
      counter = Math.max(1, Math.round((t.atk * 0.55) - u.def * 0.35));
    }

    events.push({
      kind: 'melee',
      attackerId: u.id,
      defenderId: t.id,
      dmg,
      counter
    });
    t.hp -= dmg;
    if (t.hp > 0 && counter > 0) u.hp -= counter;

    if (t.hp <= 0) {
      events.push({ kind: 'death', id: t.id });
      state.players[t.owner].morale = clamp(state.players[t.owner].morale - 8, 0, 100);
      events.push({ kind: 'morale', player: t.owner, value: state.players[t.owner].morale });
    }
    if (u.hp <= 0) {
      events.push({ kind: 'death', id: u.id });
      state.players[u.owner].morale = clamp(state.players[u.owner].morale - 8, 0, 100);
      events.push({ kind: 'morale', player: u.owner, value: state.players[u.owner].morale });
    }
  }

  // Reset orders
  state.units.forEach(u => { u.order = null; });
  state.players.forEach(p => { p.ready = false; });
  state.turn += 1;

  // Win check
  const aliveByPlayer = [0, 0];
  state.units.forEach(u => { if (u.hp > 0) aliveByPlayer[u.owner]++; });
  if (aliveByPlayer[0] === 0 || state.players[0].morale <= 0) {
    state.phase = 'over';
    state.winner = 1;
  } else if (aliveByPlayer[1] === 0 || state.players[1].morale <= 0) {
    state.phase = 'over';
    state.winner = 0;
  } else {
    state.phase = 'planning';
  }

  return events;
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

module.exports = { newGameState, setOrder, resolveTurn, COLS, ROWS, TERRAIN, FACTIONS, ROSTERS };
