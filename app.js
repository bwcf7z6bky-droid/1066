// =====================================================
// Regia Sol — Client app
// Wires UI, sockets, click handling, combat input
// =====================================================

(function () {
  const FACTIONS = window.FACTIONS;
  const COLS = window.COLS, ROWS = window.ROWS;

  const appState = window.appState = {
    socket: null,
    connected: false,
    code: null,
    playerIdx: -1,
    name: '',
    faction: 'english',
    state: null,
    selectedUnitId: null,
    pendingAction: null, // 'move'|'attack'|'archery'|'charge'|null
    locked: false        // we've submitted ready for this turn
  };

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  // ============ Toast ============
  function toast(msg, ms = 2400) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove('show'), ms);
  }

  // ============ Screen routing ============
  function showScreen(name) {
    $$('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(`screen-${name}`).classList.add('active');
  }

  // ============ Faction picker render ============
  function renderFactionPicker(rootSel, currentFaction, takenSet, onPick) {
    const root = $(rootSel);
    root.innerHTML = '';
    Object.entries(FACTIONS).forEach(([key, f]) => {
      const div = document.createElement('div');
      div.className = 'fp';
      if (key === currentFaction) div.classList.add('selected');
      if (takenSet && takenSet.has(key) && key !== currentFaction) div.classList.add('disabled');
      div.innerHTML = `
        <div class="fp-sigil">${f.sigil}</div>
        <div class="fp-name">${f.name.replace('The ', '')}</div>`;
      div.addEventListener('click', () => {
        if (div.classList.contains('disabled')) return;
        onPick(key);
      });
      root.appendChild(div);
    });
  }

  function renderLobbyFactionGrid() {
    const root = $('#lobby-faction-grid');
    root.innerHTML = '';
    const taken = new Set();
    if (appState.state) {
      // game already started; no picking
    } else if (appState.lobbyPlayers) {
      appState.lobbyPlayers.forEach((p, i) => {
        if (p.faction && i !== appState.playerIdx) taken.add(p.faction);
      });
    }
    Object.entries(FACTIONS).forEach(([key, f]) => {
      const div = document.createElement('div');
      div.className = 'lfp';
      if (key === appState.faction) div.classList.add('selected');
      if (taken.has(key)) div.classList.add('taken');
      div.innerHTML = `
        <div class="lfp-sigil">${f.sigil}</div>
        <div class="lfp-name">${f.name.replace('The ', '')}</div>`;
      div.addEventListener('click', () => {
        if (div.classList.contains('taken')) return;
        appState.faction = key;
        appState.socket.emit('room:pickFaction', { faction: key });
      });
      root.appendChild(div);
    });
  }

  // ============ Home actions ============
  $('#action-create').addEventListener('click', () => {
    $('#create-name').value = appState.name || '';
    const refresh = () => renderFactionPicker('#create-pick', appState.faction, null, (f) => {
      appState.faction = f;
      refresh();
    });
    refresh();
    openModal('#modal-create');
  });

  $('#action-join').addEventListener('click', () => {
    $('#join-name').value = appState.name || '';
    const refresh = () => renderFactionPicker('#join-pick', appState.faction, null, (f) => {
      appState.faction = f;
      refresh();
    });
    refresh();
    $('#join-error').textContent = '';
    openModal('#modal-join');
  });

  $('#btn-create-confirm').addEventListener('click', () => {
    appState.name = $('#create-name').value.trim() || 'Anonymous';
    appState.socket.emit('room:create', { name: appState.name, faction: appState.faction }, (resp) => {
      if (resp && resp.ok) {
        appState.code = resp.code;
        appState.playerIdx = resp.playerIdx;
        closeModal('#modal-create');
        $('#lobby-code').textContent = resp.code;
        showScreen('lobby');
      } else {
        toast('Could not create room.');
      }
    });
  });

  $('#btn-join-confirm').addEventListener('click', () => {
    appState.name = $('#join-name').value.trim() || 'Anonymous';
    const code = $('#join-code').value.trim().toUpperCase();
    if (!code) { $('#join-error').textContent = 'Enter a room code.'; return; }
    appState.socket.emit('room:join', { code, name: appState.name, faction: appState.faction }, (resp) => {
      if (resp && resp.ok) {
        appState.code = resp.code;
        appState.playerIdx = resp.playerIdx;
        closeModal('#modal-join');
        $('#lobby-code').textContent = resp.code;
        showScreen('lobby');
      } else {
        $('#join-error').textContent = (resp && resp.error) || 'Could not join.';
      }
    });
  });

  $$('[data-close]').forEach(b => b.addEventListener('click', () => {
    closeModal(b.closest('.modal'));
  }));

  function openModal(sel) {
    const m = typeof sel === 'string' ? $(sel) : sel;
    m.classList.add('open');
    m.setAttribute('aria-hidden', 'false');
  }
  function closeModal(sel) {
    const m = typeof sel === 'string' ? $(sel) : sel;
    m.classList.remove('open');
    m.setAttribute('aria-hidden', 'true');
  }

  // ============ Lobby ============
  $('#btn-copy-code').addEventListener('click', () => {
    const url = `${location.origin}/?room=${appState.code}`;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(() => toast('Link copied'));
    } else {
      toast(url);
    }
  });

  $('#btn-ready').addEventListener('click', () => {
    const isReady = $('#btn-ready').dataset.ready === '1';
    appState.socket.emit('room:ready', { ready: !isReady });
  });

  $('#chat-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const msg = e.target.value.trim();
      if (!msg) return;
      appState.socket.emit('chat:send', { text: msg });
      e.target.value = '';
    }
  });

  // ============ Game UI: cell + unit interaction ============
  // We layer DOM cell-overlays over the canvas for click handling.
  function rebuildCellOverlay() {
    const layer = $('#grid-overlay');
    layer.innerHTML = '';
    const stage = window.RegiaRender.stageBattle();
    const cellW = window.RegiaRender.cellW();
    const cellH = window.RegiaRender.cellH();

    // We use the canvas's CSS rect to map logical cell coords to screen coords.
    const canvas = window.RegiaRender.canvas;
    const cr = canvas.getBoundingClientRect();
    const px = cr.width / canvas.width;
    const py = cr.height / canvas.height;

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const div = document.createElement('div');
        div.className = 'cell-overlay';
        div.dataset.row = r;
        div.dataset.col = c;
        div.style.left   = ((stage.x + c * cellW) * px) + 'px';
        div.style.top    = ((stage.y + r * cellH) * py) + 'px';
        div.style.width  = (cellW * px) + 'px';
        div.style.height = (cellH * py) + 'px';
        div.addEventListener('click', () => onCellClick(r, c));
        layer.appendChild(div);
      }
    }
    refreshHighlights();
  }
  window.addEventListener('resize', () => {
    if ($('#screen-game').classList.contains('active')) rebuildCellOverlay();
  });

  function refreshHighlights() {
    $$('.cell-overlay').forEach(c => c.classList.remove('move-target', 'attack-target'));
    if (!appState.selectedUnitId || !appState.state) return;
    const u = appState.state.units.find(x => x.id === appState.selectedUnitId);
    if (!u || u.owner !== appState.playerIdx || u.hp <= 0) return;
    const action = appState.pendingAction;
    if (!action || action === 'move') {
      // show movable cells
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          if (Math.max(Math.abs(r - u.row), Math.abs(c - u.col)) > u.move) continue;
          if (window.TERRAIN[r][c] === 'w') continue;
          if (occupied(r, c)) continue;
          if (r === u.row && c === u.col) continue;
          markCell(r, c, 'move-target');
        }
      }
    }
    if (action === 'attack' || action === 'archery' || action === 'charge') {
      // show foes in range
      appState.state.units.forEach(t => {
        if (t.owner === appState.playerIdx) return;
        if (t.hp <= 0) return;
        const d = Math.max(Math.abs(t.row - u.row), Math.abs(t.col - u.col));
        let inRange = false;
        if (action === 'archery') inRange = u.type === 'ranged' && d <= u.range;
        else if (action === 'attack') inRange = d === 1;
        else if (action === 'charge') inRange = (u.type === 'cavalry' || u.special === 'charge') && canChargeReach(u, t);
        if (inRange) markCell(t.row, t.col, 'attack-target');
      });
    }
  }
  function markCell(r, c, cls) {
    const el = $(`.cell-overlay[data-row="${r}"][data-col="${c}"]`);
    if (el) el.classList.add(cls);
  }
  function occupied(r, c) {
    return appState.state?.units.some(u => u.hp > 0 && u.row === r && u.col === c);
  }
  function unitAtCell(r, c) {
    return appState.state?.units.find(u => u.hp > 0 && u.row === r && u.col === c);
  }
  function canChargeReach(from, target) {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const r = target.row + dr, c = target.col + dc;
        if (r < 0 || r >= ROWS || c < 0 || c >= COLS) continue;
        if (window.TERRAIN[r][c] === 'w' || window.TERRAIN[r][c] === 'r') continue;
        if (occupied(r, c)) continue;
        const d = Math.max(Math.abs(r - from.row), Math.abs(c - from.col));
        if (d <= from.move) return true;
      }
    }
    return false;
  }

  function onCellClick(r, c) {
    if (!appState.state || appState.state.phase !== 'planning' || appState.locked) return;
    const target = unitAtCell(r, c);
    // Selecting a friendly unit?
    if (target && target.owner === appState.playerIdx) {
      selectUnit(target.id);
      return;
    }
    // Targeting empty cell or enemy with selected unit
    if (!appState.selectedUnitId) return;
    const me = appState.state.units.find(x => x.id === appState.selectedUnitId);
    if (!me || me.owner !== appState.playerIdx) return;

    if (target && target.owner !== appState.playerIdx) {
      // pick best action automatically if none chosen
      const action = appState.pendingAction;
      if (action === 'archery' || action === 'attack' || action === 'charge') {
        submitOrder(me.id, { kind: action, targetId: target.id });
      } else {
        // default: archery if possible & in range, else attack if adjacent
        const d = Math.max(Math.abs(target.row - me.row), Math.abs(target.col - me.col));
        if (me.type === 'ranged' && d <= me.range) {
          submitOrder(me.id, { kind: 'archery', targetId: target.id });
        } else if (d === 1) {
          submitOrder(me.id, { kind: 'attack', targetId: target.id });
        } else {
          toast('Out of range');
        }
      }
    } else if (!target) {
      // Move
      const action = appState.pendingAction;
      if (action === null || action === 'move') {
        submitOrder(me.id, { kind: 'move', row: r, col: c });
      }
    }
  }

  function selectUnit(id) {
    appState.selectedUnitId = id;
    appState.pendingAction = null;
    refreshUnitCard();
    refreshHighlights();
    refreshActionButtons();
  }

  function submitOrder(unitId, order) {
    appState.socket.emit('order:set', { unitId, order }, (resp) => {
      if (!resp || !resp.ok) {
        toast(resp?.error || 'Cannot order that');
      } else {
        appState.pendingAction = null;
        refreshActionButtons();
      }
    });
  }

  // ============ Action buttons ============
  $$('.act').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!appState.state || appState.state.phase !== 'planning' || appState.locked) return;
      const u = appState.state.units.find(x => x.id === appState.selectedUnitId);
      if (!u || u.owner !== appState.playerIdx) return;
      const a = btn.dataset.action;
      if (a === 'hold') {
        submitOrder(u.id, { kind: 'hold' });
        appState.pendingAction = null;
      } else if (a === 'cancel') {
        submitOrder(u.id, null);
        appState.pendingAction = null;
      } else {
        appState.pendingAction = a;
      }
      refreshHighlights();
      refreshActionButtons();
    });
  });

  function refreshActionButtons() {
    const u = appState.state?.units.find(x => x.id === appState.selectedUnitId);
    $$('.act').forEach(btn => {
      const a = btn.dataset.action;
      btn.classList.toggle('active', appState.pendingAction === a);
      btn.disabled = (() => {
        if (!u || u.owner !== appState.playerIdx || u.hp <= 0 || appState.locked) return true;
        if (a === 'archery') return u.type !== 'ranged';
        if (a === 'charge')  return !(u.type === 'cavalry' || u.special === 'charge');
        return false;
      })();
    });
  }

  function refreshUnitCard() {
    const card = $('#unit-card');
    const u = appState.state?.units.find(x => x.id === appState.selectedUnitId);
    if (!u) {
      card.classList.add('empty');
      card.innerHTML = `<div class="empty-msg">Tap one of your warriors</div>`;
      return;
    }
    card.classList.remove('empty');
    const isYou = u.owner === appState.playerIdx;
    card.innerHTML = `
      <div class="uc-name">${u.name}</div>
      <div class="uc-sub">${cap(u.type)} · ${isYou ? 'Yours' : 'Foe'}</div>
      <div class="uc-stats">
        <span class="uc-key">HP</span><span class="uc-val">${Math.max(0, u.hp)} / ${u.maxHp}</span>
        <span class="uc-key">ATK</span><span class="uc-val">${u.atk}</span>
        <span class="uc-key">DEF</span><span class="uc-val">${u.def}</span>
        <span class="uc-key">MOVE</span><span class="uc-val">${u.move}</span>
        <span class="uc-key">RANGE</span><span class="uc-val">${u.range}</span>
        <span class="uc-key">ORDER</span><span class="uc-val">${u.order ? describeOrder(u.order) : '—'}</span>
      </div>`;
  }
  function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }
  function describeOrder(o) {
    if (o.kind === 'move')    return `march`;
    if (o.kind === 'attack')  return `strike`;
    if (o.kind === 'archery') return `volley`;
    if (o.kind === 'charge')  return `charge`;
    if (o.kind === 'hold')    return `hold`;
    return o.kind;
  }

  // ============ Lock-in / ready ============
  $('#btn-turn-ready').addEventListener('click', () => {
    if (!appState.state || appState.state.phase !== 'planning') return;
    appState.locked = true;
    $('#btn-turn-ready').classList.add('locked');
    $('#btn-turn-ready').textContent = 'Awaiting Foe…';
    appState.socket.emit('turn:ready');
  });

  // ============ Combat input collection ============
  // When the server says collect inputs, we play a quick rhythm minigame
  // for each of OUR units that has a strike order (attack/charge/archery).
  async function collectInputs(state) {
    const inputs = {};
    const myUnits = state.units.filter(u =>
      u.owner === appState.playerIdx && u.hp > 0 && u.order &&
      (u.order.kind === 'attack' || u.order.kind === 'archery' || u.order.kind === 'charge')
    );
    if (myUnits.length === 0) {
      appState.socket.emit('turn:submitInputs', { inputs: {} });
      return;
    }
    for (const u of myUnits) {
      const mult = await runRhythm(u);
      inputs[u.id] = { mult };
    }
    appState.socket.emit('turn:submitInputs', { inputs });
  }

  function runRhythm(unit) {
    return new Promise((resolve) => {
      const overlay = $('#combat-overlay');
      const marker  = $('#rhythm-marker');
      const prompt  = $('#combat-prompt');
      const promptText = (unit.order.kind === 'archery') ? 'LOOSE' :
                         (unit.order.kind === 'charge')  ? 'CHARGE!' : 'STRIKE!';
      prompt.textContent = `${unit.name} — ${promptText}`;

      overlay.classList.add('open');
      overlay.setAttribute('aria-hidden', 'false');

      let pos = 0, dir = 1;
      const speed = unit.order.kind === 'charge' ? 1.6 : 2.2;
      let pressed = false;
      let raf;
      let timeLeft = 3000;
      let lastT = performance.now();

      function tick(now) {
        const dt = now - lastT;
        lastT = now;
        timeLeft -= dt;
        pos += dir * speed * (dt / 16);
        if (pos > 100) { pos = 100; dir = -1; }
        if (pos < 0)   { pos = 0;   dir = 1; }
        marker.style.left = `calc(${pos}% - 3px)`;
        if (timeLeft <= 0) finish(0.6); // didn't press
        else raf = requestAnimationFrame(tick);
      }
      raf = requestAnimationFrame(tick);

      function press() {
        if (pressed) return;
        pressed = true;
        cancelAnimationFrame(raf);
        // gold zone is 45-55, scoring decays from center
        const dist = Math.abs(pos - 50);
        let mult;
        if (dist < 4)      mult = 2.2;
        else if (dist < 9) mult = 1.6;
        else if (dist < 16)mult = 1.1;
        else               mult = 0.7;
        // flash marker
        marker.style.background = mult >= 1.6 ? 'gold' : (mult >= 1 ? 'orange' : 'red');
        finish(mult);
      }

      function finish(mult) {
        cancelAnimationFrame(raf);
        window.removeEventListener('keydown', onKey);
        overlay.removeEventListener('click', onClick);
        overlay.removeEventListener('touchstart', onClick);
        setTimeout(() => {
          overlay.classList.remove('open');
          overlay.setAttribute('aria-hidden', 'true');
          marker.style.background = '';
          resolve(mult);
        }, 250);
      }

      function onKey(e) { if (e.code === 'Space') { e.preventDefault(); press(); } }
      function onClick(e) { e.preventDefault(); press(); }
      window.addEventListener('keydown', onKey);
      overlay.addEventListener('click', onClick);
      overlay.addEventListener('touchstart', onClick, { passive: false });
    });
  }

  // ============ State updates ============
  function applyRoomUpdate(room) {
    appState.code = room.code;
    appState.lobbyPlayers = room.players;
    $('#lobby-code').textContent = room.code;

    // Lobby vs game
    if (!room.state) {
      // lobby
      if (!$('#screen-lobby').classList.contains('active')) showScreen('lobby');
      renderLobbyVS(room);
      renderLobbyFactionGrid();
      renderReadyButton(room);
    } else {
      // game running
      const wasInLobby = $('#screen-lobby').classList.contains('active');
      appState.state = room.state;
      window.RegiaRender.syncWarriors(room.state);
      if (wasInLobby) {
        showScreen('game');
        rebuildCellOverlay();
      }
      // unlock for new turn if phase is planning and we haven't locked
      if (room.state.phase === 'planning') {
        appState.locked = false;
        $('#btn-turn-ready').classList.remove('locked');
        $('#btn-turn-ready').textContent = 'Lock In Orders';
      }
      refreshHud();
      refreshUnitCard();
      refreshHighlights();
      refreshActionButtons();
      checkEnd(room.state);
    }
  }

  function renderLobbyVS(room) {
    [0, 1].forEach(i => {
      const el = $(`#vs-p${i}`);
      const p = room.players[i];
      if (!p) {
        el.querySelector('.vs-name').textContent = '—';
        el.querySelector('.vs-faction').textContent = 'Awaiting commander';
        el.querySelector('.vs-banner').style.background = 'transparent';
        el.querySelector('.vs-ready').textContent = 'Empty';
        el.querySelector('.vs-ready').classList.remove('is-ready');
      } else {
        const f = FACTIONS[p.faction];
        el.querySelector('.vs-name').textContent = p.name + (i === appState.playerIdx ? ' (You)' : '');
        el.querySelector('.vs-faction').textContent = f.name;
        el.querySelector('.vs-banner').style.background = f.primary;
        el.querySelector('.vs-ready').textContent = p.ready ? 'Ready' : 'Awaiting';
        el.querySelector('.vs-ready').classList.toggle('is-ready', !!p.ready);
      }
    });
  }

  function renderReadyButton(room) {
    const me = room.players[appState.playerIdx];
    const btn = $('#btn-ready');
    if (!me) return;
    btn.dataset.ready = me.ready ? '1' : '0';
    btn.textContent = me.ready ? 'Cancel Ready' : 'Ready';
    btn.disabled = room.players.length < 2;
    if (room.players.length < 2) btn.textContent = 'Awaiting opponent…';
  }

  function refreshHud() {
    if (!appState.state) return;
    const me  = appState.state.players[appState.playerIdx];
    const foe = appState.state.players[1 - appState.playerIdx];
    if (me) {
      $('#hud-you-faction').textContent = FACTIONS[me.faction].name;
      $('#hud-you-name').textContent = me.name;
      $('#hud-you-morale').style.width = me.morale + '%';
    }
    if (foe) {
      $('#hud-foe-faction').textContent = FACTIONS[foe.faction].name;
      $('#hud-foe-name').textContent = foe.name;
      $('#hud-foe-morale').style.width = foe.morale + '%';
    }
    $('#hud-turn').textContent = appState.state.turn;
    const phase = appState.state.phase;
    $('#hud-phase').textContent =
      phase === 'planning' ? 'Plan your moves' :
      phase === 'resolving' ? 'Resolving…' :
      phase === 'over' ? 'Battle Ended' : '';
  }

  function checkEnd(state) {
    if (state.phase === 'over' && state.winner != null) {
      const won = state.winner === appState.playerIdx;
      const card = $('#modal-end').querySelector('.modal-card');
      card.classList.toggle('win', won);
      card.classList.toggle('lose', !won);
      $('#end-title').textContent = won ? 'Victory' : 'Defeat';
      const me  = state.players[appState.playerIdx];
      const foe = state.players[1 - appState.playerIdx];
      $('#end-flavor').textContent = won
        ? `${FACTIONS[me.faction].name} stand alone upon the field. The sun has chosen.`
        : `${FACTIONS[foe.faction].name} hold the field. ${FACTIONS[me.faction].name} retreat into legend.`;
      openModal('#modal-end');
    }
  }

  $('#btn-end-home').addEventListener('click', () => {
    closeModal('#modal-end');
    location.reload();
  });

  function pushLog(text) {
    const log = $('#log-mini');
    const e = document.createElement('div');
    e.className = 'log-entry';
    e.innerHTML = text;
    log.appendChild(e);
    log.scrollTop = log.scrollHeight;
    while (log.children.length > 30) log.removeChild(log.firstChild);
  }

  // ============ Connect ============
  function connect() {
    appState.socket = io({ transports: ['websocket', 'polling'] });

    appState.socket.on('connect', () => {
      appState.connected = true;
      $('#conn-status').textContent = 'Field is open';
      $('#conn-status').classList.add('ok');
      $('#conn-status').classList.remove('err');
    });

    appState.socket.on('disconnect', () => {
      appState.connected = false;
      $('#conn-status').textContent = 'Disconnected';
      $('#conn-status').classList.remove('ok');
      $('#conn-status').classList.add('err');
    });

    appState.socket.on('connect_error', () => {
      $('#conn-status').textContent = 'Cannot reach the field';
      $('#conn-status').classList.add('err');
    });

    appState.socket.on('room:update', (room) => {
      applyRoomUpdate(room);
    });

    appState.socket.on('chat:msg', (m) => {
      const chat = $('#lobby-chat');
      const e = document.createElement('div');
      e.className = 'chat-msg';
      e.innerHTML = `<span class="who">${escapeHtml(m.from)}:</span> ${escapeHtml(m.text)}`;
      chat.appendChild(e);
      chat.scrollTop = chat.scrollHeight;
    });

    appState.socket.on('turn:collectInputs', ({ state }) => {
      appState.state = state;
      window.RegiaRender.syncWarriors(state);
      refreshHud();
      // Now run rhythm minigames for each strike-order unit and submit inputs
      collectInputs(state);
    });

    appState.socket.on('turn:resolved', async ({ state, events }) => {
      // Hide combat overlay if it was lingering
      $('#combat-overlay').classList.remove('open');
      // Run animation timeline using the renderer
      window.RegiaRender.syncWarriors(state);
      // Pretty log entries
      events.forEach(e => {
        if (e.kind === 'arrow' || e.kind === 'melee' || e.kind === 'charge_impact') {
          const a = state.units.find(u => u.id === (e.attackerId ?? e.from?.id));
          const t = state.units.find(u => u.id === (e.defenderId ?? e.to?.id));
          if (a && t) {
            const verb = e.kind === 'arrow' ? 'looses arrows at' :
                         e.kind === 'charge_impact' ? 'crashes into' : 'strikes';
            pushLog(`<span class="who">${a.name}</span> ${verb} ${t.name} — <b>${e.dmg}</b>`);
          }
        } else if (e.kind === 'death') {
          const t = state.units.find(u => u.id === e.id);
          if (t) pushLog(`<i>${t.name} falls.</i>`);
        }
      });
      await window.RegiaRender.animateEvents(events, state);
      // Final state apply (after animation)
      appState.state = state;
      window.RegiaRender.syncWarriors(state);
      refreshHud();
      refreshUnitCard();
      refreshHighlights();
      refreshActionButtons();
      // unlock for next turn
      appState.locked = false;
      $('#btn-turn-ready').classList.remove('locked');
      $('#btn-turn-ready').textContent = 'Lock In Orders';
      checkEnd(state);
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // Auto-prefill room from URL
  const urlRoom = new URLSearchParams(location.search).get('room');
  if (urlRoom) {
    setTimeout(() => {
      $('#action-join').click();
      $('#join-code').value = urlRoom.toUpperCase();
    }, 600);
  }

  connect();
})();
