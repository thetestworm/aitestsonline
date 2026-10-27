// Safehouse menus: career board (The Fifteen), garage, performance shop,
// rap sheet and settings, plus post-event screens.
import { CARS, UPGRADES, upgradeCost, carSpec, perfRating, RIVALS, RIVAL_EVENTS, RIVAL_MILESTONES, DUELS, MS_TYPES, TYPE_NAMES, rivalStatus, clearSave, newSave } from './career.js';
import { fmtMoney, fmtTime, MPH } from './util.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const PAINTS = [0xc8c2b4, 0x2a5aa8, 0xd8a020, 0x1f6b48, 0xe8e8e8, 0x202226, 0x8a1010, 0xe06a10, 0x6a2a90, 0x30a0c0, 0xd04a7a, 0x5a5a5a];
const hex = (n) => '#' + n.toString(16).padStart(6, '0');

export class Menu {
  constructor(game) {
    this.game = game;
    this.tab = 'career';
    $('menu').addEventListener('click', (e) => this.onClick(e));
  }
  open(tab) {
    if (tab) this.tab = tab;
    $('menu').classList.add('show');
    this.render();
  }
  close() { $('menu').classList.remove('show'); }
  get save() { return this.game.save; }

  render() {
    const s = this.save;
    const tabs = [['career', 'THE FIFTEEN'], ['garage', 'GARAGE'], ['perf', 'PERFORMANCE'], ['rap', 'RAP SHEET'], ['settings', 'OPTIONS']];
    const car = s.garage[s.current];
    $('menu').innerHTML = `
      <div class="m-head">
        <div class="m-logo">HEAT<span>RUN</span><small>PORT CALDER</small></div>
        <div class="m-stats"><div><label>CASH</label>${fmtMoney(s.cash)}</div><div><label>BOUNTY</label>${s.bounty.toLocaleString('en-US')}</div><div><label>RANK</label>${s.rivalIdx >= 15 ? '#1' : 'UNRANKED'}</div></div>
      </div>
      <div class="m-tabs">${tabs.map(([k, l]) => `<button data-tab="${k}" class="${this.tab === k ? 'on' : ''}">${l}</button>`).join('')}
        <button class="go" data-act="roam">FREE ROAM ▸</button></div>
      <div class="m-body">${this[this.tab]()}</div>
      <div class="m-foot">Current ride: <b>${esc(CARS[car.id].name)}</b> · Heat ${'▮'.repeat(car.heat)}${'▯'.repeat(5 - car.heat)} · Impound strikes ${car.strikes}/3${s.jailFree ? ` · Get-out-of-jail cards: ${s.jailFree}` : ''}</div>`;
  }

  career() {
    const s = this.save;
    const idx = Math.min(s.rivalIdx, 14);
    const list = RIVALS.map((rv, k) => {
      const st = k < s.rivalIdx ? 'beaten' : k === s.rivalIdx ? 'current' : 'locked';
      return `<div class="rv ${st}" data-rv="${k}"><span class="rk">#${rv.rank}</span><span class="nm">${esc(rv.tag)}</span><span class="cr">${esc(CARS[rv.car].name)}</span>${st === 'beaten' ? '<span class="x">DEFEATED</span>' : ''}</div>`;
    }).join('');
    const sel = this.selRival ?? idx;
    const rv = RIVALS[sel];
    let detail;
    if (s.rivalIdx >= 15) {
      detail = `<div class="rv-detail"><h2>YOU ARE #1</h2><p>Every name on The Fifteen has fallen. Port Calder is yours. Keep running from the law in free roam, or replay events below.</p>${this.eventList(14, true)}</div>`;
    } else {
      const status = rivalStatus(s, sel);
      const locked = sel > s.rivalIdx, beaten = sel < s.rivalIdx;
      const ms = RIVAL_MILESTONES[sel];
      detail = `<div class="rv-detail">
        <div class="rv-card" style="--c:${hex(rv.color)}">
          <div class="rv-rank">#${rv.rank}</div>
          <div><h2>${esc(rv.tag)}</h2><div class="rv-name">${esc(rv.name)}</div><div class="rv-car">${esc(CARS[rv.car].name)}</div></div>
        </div>
        ${locked ? '<p class="dim">Beat the rivals above this one to unlock their requirements.</p>' : `
        <h3>RACE EVENTS <span>${status.racesDone}/${status.racesNeed}</span></h3>
        ${this.eventList(sel, beaten)}
        <h3>MILESTONES <span>${status.msDone}/${status.msNeed}</span></h3>
        <div class="ms">${ms.map((m) => `<div class="${s.milestones.includes(m.id) ? 'done' : ''}">${MS_TYPES[m.type].label} <b>${MS_TYPES[m.type].fmt(m.target)}</b> <i>(one pursuit, then evade)</i></div>`).join('')}</div>
        <h3>BOUNTY <span>${Math.min(s.bounty, rv.bounty).toLocaleString('en-US')} / ${rv.bounty.toLocaleString('en-US')}</span></h3>
        <div class="bar"><div style="width:${Math.min(100, (s.bounty / rv.bounty) * 100)}%"></div></div>
        ${beaten ? '<p class="dim">Defeated.</p>' : `<button class="big ${status.ok ? '' : 'disabled'}" data-act="duel" data-i="${sel}">${status.ok ? `CHALLENGE ${esc(rv.tag)} — ${DUELS[sel].length} RACES` : 'COMPLETE REQUIREMENTS TO CHALLENGE'}</button>`}`}
      </div>`;
    }
    return `<div class="career"><div class="rv-list">${list}</div>${detail}</div>`;
  }
  eventList(idx, replay) {
    return `<div class="evs">${RIVAL_EVENTS[idx].map((e) => {
      const won = this.save.won.includes(e.id);
      return `<div class="ev ${won ? 'won' : ''}"><span class="ty">${TYPE_NAMES[e.type]}</span><span class="en">${esc(e.name)}</span><span class="rw">${fmtMoney(e.cash)} · ${e.bounty.toLocaleString('en-US')} bounty</span><button data-act="event" data-ev="${e.id}">${won ? 'REPLAY' : 'RACE'}</button></div>`;
    }).join('')}</div>`;
  }

  garage() {
    const s = this.save;
    const owned = s.garage.map((g, k) => {
      const c = CARS[g.id], sp = carSpec(g);
      return `<div class="car ${k === s.current ? 'sel' : ''}"><div class="sw" style="background:${hex(g.color)}"></div><b>${esc(c.name)}</b><span>Tier ${c.tier} · Rating ${perfRating(sp)} · Heat ${g.heat} · Strikes ${g.strikes}/3</span>${k === s.current ? '<em>DRIVING</em>' : `<button data-act="usecar" data-i="${k}">DRIVE</button>`}</div>`;
    }).join('');
    const owned_ = new Set(s.garage.map((g) => g.id));
    const forSale = Object.entries(CARS).filter(([id]) => s.unlocked.includes(id) && !owned_.has(id)).map(([id, c]) => {
      const sp = carSpec({ id, up: {} });
      return `<div class="car"><div class="sw" style="background:${hex(c.color)}"></div><b>${esc(c.name)}</b><span>Tier ${c.tier} · Top ${Math.round(sp.top * MPH)} mph · Rating ${perfRating(sp)}</span><button data-act="buy" data-id="${id}" class="${s.cash < c.price ? 'disabled' : ''}">BUY ${fmtMoney(c.price)}</button></div>`;
    }).join('');
    const locked = Object.entries(CARS).filter(([id]) => !s.unlocked.includes(id)).map(([, c]) => `<div class="car locked"><b>${esc(c.name)}</b><span>Unlocked by beating a rival</span></div>`).join('');
    return `<div class="garage"><h3>YOUR CARS</h3>${owned}<h3>DEALER</h3>${forSale}${locked}</div>`;
  }

  perf() {
    const s = this.save, g = s.garage[s.current], c = CARS[g.id], sp = carSpec(g);
    const rows = Object.entries(UPGRADES).map(([k, u]) => {
      const st = g.up[k] || 0;
      const pips = [0, 1, 2].map((i) => `<i class="${i < st ? 'on' : ''}"></i>`).join('');
      const btn = st >= 3 ? '<em>MAXED</em>' : `<button data-act="up" data-k="${k}" class="${s.cash < upgradeCost(g.id, st) ? 'disabled' : ''}">STAGE ${st + 1} · ${fmtMoney(upgradeCost(g.id, st))}</button>`;
      return `<div class="up"><b>${u.name}</b><span>${u.desc}</span><div class="pips">${pips}</div>${btn}</div>`;
    }).join('');
    const stat = (l, v, m) => `<div class="st"><label>${l}</label><div class="bar"><div style="width:${Math.min(100, (v / m) * 100)}%"></div></div></div>`;
    return `<div class="perf"><div class="perf-l"><h2>${esc(c.name)}</h2>
      ${stat('TOP SPEED', sp.top, 100)}${stat('ACCELERATION', sp.accel, 16)}${stat('HANDLING', sp.grip, 13)}${stat('BRAKING', sp.brake, 40)}${stat('NITROUS', sp.nitroDur, 7)}
      <p>Top speed ≈ ${Math.round(sp.top * MPH)} mph · Rating ${perfRating(sp)}</p>
      <h3>PAINT SHOP <span>${fmtMoney(1500)}${g.heat > 1 ? ' · lowers heat by 1' : ''}</span></h3>
      <div class="paints">${PAINTS.map((p) => `<button data-act="paint" data-c="${p}" style="background:${hex(p)}" class="${p === g.color ? 'sel' : ''}"></button>`).join('')}</div>
      </div><div class="perf-r">${rows}</div></div>`;
  }

  rap() {
    const st = this.save.stats;
    const rows = [['Pursuits', st.pursuits], ['Pursuits evaded', st.evaded], ['Times busted', st.busted], ['Longest pursuit', fmtTime(st.longest).slice(0, -3)], ['Cops immobilized', st.immob], ['Races won', st.racesWon], ['Career bounty', this.save.bounty.toLocaleString('en-US')], ['Rivals defeated', `${this.save.rivalIdx}/15`]];
    return `<div class="rap"><h2>RAP SHEET</h2><table>${rows.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('')}</table>
      <h3>HOW IT WORKS</h3>
      <p>Win each rival's race events, pull off their pursuit milestones, and build up your bounty, then challenge them. Speeding or ramming near a patrol starts a pursuit. Break line of sight to fill the <b>EVADE</b> meter, then hide until <b>COOLDOWN</b> fills. Covered car parks (blue on the radar) speed up cooldown. Orange triangles are pursuit breakers: smash the supports to drop them on the cops behind you. If you stop with cops nearby, the <b>BUSTED</b> meter fills. Three busts and the car is impounded.</p></div>`;
  }

  settings() {
    const st = this.save.settings;
    return `<div class="settings">
      <label><input type="checkbox" data-set="radio" ${st.radio ? 'checked' : ''}> Spoken police dispatch (speech synthesis)</label>
      <label><input type="checkbox" data-set="music" ${st.music !== false ? 'checked' : ''}> Music</label>
      <label><input type="checkbox" data-set="mph" ${st.mph ? 'checked' : ''}> Use MPH (off = KM/H)</label>
      <label><input type="checkbox" data-set="hq" ${st.hq !== false ? 'checked' : ''}> High quality (shadows + bloom)</label>
      <label>Volume <input type="range" min="0" max="1" step="0.05" value="${st.volume}" data-set="volume"></label>
      <h3>CONTROLS</h3>
      <table class="keys">
        <tr><td>W / ↑</td><td>Throttle</td></tr><tr><td>S / ↓</td><td>Brake / reverse</td></tr><tr><td>A D / ← →</td><td>Steer</td></tr>
        <tr><td>Space</td><td>Handbrake</td></tr><tr><td>Shift / N</td><td>Nitrous</td></tr><tr><td>E / Ctrl</td><td>Speedbreaker</td></tr>
        <tr><td>C</td><td>Camera</td></tr><tr><td>R</td><td>Reset car</td></tr><tr><td>Enter</td><td>Start event / safehouse</td></tr><tr><td>Esc / P</td><td>Pause</td></tr>
      </table>
      <button class="danger" data-act="reset">RESET CAREER</button></div>`;
  }

  onClick(e) {
    const t = e.target.closest('[data-tab],[data-act],[data-rv]');
    if (!t) return;
    const G = this.game, s = this.save;
    G.audio.ui();
    if (t.dataset.tab) { this.tab = t.dataset.tab; this.selRival = undefined; return this.render(); }
    if (t.dataset.rv !== undefined) { this.selRival = +t.dataset.rv; return this.render(); }
    if (t.classList.contains('disabled')) return;
    const act = t.dataset.act;
    if (act === 'roam') { this.close(); G.startRoam(); }
    else if (act === 'event') {
      const ev = RIVAL_EVENTS.flat().find((x) => x.id === t.dataset.ev);
      this.close(); G.startRace(ev);
    } else if (act === 'duel') { this.close(); G.startDuel(+t.dataset.i); }
    else if (act === 'usecar') { s.current = +t.dataset.i; G.persist(); this.render(); }
    else if (act === 'buy') {
      const c = CARS[t.dataset.id];
      if (s.cash >= c.price) { s.cash -= c.price; s.garage.push({ id: t.dataset.id, up: {}, color: c.color, heat: 1, strikes: 0 }); s.current = s.garage.length - 1; G.persist(); this.tab = 'perf'; this.render(); }
    } else if (act === 'up') {
      const g = s.garage[s.current], k = t.dataset.k, st = g.up[k] || 0, cost = upgradeCost(g.id, st);
      if (st < 3 && s.cash >= cost) { s.cash -= cost; g.up[k] = st + 1; G.persist(); this.render(); }
    } else if (act === 'paint') {
      const g = s.garage[s.current], col = +t.dataset.c;
      if (col !== g.color && s.cash >= 1500) { s.cash -= 1500; g.color = col; g.heat = Math.max(1, g.heat - 1); G.persist(); this.render(); }
    } else if (act === 'reset') {
      if (confirm('Erase your career and start over?')) { clearSave(); G.save = newSave(); G.persist(); this.tab = 'career'; this.render(); }
    }
  }
  bindSettings() {
    $('menu').addEventListener('change', (e) => {
      const k = e.target.dataset.set; if (!k) return;
      const st = this.save.settings;
      st[k] = e.target.type === 'checkbox' ? e.target.checked : +e.target.value;
      this.game.applySettings();
      this.game.persist();
    });
  }
}

// Rival reward cards: six face down, pick two.
export function showMarkers(game, idx, done) {
  const rv = RIVALS[idx];
  const pool = [
    { kind: 'car', label: `${CARS[rv.car].name.toUpperCase()}`, sub: "Your rival's car, fully tuned" },
    { kind: 'cash', amt: 10000 + idx * 6000, label: 'CASH', sub: '' },
    { kind: 'cash', amt: 5000 + idx * 3000, label: 'CASH', sub: '' },
    { kind: 'jail', label: 'GET OUT OF JAIL', sub: 'Next bust costs no strike' },
    { kind: 'strike', label: 'IMPOUND RELEASE', sub: 'Clears strikes on your car' },
    { kind: 'upgrade', label: 'FREE UPGRADE', sub: 'Random stage on your car' },
  ].sort(() => Math.random() - 0.5);
  let picks = 0;
  const el = $('markers');
  el.innerHTML = `<h1>${rv.tag} DEFEATED</h1><p>Pick two markers</p><div class="cards">${pool.map((p, k) => `<div class="card" data-k="${k}"><div class="back">?</div></div>`).join('')}</div><button class="big" id="mk-done" style="visibility:hidden">CONTINUE</button>`;
  el.classList.add('show');
  el.querySelectorAll('.card').forEach((cd) => cd.addEventListener('click', () => {
    if (picks >= 2 || cd.classList.contains('open')) return;
    picks++;
    const p = pool[+cd.dataset.k];
    const s = game.save, g = s.garage[s.current];
    if (p.kind === 'car') {
      s.garage.push({ id: rv.car, up: { engine: 2, trans: 2, susp: 2, tires: 2, nitrous: 1 }, color: rv.color, heat: 1, strikes: 0 });
      if (!s.unlocked.includes(rv.car)) s.unlocked.push(rv.car);
    } else if (p.kind === 'cash') { s.cash += p.amt; p.sub = fmtMoney(p.amt); }
    else if (p.kind === 'jail') s.jailFree++;
    else if (p.kind === 'strike') g.strikes = 0;
    else if (p.kind === 'upgrade') {
      const ks = Object.keys(UPGRADES).filter((k) => (g.up[k] || 0) < 3);
      if (ks.length) { const k = ks[Math.floor(Math.random() * ks.length)]; g.up[k] = (g.up[k] || 0) + 1; p.sub = `${UPGRADES[k].name} stage ${g.up[k]}`; }
    }
    cd.classList.add('open');
    cd.innerHTML = `<div class="front"><b>${p.label}</b><span>${p.sub}</span></div>`;
    game.audio.checkpoint();
    if (picks === 2) {
      el.querySelectorAll('.card:not(.open)').forEach((x) => { const q = pool[+x.dataset.k]; x.classList.add('open', 'missed'); x.innerHTML = `<div class="front"><b>${q.label}</b><span>${q.sub}</span></div>`; });
      $('mk-done').style.visibility = 'visible';
      game.persist();
    }
  }));
  $('mk-done').onclick = () => { el.classList.remove('show'); done(); };
}
