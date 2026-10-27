// In-game HUD: tachometer, minimap radar, heat meter, pursuit monitor,
// race info, toasts, banners and the dispatch radio log.
import { BOUND, HALF, N, SP, ROAD_W, WALK, lineAt, districtOf } from './world.js';
import { clamp, fmtMoney, fmtTime, MPH } from './util.js';

const $ = (id) => document.getElementById(id);

export class HUD {
  constructor(game) {
    this.game = game;
    this.tach = $('tach'); this.tctx = this.tach.getContext('2d');
    this.mm = $('minimap'); this.mctx = this.mm.getContext('2d');
    this.map = this.renderMap(game.world);
    this.toastQ = [];
    this.radioLog = [];
  }

  renderMap(world) {
    const S = 0.5, size = Math.ceil(BOUND * 2 * S);
    const c = document.createElement('canvas'); c.width = c.height = size;
    const g = c.getContext('2d');
    g.scale(S, S); g.translate(BOUND, BOUND);
    g.fillStyle = '#1d2a2c'; g.fillRect(-BOUND, -BOUND, BOUND * 2, BOUND * 2);
    for (const b of world.blocks) {
      const x0 = lineAt(b.i) + ROAD_W / 2, x1 = lineAt(b.i + 1) - ROAD_W / 2, z0 = lineAt(b.j) + ROAD_W / 2, z1 = lineAt(b.j + 1) - ROAD_W / 2;
      g.fillStyle = b.kind === 'park' ? '#2f4a2a' : b.kind === 'lot' ? '#2a3a4c' : b.dist === 'port' ? '#3a3328' : b.dist === 'downtown' ? '#2d2a28' : '#33352a';
      g.fillRect(x0, z0, x1 - x0, z1 - z0);
      g.fillStyle = 'rgba(0,0,0,0.35)';
      for (const a of b.boxes) if (a.h > 3) g.fillRect(a.x0, a.z0, a.x1 - a.x0, a.z1 - a.z0);
    }
    g.fillStyle = '#8f8a7c';
    for (let i = 0; i < N; i++) {
      g.fillRect(lineAt(i) - ROAD_W / 2, -HALF - ROAD_W / 2, ROAD_W, HALF * 2 + ROAD_W);
      g.fillRect(-HALF - ROAD_W / 2, lineAt(i) - ROAD_W / 2, HALF * 2 + ROAD_W, ROAD_W);
    }
    g.fillStyle = '#1b3540'; g.fillRect(-BOUND - 40, -BOUND, 40, BOUND * 2);
    return c;
  }

  // ---------- per-frame ----------
  update(dt) {
    const G = this.game, p = G.player;
    if (!p) return;
    this.drawTach(p);
    this.drawMinimap(p);
    $('nos-fill').style.width = `${p.nitro * 100}%`;
    $('nos-fill').classList.toggle('on', p.nitroOn);
    $('sb-fill').style.width = `${G.sbMeter * 100}%`;
    $('sb-fill').classList.toggle('on', G.sbActive);
    // pursuit HUD
    const pol = G.police, pp = pol.p;
    const inP = pol.active;
    $('pursuit').classList.toggle('show', inP);
    $('bounty-box').classList.toggle('show', inP || G.mode === 'roam');
    const heat = inP ? pp.heat : (G.carEntry()?.heat || 0);
    const hm = $('heat');
    for (let k = 0; k < 5; k++) hm.children[k].classList.toggle('on', k < heat);
    hm.classList.toggle('pursuit', inP);
    if (inP) {
      $('b-bounty').textContent = pp.bounty.toLocaleString('en-US');
      $('b-cost').textContent = fmtMoney(pp.cost);
      $('b-units').textContent = pol.units.filter((u) => !u.wrecked && (u.mode === 'chase' || u.mode === 'search' || u.mode === 'roadblock')).length;
      $('b-immob').textContent = pp.immob;
      $('b-time').textContent = fmtTime(pp.t).slice(0, -3);
      const cd = pol.state === 'cooldown';
      $('pm-label').textContent = cd ? 'COOLDOWN' : pp.bust > 0.02 ? 'BUSTED' : 'EVADE';
      $('pm-evade').style.width = `${(cd ? pp.cooldown : pp.evade) * 50}%`;
      $('pm-evade').classList.toggle('cool', cd);
      $('pm-bust').style.width = `${pp.bust * 50}%`;
      $('pursuit').classList.toggle('cooldown', cd);
      $('pursuit').classList.toggle('danger', pp.bust > 0.3);
    } else {
      $('b-bounty').textContent = G.save.bounty.toLocaleString('en-US');
      $('b-cost').textContent = fmtMoney(G.save.cash);
    }
    $('b-label1').textContent = inP ? 'PURSUIT BOUNTY' : 'BOUNTY';
    $('b-label2').textContent = inP ? 'COST TO STATE' : 'CASH';
    $('b-extra').style.display = inP ? '' : 'none';
    // race info
    const r = G.race;
    $('raceinfo').classList.toggle('show', !!r);
    if (r) {
      const pl = r.player;
      let html = `<div class="ri-type">${r.ev.name.toUpperCase()}</div>`;
      if (r.type === 'tollbooth') html += `<div class="ri-big ${r.timeLeft < 5 ? 'warn' : ''}">${Math.max(0, r.timeLeft).toFixed(1)}</div><div class="ri-sub">CHECKPOINT ${Math.min(pl.wp + 1, r.wps.length)}/${r.wps.length}</div>`;
      else if (r.type === 'speedtrap') html += `<div class="ri-big">${G.fmtSpeed(pl.sum, true)}</div><div class="ri-sub">POS ${r.position(pl)}/${r.racers.length} · TRAPS ${pl.traps.length}/${r.wps.filter((w) => w.trap).length}</div>`;
      else {
        html += `<div class="ri-big">${r.position(pl)}<span>/${r.racers.filter((x) => !x.out).length}</span></div>`;
        if (r.closed) html += `<div class="ri-sub">LAP ${Math.min(pl.lap + 1, r.ev.laps)}/${r.ev.laps}</div>`;
      }
      html += `<div class="ri-time">${fmtTime(r.t)}</div>`;
      if (r.type === 'drag') html += `<div class="ri-sub">GEAR ${p.gear + 1} · ↑/W SHIFT UP · ↓/S DOWN · ←→ LANE</div>`;
      $('raceinfo').innerHTML = html;
      $('countdown').textContent = r.state === 'countdown' && r.count < 3 ? Math.ceil(r.count) : '';
    } else $('countdown').textContent = '';
    // prompt
    $('prompt').textContent = G.prompt || '';
    $('prompt').classList.toggle('show', !!G.prompt);
  }

  drawTach(p) {
    const c = this.tctx, W = this.tach.width, H = this.tach.height;
    c.clearRect(0, 0, W, H);
    const cx = W * 0.55, cy = H * 0.58, R = H * 0.46;
    const a0 = Math.PI * 0.8, a1 = Math.PI * 2.2;
    const rpmA = (r) => a0 + (a1 - a0) * (r / 9000);
    c.lineCap = 'butt';
    c.lineWidth = 10; c.strokeStyle = 'rgba(10,10,10,0.55)';
    c.beginPath(); c.arc(cx, cy, R, a0, a1); c.stroke();
    c.strokeStyle = 'rgba(210,40,20,0.85)';
    c.beginPath(); c.arc(cx, cy, R, rpmA(7200), a1); c.stroke();
    // ticks
    c.strokeStyle = '#e8dcc0'; c.fillStyle = '#e8dcc0';
    c.font = `600 ${Math.round(R * 0.15)}px Oswald, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
    for (let k = 0; k <= 9; k++) {
      const a = rpmA(k * 1000);
      c.lineWidth = 2;
      c.beginPath(); c.moveTo(cx + Math.cos(a) * (R - 12), cy + Math.sin(a) * (R - 12)); c.lineTo(cx + Math.cos(a) * (R + 4), cy + Math.sin(a) * (R + 4)); c.stroke();
      c.fillText(k, cx + Math.cos(a) * (R - 26), cy + Math.sin(a) * (R - 26));
    }
    // fill arc
    const grad = c.createLinearGradient(cx - R, 0, cx + R, 0);
    grad.addColorStop(0, '#d8a040'); grad.addColorStop(1, '#ff5a20');
    c.strokeStyle = grad; c.lineWidth = 6;
    c.beginPath(); c.arc(cx, cy, R - 4, a0, rpmA(clamp(p.rpm, 0, 9000))); c.stroke();
    // needle
    const na = rpmA(clamp(p.rpm, 0, 9000));
    c.strokeStyle = '#ff3a1a'; c.lineWidth = 3;
    c.beginPath(); c.moveTo(cx - Math.cos(na) * 10, cy - Math.sin(na) * 10); c.lineTo(cx + Math.cos(na) * (R - 6), cy + Math.sin(na) * (R - 6)); c.stroke();
    c.fillStyle = '#222'; c.beginPath(); c.arc(cx, cy, 7, 0, Math.PI * 2); c.fill();
    // digital speed + gear
    const spd = this.game.fmtSpeed(Math.abs(p.vLong), true);
    c.fillStyle = '#fff4dc'; c.font = `700 ${Math.round(R * 0.5)}px Oswald, sans-serif`;
    c.fillText(spd, cx + R * 0.18, cy + R * 0.48);
    c.font = `600 ${Math.round(R * 0.14)}px Oswald, sans-serif`; c.fillStyle = '#d8b878';
    c.fillText(this.game.save.settings.mph ? 'MPH' : 'KM/H', cx + R * 0.18, cy + R * 0.78);
    c.font = `700 ${Math.round(R * 0.3)}px Oswald, sans-serif`;
    c.fillStyle = p.rpm > 7200 ? '#ff4a20' : '#ffcf6a';
    c.fillText(p.vLong < -0.5 ? 'R' : p.speed < 0.5 && p.input.throttle === 0 ? 'N' : String(p.gear + 1), cx - R * 0.42, cy + R * 0.18);
  }

  drawMinimap(p) {
    const G = this.game, c = this.mctx, W = this.mm.width, R = W / 2;
    c.clearRect(0, 0, W, W);
    c.save();
    c.beginPath(); c.arc(R, R, R - 3, 0, Math.PI * 2); c.clip();
    c.fillStyle = '#141a1b'; c.fillRect(0, 0, W, W);
    const zoom = (R / 150) / (1 + clamp(p.speed / 80, 0, 1) * 0.6);
    c.translate(R, R + R * 0.25);
    c.rotate(p.heading - Math.PI);
    c.scale(zoom, zoom);
    c.translate(-p.pos.x, -p.pos.z);
    c.globalAlpha = 0.92;
    c.drawImage(this.map, -BOUND, -BOUND, BOUND * 2, BOUND * 2);
    c.globalAlpha = 1;
    const dot = (x, z, r, col) => { c.fillStyle = col; c.beginPath(); c.arc(x, z, r / zoom, 0, Math.PI * 2); c.fill(); };
    // hiding spots + pursuit breakers
    c.font = `bold ${14 / zoom}px sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
    for (const h of G.world.hidingSpots) {
      c.fillStyle = G.police.state === 'cooldown' ? 'rgba(60,170,255,0.55)' : 'rgba(60,140,220,0.25)';
      c.fillRect(h.x - h.hw, h.z - h.hd, h.hw * 2, h.hd * 2);
    }
    for (const b of G.world.breakers) {
      if (b.state !== 'ready') continue;
      c.fillStyle = '#ffb020';
      c.beginPath(); c.moveTo(b.x, b.z - 9 / zoom); c.lineTo(b.x + 8 / zoom, b.z + 6 / zoom); c.lineTo(b.x - 8 / zoom, b.z + 6 / zoom); c.closePath(); c.fill();
    }
    // race route
    if (G.race) {
      const r = G.race;
      c.strokeStyle = 'rgba(255,190,60,0.85)'; c.lineWidth = 6 / zoom; c.lineJoin = 'round';
      c.beginPath(); c.moveTo(r.start.x, r.start.z);
      for (const w of r.wps) c.lineTo(w.x, w.z);
      c.stroke();
      const nw = r.nextWaypoint();
      dot(nw.x, nw.z, 6, '#fff');
      for (const rc of r.racers) if (!rc.isPlayer && !rc.out) dot(rc.veh.pos.x, rc.veh.pos.z, 4.5, '#ffd040');
    }
    // free-roam event markers + safehouse
    if (G.mode === 'roam' && !G.police.active) {
      for (const m of G.markers) { dot(m.x, m.z, 6, m.color); }
      dot(G.safehouse.x, G.safehouse.z, 7, '#40e070');
    }
    // traffic
    for (const t of G.traffic.cars) dot(t.pos.x, t.pos.z, 2.2, 'rgba(220,220,210,0.6)');
    // police
    const blink = Math.floor(performance.now() / 180) % 2;
    for (const u of G.police.units) {
      if (u.wrecked) { dot(u.pos.x, u.pos.z, 3, '#555'); continue; }
      const col = u.mode === 'patrol' ? '#7aa0ff' : blink ? '#ff2a2a' : '#2a6aff';
      dot(u.pos.x, u.pos.z, 4.5, col);
      if (u.mode === 'patrol' || u.mode === 'search') {
        // vision cone
        c.fillStyle = u.mode === 'search' ? 'rgba(255,60,60,0.12)' : 'rgba(120,160,255,0.12)';
        c.beginPath(); c.moveTo(u.pos.x, u.pos.z);
        c.arc(u.pos.x, u.pos.z, 75, Math.PI / 2 - u.heading - 0.5, Math.PI / 2 - u.heading + 0.5); c.closePath(); c.fill();
      }
    }
    if (G.police.heli) { c.strokeStyle = '#ff4040'; c.lineWidth = 2 / zoom; c.beginPath(); c.arc(G.police.heli.x, G.police.heli.z, 140, 0, Math.PI * 2); c.stroke(); dot(G.police.heli.x, G.police.heli.z, 6, '#ff8080'); }
    for (const rb of G.police.roadblocks) dot(rb.x, rb.z, 7, '#ff6020');
    c.restore();
    // player arrow
    c.save(); c.translate(R, R + R * 0.25);
    c.fillStyle = '#ffe080'; c.strokeStyle = '#000'; c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(0, -9); c.lineTo(6, 7); c.lineTo(0, 3); c.lineTo(-6, 7); c.closePath(); c.fill(); c.stroke();
    c.restore();
    // waypoint arrow at edge
    if (G.race) {
      const nw = G.race.nextWaypoint();
      const a = Math.atan2(nw.x - p.pos.x, nw.z - p.pos.z) - p.heading;
      const d = Math.hypot(nw.x - p.pos.x, nw.z - p.pos.z) * zoom;
      if (d > R * 0.9) {
        c.save(); c.translate(R, R); c.rotate(-a);
        c.fillStyle = '#ffcf40'; c.beginPath(); c.moveTo(0, -R + 6); c.lineTo(7, -R + 18); c.lineTo(-7, -R + 18); c.fill(); c.restore();
      }
    }
    // rim
    c.strokeStyle = G.police.active ? (Math.floor(performance.now() / 250) % 2 ? '#ff3030' : '#3060ff') : 'rgba(230,200,140,0.7)';
    c.lineWidth = 4; c.beginPath(); c.arc(R, R, R - 3, 0, Math.PI * 2); c.stroke();
  }

  // ---------- messages ----------
  toast(text) {
    const el = document.createElement('div');
    el.className = 'toast'; el.textContent = text;
    $('toasts').appendChild(el);
    while ($('toasts').children.length > 4) $('toasts').firstChild.remove();
    setTimeout(() => el.classList.add('out'), 2200);
    setTimeout(() => el.remove(), 2700);
  }
  banner(text, ms = 1500) {
    const b = $('banner');
    b.textContent = text; b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
    clearTimeout(this.bt); this.bt = setTimeout(() => b.classList.remove('show'), ms);
  }
  radio(text) {
    const box = $('radio');
    const line = document.createElement('div');
    line.innerHTML = `<b>DISPATCH</b> ${text}`;
    box.appendChild(line);
    while (box.children.length > 3) box.firstChild.remove();
    box.classList.add('show');
    clearTimeout(this.rt); this.rt = setTimeout(() => box.classList.remove('show'), 6000);
  }
  district(name) {
    const d = $('district');
    d.textContent = name; d.classList.remove('show'); void d.offsetWidth; d.classList.add('show');
  }
  setVisible(v) { $('hud').style.display = v ? '' : 'none'; }
}
