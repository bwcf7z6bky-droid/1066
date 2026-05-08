// =====================================================
// Regia Sol — Canvas renderer
// Silhouette warriors with physical, real-time animation
// =====================================================

(function () {
  const canvas = document.getElementById('stage');
  const ctx    = canvas.getContext('2d');

  // Logical canvas resolution stays fixed; CSS scales it.
  const W = canvas.width;
  const H = canvas.height;

  // Battlefield grid mapping
  const COLS = 12, ROWS = 8;
  const stageMargin = { left: 80, right: 80, top: 90, bottom: 240 };
  const stageBattle = {
    x: stageMargin.left,
    y: stageMargin.top,
    w: W - stageMargin.left - stageMargin.right,
    h: H - stageMargin.top - stageMargin.bottom
  };
  const cellW = stageBattle.w / COLS;
  const cellH = stageBattle.h / ROWS;

  function cellCenter(row, col) {
    return {
      x: stageBattle.x + col * cellW + cellW / 2,
      y: stageBattle.y + row * cellH + cellH / 2
    };
  }
  function cellGroundY(row) {
    // ground line is the bottom of the cell
    return stageBattle.y + (row + 1) * cellH;
  }

  // Warrior visual instances (one per server unit, looked up by id)
  const warriors = new Map();

  function makeWarrior(unit) {
    const c = cellCenter(unit.row, unit.col);
    return {
      id: unit.id,
      unit, // reference (will be updated on each state push)
      x: c.x,
      y: cellGroundY(unit.row),
      vx: 0, vy: 0,
      facing: unit.facing || 1,
      // pose state (normalized 0..1) for procedural animation
      stride: 0,         // walk cycle phase
      armSwing: 0,       // attack arm phase
      lean: 0,           // forward/back lean during charge / recoil
      bob: 0,            // breathing / idle
      stagger: 0,        // recoil from being hit
      // squash & stretch (for landings, charges)
      sx: 1, sy: 1,
      // specials
      flash: 0,          // damage flash
      dust: [],          // particle system for cavalry hooves
      isFalling: false,
      fallT: 0,          // 0..1 fade to ground
      action: 'idle'     // idle | march | strike | hit | charge | dead
    };
  }

  function syncWarriors(state) {
    if (!state || !state.units) return;
    state.units.forEach(u => {
      if (!warriors.has(u.id)) {
        warriors.set(u.id, makeWarrior(u));
      } else {
        const w = warriors.get(u.id);
        w.unit = u;
        // If unit died (hp 0) and we haven't started falling, start
        if (u.hp <= 0 && !w.isFalling) {
          w.isFalling = true;
          w.action = 'dying';
          w.fallT = 0;
        }
      }
    });
    // Remove warriors whose unit no longer exists
    for (const id of Array.from(warriors.keys())) {
      if (!state.units.some(u => u.id === id)) warriors.delete(id);
    }
  }

  // Active animation timeline
  let timeline = []; // queue of step objects

  function animateEvents(events, state, options = {}) {
    return new Promise(resolve => {
      // Build timeline from events
      timeline = [];
      events.forEach(e => {
        if (e.kind === 'arrow') {
          timeline.push({ type: 'arrow', ...e, t0: 0, dur: 600 });
        } else if (e.kind === 'move') {
          timeline.push({ type: 'march', id: e.id, from: e.from, to: e.to, t0: 0, dur: 500 });
        } else if (e.kind === 'charge_impact') {
          timeline.push({ type: 'charge_impact', ...e, t0: 0, dur: 600 });
        } else if (e.kind === 'melee') {
          timeline.push({ type: 'melee', ...e, t0: 0, dur: 700 });
        } else if (e.kind === 'death') {
          timeline.push({ type: 'death', id: e.id, t0: 0, dur: 800 });
        } else if (e.kind === 'morale') {
          timeline.push({ type: 'morale', player: e.player, value: e.value, t0: 0, dur: 1 });
        }
      });
      if (timeline.length === 0) {
        // Nothing to animate - resolve next tick so callers can continue
        setTimeout(resolve, 50);
        return;
      }
      timeline._onComplete = resolve;
      timeline._state = state;
    });
  }

  // ============ Drawing primitives ============
  function drawBackdrop(time) {
    // Sky gradient (canvas)
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#1a0e08');
    grad.addColorStop(0.35, '#5a2818');
    grad.addColorStop(0.6, '#b04a2a');
    grad.addColorStop(0.85, '#e8a050');
    grad.addColorStop(1, '#2a1410');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // Sun
    const sx = W / 2, sy = H * 0.55;
    const sr = 180 + Math.sin(time * 0.001) * 6;
    const sunGrad = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr);
    sunGrad.addColorStop(0, 'rgba(255,240,200,1)');
    sunGrad.addColorStop(0.3, 'rgba(255,200,120,0.85)');
    sunGrad.addColorStop(0.6, 'rgba(255,160,80,0.4)');
    sunGrad.addColorStop(1, 'rgba(255,160,80,0)');
    ctx.fillStyle = sunGrad;
    ctx.beginPath(); ctx.arc(sx, sy, sr, 0, Math.PI * 2); ctx.fill();

    // Distant mountain silhouettes (parallax 1)
    ctx.fillStyle = 'rgba(20,8,4,0.5)';
    ctx.beginPath();
    ctx.moveTo(0, H * 0.65);
    let x = 0;
    while (x < W) {
      x += 60 + Math.random() * 60;
      const peak = H * 0.6 + Math.sin(x * 0.01) * 30;
      ctx.lineTo(x, peak);
    }
    ctx.lineTo(W, H);
    ctx.lineTo(0, H);
    ctx.closePath();
    ctx.fill();

    // Mid mountains darker
    ctx.fillStyle = 'rgba(10,4,2,0.85)';
    ctx.beginPath();
    ctx.moveTo(0, H * 0.78);
    for (let i = 0; i <= 16; i++) {
      const px = (W / 16) * i;
      const py = H * 0.72 + Math.sin(i * 1.7) * 22 + Math.cos(i * 0.8) * 12;
      ctx.lineTo(px, py);
    }
    ctx.lineTo(W, H);
    ctx.lineTo(0, H);
    ctx.closePath();
    ctx.fill();

    // Ground / battlefield silhouette (where the action happens)
    drawGroundLayer();
  }

  function drawGroundLayer() {
    // Ground gradient
    const gy = stageBattle.y;
    const gh = stageBattle.h;
    const gGrad = ctx.createLinearGradient(0, gy, 0, gy + gh);
    gGrad.addColorStop(0, 'rgba(40,20,12,0.0)');
    gGrad.addColorStop(0.4, 'rgba(40,20,12,0.4)');
    gGrad.addColorStop(1, 'rgba(20,10,6,0.85)');
    ctx.fillStyle = gGrad;
    ctx.fillRect(0, gy, W, gh + 50);

    // Lane lines (faint horizontal — these are battle "rows")
    ctx.strokeStyle = 'rgba(255,200,140,0.06)';
    ctx.lineWidth = 1;
    for (let r = 0; r <= ROWS; r++) {
      const y = stageBattle.y + r * cellH;
      ctx.beginPath();
      ctx.moveTo(stageMargin.left, y);
      ctx.lineTo(W - stageMargin.right, y);
      ctx.stroke();
    }
    // Vertical column hints
    ctx.strokeStyle = 'rgba(255,200,140,0.04)';
    for (let c = 0; c <= COLS; c++) {
      const x = stageBattle.x + c * cellW;
      ctx.beginPath();
      ctx.moveTo(x, stageBattle.y);
      ctx.lineTo(x, stageBattle.y + stageBattle.h);
      ctx.stroke();
    }

    // Terrain features (silhouette trees, hills, rocks)
    const T = window.TERRAIN;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const t = T[r][c];
        if (t === '.') continue;
        const cx = stageBattle.x + c * cellW + cellW / 2;
        const gy2 = cellGroundY(r);
        ctx.fillStyle = '#0a0608';
        if (t === 'f') {
          // tree silhouette
          drawTree(cx, gy2, cellW * 0.4);
        } else if (t === 'h') {
          drawHill(cx, gy2, cellW * 0.55);
        } else if (t === 'r') {
          drawRocks(cx, gy2, cellW * 0.45);
        }
      }
    }
  }

  function drawTree(x, baseY, scale) {
    ctx.fillStyle = '#0a0608';
    // trunk
    ctx.fillRect(x - scale * 0.05, baseY - scale * 1.0, scale * 0.1, scale);
    // canopy (organic blob)
    ctx.beginPath();
    ctx.ellipse(x, baseY - scale * 1.15, scale * 0.55, scale * 0.5, 0, 0, Math.PI * 2);
    ctx.ellipse(x - scale * 0.3, baseY - scale * 1.05, scale * 0.35, scale * 0.32, 0, 0, Math.PI * 2);
    ctx.ellipse(x + scale * 0.28, baseY - scale * 1.0, scale * 0.32, scale * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  function drawHill(x, baseY, scale) {
    ctx.fillStyle = 'rgba(10,6,8,0.6)';
    ctx.beginPath();
    ctx.ellipse(x, baseY + 4, scale, scale * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  function drawRocks(x, baseY, scale) {
    ctx.fillStyle = '#0a0608';
    ctx.beginPath();
    ctx.moveTo(x - scale * 0.6, baseY);
    ctx.lineTo(x - scale * 0.4, baseY - scale * 0.5);
    ctx.lineTo(x - scale * 0.1, baseY - scale * 0.3);
    ctx.lineTo(x + scale * 0.2, baseY - scale * 0.55);
    ctx.lineTo(x + scale * 0.5, baseY - scale * 0.2);
    ctx.lineTo(x + scale * 0.6, baseY);
    ctx.closePath();
    ctx.fill();
  }

  // ============ Warrior drawing ============
  // Procedural silhouette body with type-specific gear.
  function drawWarrior(w, time) {
    const u = w.unit;
    const faction = window.FACTIONS[u.faction];
    const accent = faction.accent;
    const silhouette = '#0a0608';

    ctx.save();
    ctx.translate(w.x, w.y);
    ctx.scale(w.facing * w.sx, w.sy);

    // Death fade
    if (w.isFalling) {
      ctx.globalAlpha = 1 - w.fallT;
      ctx.translate(0, w.fallT * 18);
      ctx.rotate(w.fallT * (Math.PI / 3));
    }

    // damage flash
    const flashColor = w.flash > 0 ? `rgba(255,80,40,${w.flash})` : silhouette;

    const baseHeight = u.type === 'cavalry' ? 80 : 64;
    const bob = Math.sin(time * 0.005 + w.id) * 1.5;

    // Cavalry: draw horse first
    if (u.type === 'cavalry') {
      drawHorse(0, 0, baseHeight, flashColor, time, w);
    }

    // Body height and offsets
    const bodyY = u.type === 'cavalry' ? -baseHeight + 8 : 0;
    const yOff = bodyY + bob - w.lean * 4;

    drawBody(0, yOff, baseHeight * 0.85, u.type, flashColor, accent, w, time);

    // Faction crest above (small banner / icon)
    if (!w.isFalling) {
      ctx.save();
      ctx.scale(w.facing, 1); // un-flip so text reads
      ctx.fillStyle = accent;
      ctx.font = 'bold 12px Cinzel, serif';
      ctx.textAlign = 'center';
      ctx.fillText(faction.sigil, 0, yOff - baseHeight * 0.95);
      ctx.restore();
    }

    ctx.restore();

    // HP bar above (in screen space, no scale)
    if (!w.isFalling && u.hp > 0) {
      drawHpBar(w);
    }

    // Order indicator — small marker if this unit has an order queued
    if (!w.isFalling && u.order) {
      ctx.save();
      ctx.fillStyle = accent;
      ctx.font = 'bold 14px Cinzel, serif';
      ctx.textAlign = 'center';
      ctx.fillText('◆', w.x, w.y - baseHeight * (u.type === 'cavalry' ? 1.15 : 1.05) - 22);
      ctx.restore();
    }
  }

  function drawHorse(x, baseY, height, color, time, w) {
    // Silhouette horse from side. height = total body height.
    const bodyW = height * 1.4;
    const bodyH = height * 0.55;
    const legY = baseY;
    const bodyTop = baseY - bodyH;

    ctx.fillStyle = color;
    // Body
    ctx.beginPath();
    ctx.ellipse(0, bodyTop + bodyH / 2, bodyW * 0.5, bodyH * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Neck + head
    ctx.beginPath();
    ctx.moveTo(bodyW * 0.35, bodyTop + bodyH * 0.5);
    ctx.lineTo(bodyW * 0.5, bodyTop - bodyH * 0.25);
    ctx.lineTo(bodyW * 0.75, bodyTop - bodyH * 0.35);
    ctx.lineTo(bodyW * 0.78, bodyTop - bodyH * 0.05);
    ctx.lineTo(bodyW * 0.55, bodyTop + bodyH * 0.1);
    ctx.lineTo(bodyW * 0.45, bodyTop + bodyH * 0.55);
    ctx.closePath();
    ctx.fill();

    // Mane (a couple curves)
    ctx.beginPath();
    ctx.moveTo(bodyW * 0.42, bodyTop - bodyH * 0.05);
    ctx.lineTo(bodyW * 0.5, bodyTop - bodyH * 0.4);
    ctx.lineTo(bodyW * 0.6, bodyTop - bodyH * 0.15);
    ctx.closePath();
    ctx.fill();

    // Tail
    ctx.beginPath();
    ctx.moveTo(-bodyW * 0.45, bodyTop + bodyH * 0.15);
    ctx.quadraticCurveTo(-bodyW * 0.7, bodyTop + bodyH * 0.4, -bodyW * 0.6, bodyTop + bodyH * 0.7);
    ctx.lineTo(-bodyW * 0.45, bodyTop + bodyH * 0.55);
    ctx.closePath();
    ctx.fill();

    // Legs — animated by stride
    const stride = w.stride;
    const legs = [
      { x: -bodyW * 0.32, phase: 0 },
      { x:  bodyW * 0.30, phase: Math.PI },
      { x: -bodyW * 0.20, phase: Math.PI * 0.5 },
      { x:  bodyW * 0.18, phase: Math.PI * 1.5 }
    ];
    legs.forEach(L => {
      const swing = Math.sin(stride * Math.PI * 2 + L.phase);
      const lx = L.x + swing * height * 0.12;
      ctx.fillRect(lx - 3, bodyTop + bodyH * 0.5, 6, height * 0.55);
    });

    // Hoof dust
    if (Math.abs(w.vx) > 0.5) {
      if (Math.random() < 0.4) {
        w.dust.push({ x: -bodyW * 0.4, y: legY - 4, vx: -w.facing * (0.5 + Math.random()), vy: -1 - Math.random(), life: 1 });
      }
    }
    w.dust = w.dust.filter(d => d.life > 0);
    w.dust.forEach(d => {
      ctx.fillStyle = `rgba(180,140,80,${d.life * 0.5})`;
      ctx.beginPath();
      ctx.arc(d.x, d.y, 3 * (1.5 - d.life), 0, Math.PI * 2);
      ctx.fill();
      d.x += d.vx;
      d.y += d.vy;
      d.vy += 0.05;
      d.life -= 0.04;
    });
  }

  function drawBody(x, baseY, height, type, color, accent, w, time) {
    // baseY is feet
    const headR = height * 0.13;
    const bodyW = height * 0.28;
    const bodyH = height * 0.38;
    const legH = height * 0.32;

    const armSwing = Math.sin(w.stride * Math.PI * 2) * 0.4 + w.armSwing;

    // Legs
    ctx.fillStyle = color;
    const legSwing = Math.sin(w.stride * Math.PI * 2) * height * 0.12;
    // Back leg
    ctx.fillRect(-bodyW * 0.4 - 2, baseY - legH, 5, legH);
    // Front leg, offset by stride
    ctx.fillRect(bodyW * 0.1 - 2 + legSwing * 0.3, baseY - legH, 5, legH);

    // Torso (taper from waist to shoulders)
    const torsoY = baseY - legH;
    ctx.beginPath();
    ctx.moveTo(-bodyW * 0.4, torsoY);
    ctx.lineTo(bodyW * 0.45, torsoY);
    ctx.lineTo(bodyW * 0.5, torsoY - bodyH * 0.85);
    ctx.lineTo(-bodyW * 0.5, torsoY - bodyH * 0.85);
    ctx.closePath();
    ctx.fill();

    // Head
    const headY = torsoY - bodyH * 0.85 - headR;
    ctx.beginPath();
    ctx.arc(0, headY, headR, 0, Math.PI * 2);
    ctx.fill();

    // Helmet / headgear by type
    drawHelmet(0, headY, headR, type, accent);

    // Arms
    const shoulderY = torsoY - bodyH * 0.75;
    drawArm(bodyW * 0.4, shoulderY, height, armSwing + 0.3, color, w, type, accent, true);
    drawArm(-bodyW * 0.4, shoulderY, height, -armSwing - 0.3, color, w, type, accent, false);

    // Weapon / shield based on type
    drawWeapon(type, shoulderY, height, w, accent, color);
  }

  function drawHelmet(cx, cy, r, type, accent) {
    if (type === 'ranged') {
      // hood
      ctx.fillStyle = '#0a0608';
      ctx.beginPath();
      ctx.arc(cx, cy - r * 0.3, r * 1.15, Math.PI * 1.05, Math.PI * 1.95);
      ctx.lineTo(cx + r * 0.85, cy + r * 0.6);
      ctx.lineTo(cx - r * 0.85, cy + r * 0.6);
      ctx.closePath();
      ctx.fill();
    } else if (type === 'cavalry') {
      // crested helmet
      ctx.fillStyle = '#0a0608';
      ctx.beginPath();
      ctx.arc(cx, cy, r * 1.05, Math.PI, 0);
      ctx.fill();
      // crest
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.3, cy - r);
      ctx.quadraticCurveTo(cx, cy - r * 1.7, cx + r * 0.3, cy - r);
      ctx.lineTo(cx + r * 0.15, cy - r);
      ctx.quadraticCurveTo(cx, cy - r * 1.4, cx - r * 0.15, cy - r);
      ctx.closePath();
      ctx.fill();
    } else if (type === 'heavy') {
      // closed helm
      ctx.fillStyle = '#0a0608';
      ctx.beginPath();
      ctx.arc(cx, cy, r * 1.1, 0, Math.PI * 2);
      ctx.fill();
      // visor slit (in accent for visibility)
      ctx.fillStyle = accent;
      ctx.fillRect(cx - r * 0.5, cy - r * 0.1, r, r * 0.12);
    } else {
      // simple cap
      ctx.fillStyle = '#0a0608';
      ctx.beginPath();
      ctx.arc(cx, cy - r * 0.3, r * 1.05, Math.PI, 0);
      ctx.fill();
    }
  }

  function drawArm(sx, sy, height, swing, color, w, type, accent, isFront) {
    const armLen = height * 0.4;
    const ex = sx + Math.cos(Math.PI / 2 + swing) * armLen * 0.55;
    const ey = sy + Math.sin(Math.PI / 2 + swing) * armLen * 0.55;
    const hx = ex + Math.cos(Math.PI / 2 + swing + w.armSwing * 0.4) * armLen * 0.5;
    const hy = ey + Math.sin(Math.PI / 2 + swing + w.armSwing * 0.4) * armLen * 0.5;

    ctx.strokeStyle = color;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex, ey);
    ctx.lineTo(hx, hy);
    ctx.stroke();

    // store for weapon drawing
    if (isFront) {
      w._frontHand = { x: hx, y: hy, angle: Math.PI / 2 + swing + w.armSwing * 0.4 };
    } else {
      w._backHand = { x: hx, y: hy, angle: Math.PI / 2 + swing };
    }
  }

  function drawWeapon(type, shoulderY, height, w, accent, color) {
    const front = w._frontHand;
    if (!front) return;
    const wlen = height * 0.5;
    const wt = type;

    if (wt === 'ranged') {
      // Bow
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      const bowR = wlen * 0.55;
      ctx.arc(front.x, front.y, bowR, -Math.PI * 0.55, Math.PI * 0.55);
      ctx.stroke();
      // string
      ctx.lineWidth = 1;
      ctx.strokeStyle = accent;
      ctx.beginPath();
      ctx.moveTo(front.x + Math.cos(-Math.PI * 0.55) * bowR, front.y + Math.sin(-Math.PI * 0.55) * bowR);
      ctx.lineTo(front.x + bowR * 0.5, front.y);
      ctx.lineTo(front.x + Math.cos(Math.PI * 0.55) * bowR, front.y + Math.sin(Math.PI * 0.55) * bowR);
      ctx.stroke();
    } else if (wt === 'cavalry') {
      // Lance/spear
      ctx.strokeStyle = color;
      ctx.lineWidth = 4;
      ctx.beginPath();
      const a = Math.PI * 0.0 + w.armSwing * 0.3;
      const tipX = front.x + Math.cos(a) * wlen * 1.3;
      const tipY = front.y + Math.sin(a) * wlen * 1.3 - 8;
      ctx.moveTo(front.x - Math.cos(a) * wlen * 0.2, front.y - Math.sin(a) * wlen * 0.2);
      ctx.lineTo(tipX, tipY);
      ctx.stroke();
      // tip
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(tipX - 8, tipY - 4);
      ctx.lineTo(tipX - 8, tipY + 4);
      ctx.closePath();
      ctx.fill();
    } else if (wt === 'heavy') {
      // greataxe
      ctx.strokeStyle = color;
      ctx.lineWidth = 4;
      const a = Math.PI / 2 + w.armSwing;
      const tipX = front.x + Math.cos(a) * wlen;
      const tipY = front.y + Math.sin(a) * wlen;
      ctx.beginPath();
      ctx.moveTo(front.x, front.y);
      ctx.lineTo(tipX, tipY);
      ctx.stroke();
      // axe head
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(tipX - 14, tipY - 10);
      ctx.lineTo(tipX - 4, tipY - 16);
      ctx.lineTo(tipX + 6, tipY - 8);
      ctx.closePath();
      ctx.fill();
    } else {
      // sword
      ctx.strokeStyle = accent;
      ctx.lineWidth = 3;
      const a = Math.PI / 2 + w.armSwing * 1.4;
      const tipX = front.x + Math.cos(a) * wlen * 0.85;
      const tipY = front.y + Math.sin(a) * wlen * 0.85;
      ctx.beginPath();
      ctx.moveTo(front.x, front.y);
      ctx.lineTo(tipX, tipY);
      ctx.stroke();
      // crossguard
      ctx.lineWidth = 2;
      ctx.strokeStyle = color;
      const px = -Math.sin(a) * 6;
      const py =  Math.cos(a) * 6;
      ctx.beginPath();
      ctx.moveTo(front.x + px, front.y + py);
      ctx.lineTo(front.x - px, front.y - py);
      ctx.stroke();
    }

    // Back arm shield (for melee/heavy)
    if (wt === 'melee' || wt === 'heavy') {
      const back = w._backHand;
      if (back) {
        ctx.fillStyle = color;
        ctx.strokeStyle = accent;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.ellipse(back.x, back.y, height * 0.16, height * 0.22, 0, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
      }
    }
  }

  function drawHpBar(w) {
    const u = w.unit;
    const baseHeight = u.type === 'cavalry' ? 80 : 64;
    const yTop = w.y - baseHeight * (u.type === 'cavalry' ? 1.15 : 1.05) - 14;
    const barW = 36;
    const barH = 4;
    const x0 = w.x - barW / 2;
    // bg
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(x0 - 1, yTop - 1, barW + 2, barH + 2);
    // fill
    const pct = Math.max(0, u.hp / u.maxHp);
    const isYou = w.unit.owner === window.appState?.playerIdx;
    ctx.fillStyle = isYou ? '#e8c46a' : '#cf3b3b';
    ctx.fillRect(x0, yTop, barW * pct, barH);
  }

  // Floating damage numbers
  const popups = [];
  function popDamage(x, y, dmg, color = '#f0d590') {
    popups.push({ x, y, dmg, color, t: 0, dur: 1100 });
  }

  function drawPopups(dt) {
    popups.forEach(p => {
      const k = p.t / p.dur;
      const alpha = k < 0.2 ? k / 0.2 : 1 - (k - 0.2) / 0.8;
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
      ctx.fillStyle = p.color;
      ctx.font = 'bold 24px Cinzel, serif';
      ctx.textAlign = 'center';
      ctx.shadowColor = 'rgba(0,0,0,0.9)';
      ctx.shadowBlur = 6;
      ctx.fillText(`−${p.dmg}`, p.x, p.y - k * 50);
      ctx.restore();
      p.t += dt;
    });
    for (let i = popups.length - 1; i >= 0; i--) {
      if (popups[i].t >= popups[i].dur) popups.splice(i, 1);
    }
  }

  // Arrows in flight
  const arrowsFlying = [];
  function spawnArrow(from, to, onHit) {
    const fc = cellCenter(from.row, from.col);
    const tc = cellCenter(to.row, to.col);
    arrowsFlying.push({
      x: fc.x, y: fc.y - 30,
      tx: tc.x, ty: tc.y - 20,
      t: 0, dur: 600, onHit
    });
  }
  function drawArrows(dt) {
    arrowsFlying.forEach(a => {
      const k = a.t / a.dur;
      const x = lerp(a.x, a.tx, k);
      // arc
      const y = lerp(a.y, a.ty, k) - Math.sin(k * Math.PI) * 70;
      // arrow vector
      const dx = a.tx - a.x, dy = a.ty - a.y;
      const angle = Math.atan2(dy, dx);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.strokeStyle = '#0a0608';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-12, 0); ctx.lineTo(0, 0);
      ctx.stroke();
      ctx.fillStyle = '#c89b3a';
      ctx.beginPath();
      ctx.moveTo(0, 0); ctx.lineTo(-4, -3); ctx.lineTo(-4, 3);
      ctx.closePath(); ctx.fill();
      ctx.restore();
      a.t += dt;
    });
    for (let i = arrowsFlying.length - 1; i >= 0; i--) {
      const a = arrowsFlying[i];
      if (a.t >= a.dur) {
        if (a.onHit) a.onHit();
        arrowsFlying.splice(i, 1);
      }
    }
  }

  // ============ Animation engine ============
  let lastT = performance.now();
  function tick(now) {
    const dt = Math.min(50, now - lastT);
    lastT = now;

    drawBackdrop(now);

    // Update warriors
    warriors.forEach(w => updateWarrior(w, dt, now));

    // Process timeline
    if (timeline && timeline.length > 0) {
      processTimeline(dt);
    }

    // Sort warriors by y so closer ones overlap correctly
    const sortedWarriors = Array.from(warriors.values()).sort((a, b) => a.y - b.y);
    sortedWarriors.forEach(w => drawWarrior(w, now));

    drawArrows(dt);
    drawPopups(dt);

    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  function updateWarrior(w, dt, time) {
    // Decay flash
    if (w.flash > 0) w.flash = Math.max(0, w.flash - dt / 300);
    // Decay armSwing back to 0
    w.armSwing *= Math.pow(0.92, dt / 16);
    // Decay lean
    w.lean *= Math.pow(0.9, dt / 16);
    // Decay stagger
    if (w.stagger > 0) {
      w.stagger -= dt / 400;
      if (w.stagger < 0) w.stagger = 0;
    }
    // Squash & stretch back to 1
    w.sx += (1 - w.sx) * 0.15;
    w.sy += (1 - w.sy) * 0.15;

    // Death falling
    if (w.isFalling && w.fallT < 1) {
      w.fallT = Math.min(1, w.fallT + dt / 800);
    }

    // March / charge motion
    if (w.action === 'march' || w.action === 'charge') {
      const targetX = w._targetX, targetY = w._targetY;
      const dx = targetX - w.x;
      const dy = targetY - w.y;
      const d = Math.hypot(dx, dy);
      const speed = w.action === 'charge' ? 0.55 : 0.30;
      if (d < speed * dt) {
        w.x = targetX;
        w.y = targetY;
        w.action = 'idle';
        w.stride = 0;
        w.vx = 0;
        if (w._onArrive) { w._onArrive(); w._onArrive = null; }
      } else {
        w.x += (dx / d) * speed * dt;
        w.y += (dy / d) * speed * dt;
        w.vx = (dx / d) * speed;
        w.facing = dx >= 0 ? 1 : -1;
        // stride cycle
        w.stride = (w.stride + dt / (w.action === 'charge' ? 200 : 300)) % 1;
        w.lean = w.action === 'charge' ? 1 : 0.3;
      }
    } else {
      // idle bob
      w.bob = Math.sin(time * 0.003 + w.id) * 0.5;
    }
  }

  function processTimeline(dt) {
    const top = timeline[0];
    if (!top) return;
    top.t0 += dt;

    if (!top._started) {
      startTimelineStep(top);
      top._started = true;
    }

    if (top._step) top._step(dt);

    if (top.t0 >= top.dur) {
      if (top._end) top._end();
      timeline.shift();
      if (timeline.length === 0 && timeline._onComplete) {
        timeline._onComplete();
      }
    }
  }

  function startTimelineStep(step) {
    if (step.type === 'march') {
      const w = warriors.get(step.id);
      if (!w) return;
      const tc = cellCenter(step.to.row, step.to.col);
      w._targetX = tc.x;
      w._targetY = cellGroundY(step.to.row);
      w.action = 'march';
    } else if (step.type === 'arrow') {
      // Wait a beat for the bow draw, then loose arrow
      const fromW = warriors.get(step.from.id);
      if (fromW) {
        fromW.armSwing = 0.6;
        fromW.facing = step.to.col >= step.from.col ? 1 : -1;
      }
      step._fired = false;
      step._step = (dt) => {
        if (!step._fired && step.t0 > 200) {
          step._fired = true;
          spawnArrow(step.from, step.to, () => {
            const t = warriors.get(step.to.id);
            if (t) {
              t.flash = 1;
              t.stagger = 1;
              t.sx = 1.2; t.sy = 0.85;
              popDamage(t.x, t.y - 60, step.dmg);
            }
          });
        }
      };
    } else if (step.type === 'charge_impact') {
      // After march already moved, do impact
      const a = warriors.get(step.attackerId);
      const t = warriors.get(step.defenderId);
      if (a) { a.armSwing = 1.4; a.lean = 1.2; a.sx = 1.3; }
      if (t) {
        t.flash = 1;
        t.stagger = 1.3;
        t.x += a ? a.facing * 8 : 0;
        t.sx = 0.8; t.sy = 1.15;
        popDamage(t.x, t.y - 60, step.dmg);
      }
      // shake camera
      cameraShake(8);
    } else if (step.type === 'melee') {
      const a = warriors.get(step.attackerId);
      const t = warriors.get(step.defenderId);
      if (!a || !t) return;
      // attacker leans toward target
      a.facing = t.x >= a.x ? 1 : -1;
      step._struck = false;
      step._countered = false;
      step._step = (dt) => {
        // Wind up phase: 0..200ms
        if (step.t0 < 200) {
          a.armSwing = -0.4 - (step.t0 / 200) * 0.4;
        }
        // Strike: at 350ms
        if (step.t0 >= 350 && !step._struck) {
          step._struck = true;
          a.armSwing = 1.5;
          a.sx = 1.2;
          t.flash = 1;
          t.stagger = 1;
          t.sx = 0.9; t.sy = 1.1;
          popDamage(t.x, t.y - 60, step.dmg);
          cameraShake(4);
        }
        // Counter: at 550ms (if any)
        if (step.t0 >= 550 && !step._countered && step.counter > 0) {
          step._countered = true;
          t.armSwing = 1.2;
          a.flash = 1;
          a.stagger = 0.7;
          popDamage(a.x, a.y - 60, step.counter, '#cf3b3b');
        }
      };
    } else if (step.type === 'death') {
      const w = warriors.get(step.id);
      if (w) {
        w.isFalling = true;
        w.action = 'dying';
      }
    } else if (step.type === 'morale') {
      // handled by app.js via state update
      step.dur = 1;
    }
  }

  // Camera shake
  let camShake = 0;
  let camShakeDecay = 0;
  function cameraShake(amount) { camShake = Math.max(camShake, amount); camShakeDecay = amount; }
  function applyCameraShake() {
    if (camShake > 0) {
      const dx = (Math.random() - 0.5) * camShake;
      const dy = (Math.random() - 0.5) * camShake;
      canvas.style.transform = `translate(${dx}px, ${dy}px)`;
      camShake *= 0.85;
      if (camShake < 0.1) {
        camShake = 0;
        canvas.style.transform = '';
      }
    }
  }
  setInterval(applyCameraShake, 16);

  // Helpers
  function lerp(a, b, t) { return a + (b - a) * t; }

  // ============ Public API ============
  window.RegiaRender = {
    syncWarriors,
    animateEvents,
    cellCenter,
    cellGroundY,
    cellW: () => cellW,
    cellH: () => cellH,
    stageBattle: () => stageBattle,
    canvas
  };
})();
