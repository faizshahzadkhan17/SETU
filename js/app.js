/*
 * app.js
 * Controls, panels, the engineer's drawing, evolution, load tests.
 */
(function () {
  'use strict';
  const X = window.Setu;
  const $ = (id) => document.getElementById(id);
  const rs = (v) => '₹' + Math.round(v).toLocaleString('en-IN');
  const kg = (v) => Math.round(v).toLocaleString('en-IN') + ' kg';
  const pct = (v) => Math.round(v * 100) + '%';
  const NAMES = { evolved: 'Evolved', pratt: 'Pratt truss', howe: 'Howe truss', warren: 'Warren truss', mine: 'Your design' };

  const S = {
    span: 30, load: 'truck', mat: 'steel', prob: null, fz: X.defaultFuzzy(),
    designs: {}, current: 'pratt', mode: 'design', run: null, editing: false,
    test: null, mfVar: 'stress',
  };
  const world = new window.SetuWorld($('scene'));

  function toast(html, ms) {
    const el = document.createElement('div');
    el.className = 'toast'; el.innerHTML = html;
    $('toasts').appendChild(el);
    while ($('toasts').children.length > 3) $('toasts').firstChild.remove();
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 380); }, ms || 3800);
  }

  // ------------------------------------------------------------------
  // Site and designs
  // ------------------------------------------------------------------
  function evaluateDesign(key, d) {
    const e = X.evaluate(S.prob, d, S.fz, true);
    S.designs[key] = { key, name: NAMES[key], d, e };
    return S.designs[key];
  }

  function setSite() {
    stopTest();
    S.prob = X.makeProblem(S.span, S.load, S.mat);
    S.designs = {};
    for (const t of ['pratt', 'howe', 'warren']) evaluateDesign(t, X.textbook(S.prob, t));
    evaluateDesign('mine', X.cloneDesign(S.designs.pratt.d));
    S.current = 'pratt';
    world.setSite(S.span, S.load, S.mat);
    world.setVehicle(S.load);
    $('spanVal').textContent = S.span + ' m';
    showDesign('pratt');
    fillTestSelect();
  }

  function viewOf(rec, caseRes, exag) {
    const res = rec.e.res;
    const used = new Uint8Array(S.prob.nNodes);
    res.members.forEach((m) => { used[m.c.a] = 1; used[m.c.b] = 1; });
    for (let i = 0; i <= S.prob.n; i++) used[i] = 1;
    return {
      xy: res.xy, n: S.prob.n, used,
      members: res.members.map((m) => ({ a: m.c.a, b: m.c.b, D: m.sec.D })),
      util: caseRes ? caseRes.util : res.memberUtil,
      disp: caseRes ? caseRes.disp : null, map: caseRes ? caseRes.map : null, exag: exag || 0,
    };
  }

  function showDesign(key) {
    S.current = key;
    const rec = S.designs[key];
    if (!rec) return;
    if (!rec.e.res.mechanism) world.setBridge(viewOf(rec));
    renderResult();
    drawElevation();
    if (S.mode === 'brain') renderBrain();
  }

  // ------------------------------------------------------------------
  // Result panel
  // ------------------------------------------------------------------
  function renderResult() {
    const rec = S.designs[S.current];
    const e = rec.e, res = e.res;
    $('designName').textContent = rec.name;
    if (res.mechanism) {
      $('costVal').textContent = '—'; $('massVal').textContent = '—';
      $('safetyVal').textContent = '0'; $('safetyWord').textContent = 'wobbly: not a structure';
      $('checks').innerHTML = '<p class="tiny">This shape can fold up like a hinge: there are not enough triangles. Add a diagonal.</p>';
      drawGauge(0);
    } else {
      $('costVal').textContent = rs(res.costRs * 2);
      $('massVal').textContent = kg(res.massKg);
      $('safetyVal').textContent = Math.round(e.safety);
      $('safetyWord').textContent = 'fuzzy safety · ' + (e.safety >= 80 ? 'excellent' : e.safety >= 60 ? 'good' : e.safety >= 35 ? 'risky' : 'unsafe');
      drawGauge(e.safety);
      const rows = [
        ['Strength used', res.maxUtil, 'of what the members can carry (with safety margin)'],
        ['Buckling used', res.maxBuck, 'how close a squeezed member is to bending sideways'],
        ['Sag', res.maxDefl / res.deflLimit, `${res.maxDefl.toFixed(0)} mm vs limit ${res.deflLimit.toFixed(0)} mm`],
      ];
      $('checks').innerHTML = rows.map(([k, v, tip]) => {
        const c = v > 1 ? '#ff4d3d' : v > 0.85 ? '#ffc21a' : '#21b573';
        return `<div class="check" title="${tip}"><span>${k}</span><b class="mono">${pct(v)}</b><div class="bar"><span style="width:${Math.min(100, v * 100)}%;background:${c}"></span></div></div>`;
      }).join('');
    }
    // comparison
    const keys = ['evolved', 'pratt', 'howe', 'warren', 'mine'].filter((k) => S.designs[k]);
    const costs = keys.map((k) => (S.designs[k].e.res.mechanism ? 0 : S.designs[k].e.res.costRs * 2));
    const mx = Math.max(...costs, 1);
    $('compare').innerHTML = keys.map((k, i) => {
      const r = S.designs[k], bad = r.e.res.mechanism || !r.e.ok;
      const col = k === 'evolved' ? '#ffc21a' : k === 'mine' ? '#2f6bff' : '#9aa4b5';
      return `<div class="cmp ${k === S.current ? 'sel' : ''} ${bad ? 'fail' : ''}" data-k="${k}" title="${bad ? 'fails a safety check' : 'passes all checks'}">
        <span>${r.name.replace(' truss', '')}</span><div class="bar"><span style="width:${(costs[i] / mx) * 100}%;background:${col}"></span></div>
        <b>${r.e.res.mechanism ? 'wobbly' : bad ? 'unsafe' : '₹' + (costs[i] / 100000).toFixed(1) + 'L'}</b></div>`;
    }).join('');
    $('compare').querySelectorAll('.cmp').forEach((el) => el.addEventListener('click', () => showDesign(el.dataset.k)));
    // savings headline
    const ev = S.designs.evolved;
    if (ev && ev.e.ok) {
      const best = ['pratt', 'howe', 'warren'].map((k) => S.designs[k]).filter((d) => d.e.ok).sort((a, b) => a.e.res.costRs - b.e.res.costRs)[0];
      if (best) {
        const save = (best.e.res.costRs - ev.e.res.costRs) * 2;
        $('moneyTop').innerHTML = `Evolved design saves <b style="color:#10784a">${rs(save)}</b> (${pct(save / (best.e.res.costRs * 2))}) vs the best textbook truss`;
      }
    } else $('moneyTop').textContent = `${S.prob.load.name} · ${S.span} m · ${S.prob.mat.name}`;
  }

  function drawGauge(v) {
    const c = $('gauge'), dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = c.clientWidth, h = c.clientHeight;
    if (w < 60 || h < 60) return;             // panel hidden
    c.width = w * dpr; c.height = h * dpr;
    const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cx = w / 2, cy = h - 18, r = Math.min(w / 2 - 14, h - 30);
    const seg = [[0, 35, '#ff4d3d'], [35, 60, '#ffc21a'], [60, 80, '#8bd46b'], [80, 100, '#21b573']];
    g.lineWidth = 16; g.lineCap = 'butt';
    for (const [a, b, col] of seg) {
      g.strokeStyle = col; g.beginPath();
      g.arc(cx, cy, r, Math.PI + (a / 100) * Math.PI, Math.PI + (b / 100) * Math.PI); g.stroke();
    }
    const ang = Math.PI + (Math.max(0, Math.min(100, v)) / 100) * Math.PI;
    g.strokeStyle = '#14233b'; g.lineWidth = 4; g.lineCap = 'round';
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(ang) * (r - 6), cy + Math.sin(ang) * (r - 6)); g.stroke();
    g.fillStyle = '#14233b'; g.beginPath(); g.arc(cx, cy, 6, 0, 7); g.fill();
  }

  // ------------------------------------------------------------------
  // Engineer's drawing (elevation) with editing for "your design"
  // ------------------------------------------------------------------
  let EL = null;
  function drawElevation(caseRes) {
    const c = $('elev'), dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = c.clientWidth, h = c.clientHeight;
    if (!w || !h) return;
    c.width = w * dpr; c.height = h * dpr;
    const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const rec = S.designs[S.current], res = rec.e.res, prob = S.prob;
    const padX = 70, padB = 30, padT = 14;
    const sc = Math.min((w - padX * 2) / prob.span, (h - padB - padT) / (prob.hMax + 0.5));
    const ox = (w - prob.span * sc) / 2, oy = h - padB;
    const P = (x, y) => [ox + x * sc, oy - y * sc];
    EL = { P, sc, ox, oy, res };
    // banks and water
    g.fillStyle = '#c9e9b8'; g.fillRect(0, oy, ox, padB); g.fillRect(ox + prob.span * sc, oy, w, padB);
    g.fillStyle = '#bfe6fb'; g.fillRect(ox, oy + 8, prob.span * sc, padB - 8);
    // dimension line
    g.strokeStyle = '#7a879c'; g.fillStyle = '#7a879c'; g.lineWidth = 1; g.font = '600 11px "JetBrains Mono", monospace'; g.textAlign = 'center';
    g.beginPath(); g.moveTo(ox, oy + 20); g.lineTo(ox + prob.span * sc, oy + 20); g.stroke();
    g.fillText(`${prob.span} m · ${prob.n} panels of ${prob.panel.toFixed(1)} m`, ox + (prob.span * sc) / 2, oy + 16);
    if (res.mechanism && !res.members.length) return;
    const forces = caseRes ? caseRes.members.map((m) => m.N) : (res.cases[res.worstCase] ? res.cases[res.worstCase].forces : null);
    const util = caseRes ? caseRes.util : res.memberUtil;
    const maxD = Math.max(...prob.mat.sections.map((s) => s.D));
    // all candidate members faintly while editing
    if (S.editing && S.current === 'mine') {
      g.setLineDash([4, 5]); g.strokeStyle = 'rgba(20,35,59,0.25)'; g.lineWidth = 1;
      for (const cnd of prob.cand) {
        const [x1, y1] = P(res.xy[cnd.a * 2], res.xy[cnd.a * 2 + 1]), [x2, y2] = P(res.xy[cnd.b * 2], res.xy[cnd.b * 2 + 1]);
        g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
      }
      g.setLineDash([]);
    }
    res.members.forEach((m, j) => {
      const [x1, y1] = P(res.xy[m.c.a * 2], res.xy[m.c.a * 2 + 1]), [x2, y2] = P(res.xy[m.c.b * 2], res.xy[m.c.b * 2 + 1]);
      const N = forces ? forces[j] : 0;
      const u = util ? Math.min(1.2, util[j] || 0) : 0.5;
      g.strokeStyle = (util && util[j] > 1) ? '#ff1f0f' : N >= 0 ? `rgba(47,107,255,${0.35 + u * 0.6})` : `rgba(255,77,61,${0.35 + u * 0.6})`;
      g.lineWidth = 1.5 + (m.sec.D / maxD) * 7;
      g.lineCap = 'round';
      g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
    });
    // nodes
    for (let i = 0; i < prob.nNodes; i++) {
      const top = i > prob.n;
      const [x, y] = P(res.xy[i * 2], res.xy[i * 2 + 1]);
      g.fillStyle = top && S.editing && S.current === 'mine' ? '#ffc21a' : '#14233b';
      g.beginPath(); g.arc(x, y, top && S.editing && S.current === 'mine' ? 6 : 3.2, 0, 7); g.fill();
    }
    // supports
    const [sx0, sy0] = P(0, 0), [sx1, sy1] = P(prob.span, 0);
    g.fillStyle = '#14233b';
    g.beginPath(); g.moveTo(sx0, sy0); g.lineTo(sx0 - 8, sy0 + 12); g.lineTo(sx0 + 8, sy0 + 12); g.closePath(); g.fill();
    g.beginPath(); g.arc(sx1 - 5, sy1 + 9, 3.5, 0, 7); g.arc(sx1 + 5, sy1 + 9, 3.5, 0, 7); g.fill();
    // labels
    g.textAlign = 'left'; g.fillStyle = '#44546e'; g.font = '600 11px Figtree, sans-serif';
    const maxH = Math.max(...Array.from({ length: prob.n - 1 }, (_, i) => res.xy[(prob.n + 1 + i) * 2 + 1]));
    g.fillText(`depth ${maxH.toFixed(1)} m`, 8, 16);
    g.fillText(`${res.members.length} members`, 8, 32);
    if (S.editing && S.current === 'mine') { g.fillStyle = '#b37800'; g.fillText('drag the yellow joints · click a dashed line to add a member, a solid one to remove it', 8, 48); }
  }

  function elevHit(ev) {
    if (!EL) return null;
    const rect = $('elev').getBoundingClientRect();
    const mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
    const prob = S.prob, res = EL.res;
    for (let i = 1; i < prob.n; i++) {
      const [x, y] = EL.P(res.xy[(prob.n + i) * 2], res.xy[(prob.n + i) * 2 + 1]);
      if (Math.hypot(mx - x, my - y) < 10) return { node: i };
    }
    let best = null, bd = 7;
    for (const c of prob.cand) {
      const [x1, y1] = EL.P(res.xy[c.a * 2], res.xy[c.a * 2 + 1]), [x2, y2] = EL.P(res.xy[c.b * 2], res.xy[c.b * 2 + 1]);
      const vx = x2 - x1, vy = y2 - y1, t = Math.max(0, Math.min(1, ((mx - x1) * vx + (my - y1) * vy) / (vx * vx + vy * vy)));
      const d = Math.hypot(mx - x1 - t * vx, my - y1 - t * vy);
      if (d < bd) { bd = d; best = c; }
    }
    return best ? { cand: best } : null;
  }

  let dragNode = null;
  function bindElevation() {
    const c = $('elev');
    c.addEventListener('pointerdown', (ev) => {
      if (!(S.editing && S.current === 'mine')) return;
      const hit = elevHit(ev);
      if (!hit) return;
      if (hit.node) { dragNode = hit.node; c.setPointerCapture(ev.pointerId); return; }
      const d = S.designs.mine.d, k = hit.cand.k, kind = hit.cand.kind;
      if (kind === 'deck') { toast('The deck chord carries the road, so it stays.'); return; }
      d.s[k] = d.s[k] < 0 ? Math.floor(S.prob.mat.sections.length / 2) : -1;
      reevaluateMine();
    });
    c.addEventListener('pointermove', (ev) => {
      if (!dragNode) return;
      const rect = c.getBoundingClientRect();
      const y = (EL.oy - (ev.clientY - rect.top)) / EL.sc;
      S.designs.mine.d.h[dragNode - 1] = Math.max(0.6, Math.min(S.prob.hMax, y));
      reevaluateMine(true);
    });
    c.addEventListener('pointerup', () => { if (dragNode) { dragNode = null; reevaluateMine(); } });
  }
  function reevaluateMine(quick) {
    const d = S.designs.mine.d;
    evaluateDesign('mine', d);
    showDesign('mine');
    if (!quick) fillTestSelect();
  }

  // ------------------------------------------------------------------
  // Evolution
  // ------------------------------------------------------------------
  function startEvolve() {
    if (S.run) return;
    stopTest();
    const useFuzzy = $('useFuzzy').checked;
    const ga = new X.GA(S.prob, S.fz, { pop: 60, useFuzzy });
    S.run = { ga, gens: 100, useFuzzy };
    $('btnEvolve').disabled = true;
    $('btnEvolve').textContent = '🧬 Evolving…';
    S.editing = false; $('btnMine').classList.remove('on'); $('elev').classList.remove('edit');
    world.flyHome();
  }
  function evolveTick() {
    const run = S.run;
    if (!run) return;
    run.ga.step();
    const b = run.ga.best;
    S.designs.evolved = { key: 'evolved', name: NAMES.evolved, d: b.d, e: { res: b.res, safety: run.useFuzzy ? b.safety : X.fuzzyEval(S.fz, X.fuzzyInputs(b.res)), fit: b.fit, ok: b.ok } };
    if (run.ga.gen % 2 === 0 || run.ga.gen >= run.gens) showDesign('evolved');
    drawEvo();
    $('evoNote').textContent = `Generation ${run.ga.gen} of ${run.gens} · best so far ${rs(b.res.costRs * 2)}`;
    if (run.ga.gen >= run.gens) {
      S.run = null;
      $('btnEvolve').disabled = false; $('btnEvolve').textContent = '🧬 Evolve again';
      // final record with the full fuzzy score
      const e = X.evaluate(S.prob, X.cloneDesign(b.d), S.fz, true);
      S.designs.evolved = { key: 'evolved', name: NAMES.evolved, d: e.res.members.length ? b.d : b.d, e };
      showDesign('evolved');
      fillTestSelect();
      const best = ['pratt', 'howe', 'warren'].map((k) => S.designs[k]).filter((d) => d.e.ok).sort((a, c) => a.e.res.costRs - c.e.res.costRs)[0];
      if (best && e.ok) toast(`<b>Evolved bridge: ${rs(e.res.costRs * 2)}</b>, ${pct(1 - e.res.costRs / best.e.res.costRs)} cheaper than the ${best.name}, and it passes every check. Try the <b>Load test</b>.`, 6000);
      else if (!e.ok) toast('Evolution could not find a design that passes every check here. Try a shorter span or a stronger material.', 6000);
    }
  }
  function drawEvo() {
    const c = $('evoChart'), dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = c.clientWidth, h = c.clientHeight;
    if (!w || !h) return;
    c.width = w * dpr; c.height = h * dpr;
    const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const hist = S.run ? S.run.ga.history : (S.lastHist || []);
    if (S.run) S.lastHist = hist;
    if (hist.length < 2) { g.fillStyle = '#7a879c'; g.font = '600 11px Figtree'; g.fillText('Cost will drop here as the bridge evolves', 4, h / 2); return; }
    const v = hist.map((x) => x.cost * 2), mn = Math.min(...v), mx = Math.max(...v);
    const Y = (q) => h - 8 - ((q - mn) / Math.max(1, mx - mn)) * (h - 22), Xp = (i) => (i / (v.length - 1)) * (w - 4) + 2;
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(255,194,26,0.5)'); gr.addColorStop(1, 'rgba(255,194,26,0)');
    g.beginPath(); g.moveTo(Xp(0), h); v.forEach((q, i) => g.lineTo(Xp(i), Y(q))); g.lineTo(Xp(v.length - 1), h); g.fillStyle = gr; g.fill();
    g.beginPath(); v.forEach((q, i) => (i ? g.lineTo(Xp(i), Y(q)) : g.moveTo(Xp(i), Y(q)))); g.strokeStyle = '#e09a00'; g.lineWidth = 2.5; g.stroke();
    g.fillStyle = '#14233b'; g.font = '700 11px "JetBrains Mono"'; g.textAlign = 'right';
    g.fillText(`${rs(v[0])} → ${rs(v[v.length - 1])}`, w - 2, 12);
  }

  // ------------------------------------------------------------------
  // Load test
  // ------------------------------------------------------------------
  function fillTestSelect() {
    const sel = $('testDesign'), cur = sel.value || S.current;
    sel.innerHTML = Object.values(S.designs).map((d) => `<option value="${d.key}" ${d.key === cur ? 'selected' : ''}>${d.name}${d.e.res.mechanism ? ' (wobbly)' : d.e.ok ? '' : ' (fails checks)'}</option>`).join('');
  }
  function worstOver(rec, mult) {
    let worst = 0;
    const base = X.analyse(S.prob, rec.d);
    const end = S.span + (S.prob.load.axles ? S.prob.load.axles[S.prob.load.axles.length - 1].dx : 0);
    for (let x = 0; x <= end; x += S.span / 40) {
      const r = X.analyseCase(S.prob, rec.d, X.liveAt(S.prob, x), mult, base);
      if (r.mechanism) return 99;
      worst = Math.max(worst, ...r.util);
    }
    return worst;
  }
  function startDrive(mult) {
    const rec = S.designs[$('testDesign').value];
    if (!rec) return;
    if (rec.e.res.mechanism) { toast('That design is a mechanism: it would fold before any load. Pick another one.'); return; }
    world.resetCollapse();
    showDesign(rec.key);
    $('verdict').hidden = true;
    S.test = { rec, x: -14, mult: mult || +$('mult').value, peak: 0, failed: false, done: false, t: 0, base: X.analyse(S.prob, rec.d), frame: 0 };
    world.flyTo(new window.THREE.Vector3(-S.span * 0.15, 7 + S.span * 0.12, S.span * 0.85 + 16), new window.THREE.Vector3(0, -1, 0));
  }
  function stopTest() { S.test = null; world.resetCollapse(); if (world.vehicle) world.vehicle.visible = false; }
  function testTick(dt) {
    const T = S.test;
    if (!T || T.done) return;
    T.t += dt;
    const speed = S.load === 'people' ? 3 : 7;
    T.x += speed * dt;
    const r = X.analyseCase(S.prob, T.rec.d, X.liveAt(S.prob, T.x), T.mult, T.base);
    T.frame++;
    const um = Math.max(...r.util);
    T.peak = Math.max(T.peak, um);
    // sag at mid-span
    const mid = Math.round(S.prob.n / 2), sag = -r.disp[r.map[mid] + 1];
    if (T.frame % 2 === 0 || um > 1) world.setBridge(viewOf(T.rec, r, 25));
    world.placeVehicle(T.x, T.t);
    $('liveUtil').textContent = pct(um);
    $('liveBar').style.width = Math.min(100, um * 100) + '%';
    $('liveBar').style.background = um > 1 ? '#ff4d3d' : um > 0.8 ? '#ffc21a' : '#21b573';
    $('liveSag').textContent = sag.toFixed(0) + ' mm';
    if (T.frame % 3 === 0) drawElevation(r);
    if (um > 1 && !T.failed) {
      T.failed = true; T.done = true;
      const j = r.util.indexOf(um), m = r.members[j];
      const xm = (r.xy[m.c.a * 2] + r.xy[m.c.b * 2]) / 2;
      const why = m.N < 0 ? 'buckled (bent sideways under compression)' : 'snapped (pulled apart)';
      world.collapse(xm);
      const v = $('verdict'); v.className = 'verdict bad'; v.hidden = false;
      v.innerHTML = `<b>Collapsed at ${T.mult.toFixed(1)}× the design load</b>A ${m.c.kind === 'top' ? 'top chord' : m.c.kind === 'deck' ? 'bottom chord' : m.c.kind === 'diag' ? 'diagonal' : m.c.kind === 'vert' ? 'vertical' : 'end post'} member ${why} when the load reached ${T.x.toFixed(1)} m.`;
      toast('💥 Collapse. One member failed and the bridge folded.', 3000);
      return;
    }
    const end = S.span + 14;
    if (T.x > end) {
      T.done = true;
      const v = $('verdict'); v.className = 'verdict ok'; v.hidden = false;
      v.innerHTML = `<b>Held. Safe crossing at ${T.mult.toFixed(1)}×</b>The busiest member reached ${pct(T.peak)} of its real strength. ${T.mult <= 1.05 ? 'Push the load slider up, or find its breaking point.' : ''}`;
    }
  }
  function findBreak() {
    const rec = S.designs[$('testDesign').value];
    if (!rec || rec.e.res.mechanism) return;
    let lo = 1, hi = 6;
    if (worstOver(rec, hi) < 1) { toast(`Even 6× the design load doesn't break it.`); return; }
    if (worstOver(rec, lo) >= 1) {
      toast(`<b>${rec.name}</b> can't even carry its design load. Watch:`, 3500);
      setTimeout(() => startDrive(1), 400);
      return;
    }
    for (let i = 0; i < 14; i++) { const m = (lo + hi) / 2; if (worstOver(rec, m) >= 1) hi = m; else lo = m; }
    const m = Math.ceil(hi * 10) / 10 + 0.0;
    $('mult').value = Math.min(4, m); $('multVal').textContent = m.toFixed(1) + '× design load';
    toast(`<b>${rec.name}</b> breaks at about <b>${hi.toFixed(2)}×</b> its design load. Watch:`, 3500);
    setTimeout(() => startDrive(Math.max(hi + 0.02, 1)), 500);
  }

  // ------------------------------------------------------------------
  // Fuzzy safety officer
  // ------------------------------------------------------------------
  function sizeCanvas(c) {
    const dpr = Math.min(2, window.devicePixelRatio || 1), w = c.clientWidth, h = c.clientHeight;
    c.width = w * dpr; c.height = h * dpr;
    const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { g, w, h };
  }
  function renderBrain() {
    const fz = S.fz, vars = Object.keys(fz.inputs);
    $('mfPick').innerHTML = vars.map((v) => `<button data-v="${v}" class="${v === S.mfVar ? 'on' : ''}">${fz.inputs[v].label}</button>`).join('') + `<button data-v="__out" class="${S.mfVar === '__out' ? 'on' : ''}">Safety (output)</button>`;
    $('mfPick').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { S.mfVar = b.dataset.v; renderBrain(); }));
    const rec = S.designs[S.current], res = rec.e.res;
    const x = res.mechanism ? null : X.fuzzyInputs(res);
    const def = S.mfVar === '__out' ? fz.output : fz.inputs[S.mfVar];
    const max = S.mfVar === '__out' ? 1 : def.max;
    const cols = ['#21b573', '#ffc21a', '#ff4d3d', '#2f6bff'];
    {
      const { g, w, h } = sizeCanvas($('mfChart'));
      const Xp = (v) => 8 + (v / max) * (w - 16), Y = (v) => h - 18 - v * (h - 34);
      Object.entries(def.sets).forEach(([name, abc], k) => {
        const col = S.mfVar === '__out' ? ['#ff4d3d', '#ffc21a', '#8bd46b', '#21b573'][k] : cols[k];
        g.beginPath();
        for (let i = 0; i <= 120; i++) { const v = (i / 120) * max; const yy = Y(X.mu(v, abc)); i ? g.lineTo(Xp(v), yy) : g.moveTo(Xp(v), yy); }
        g.strokeStyle = col; g.lineWidth = 2.5; g.stroke();
        g.fillStyle = col; g.font = '700 11px Figtree'; const lx = Xp(abc[1]); g.textAlign = lx < 40 ? 'left' : lx > w - 40 ? 'right' : 'center';
        g.fillText(name, lx, Y(1) - 5);
      });
      if (x && S.mfVar !== '__out') {
        const xv = Xp(Math.min(max, x[S.mfVar]));
        g.strokeStyle = '#14233b'; g.setLineDash([4, 3]); g.beginPath(); g.moveTo(xv, 10); g.lineTo(xv, h - 18); g.stroke(); g.setLineDash([]);
        g.fillStyle = '#14233b'; g.textAlign = 'center'; g.font = '700 11px "JetBrains Mono"'; g.fillText('this design ' + x[S.mfVar].toFixed(2), xv, h - 4);
      }
    }
    const ex = x ? X.fuzzyEval(fz, x, true) : null;
    {
      const { g, w, h } = sizeCanvas($('outChart'));
      if (ex) {
        const Xp = (v) => 8 + v * (w - 16), Y = (v) => h - 18 - v * (h - 30);
        g.beginPath(); g.moveTo(Xp(0), Y(0));
        for (let i = 0; i <= 100; i++) g.lineTo(Xp(i / 100), Y(ex.agg[i]));
        g.lineTo(Xp(1), Y(0)); g.closePath();
        const gr = g.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, '#ff4d3d'); gr.addColorStop(0.45, '#ffc21a'); gr.addColorStop(1, '#21b573');
        g.globalAlpha = 0.55; g.fillStyle = gr; g.fill(); g.globalAlpha = 1; g.strokeStyle = '#14233b'; g.lineWidth = 1.5; g.stroke();
        const cx = Xp(ex.value / 100);
        g.setLineDash([4, 3]); g.beginPath(); g.moveTo(cx, 6); g.lineTo(cx, h - 18); g.stroke(); g.setLineDash([]);
        g.fillStyle = '#14233b'; g.font = '800 13px "Bricolage Grotesque"'; g.textAlign = cx > w - 80 ? 'right' : 'left';
        g.fillText(`safety ${ex.value.toFixed(0)}`, cx + (cx > w - 80 ? -6 : 6), 18);
        g.font = '600 10.5px Figtree'; g.fillStyle = '#7a879c'; g.textAlign = 'left'; g.fillText('unsafe', 4, h - 4); g.textAlign = 'right'; g.fillText('excellent', w - 4, h - 4);
      }
      $('fzIn').textContent = x ? Object.entries(x).map(([k, v]) => `${fz.inputs[k].label}: ${v.toFixed(2)}`).join(' · ') : 'This design is a mechanism; no rating.';
    }
    const fired = {}; if (ex) ex.fired.forEach((f) => { fired[f.k] = f.w; });
    $('rules').innerHTML = fz.rules.map((r, k) => `<div class="rule ${fired[k] ? 'fired' : ''} ${r.on ? '' : 'off'}" data-k="${k}"><span class="mono">R${k + 1}</span>
      <span>IF ${r.if.map(([v, s]) => `${fz.inputs[v].label.toLowerCase()} is <em>${s}</em>`).join(' AND ')} THEN safety is <em>${r.then}</em></span>
      <span class="w">${fired[k] ? fired[k].toFixed(2) : ''}</span></div>`).join('');
    $('rules').querySelectorAll('.rule').forEach((el) => el.addEventListener('click', () => {
      const r = fz.rules[+el.dataset.k]; r.on = !r.on;
      for (const k of Object.keys(S.designs)) S.designs[k].e = X.evaluate(S.prob, S.designs[k].d, fz, true);
      showDesign(S.current);
      toast(`Rule R${+el.dataset.k + 1} ${r.on ? 'on' : 'off'}. Safety scores updated; evolve again to see a different bridge.`);
    }));
  }

  // ------------------------------------------------------------------
  // Modes and controls
  // ------------------------------------------------------------------
  function setMode(m) {
    S.mode = m;
    document.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
    $('resultPanel').hidden = m !== 'design';
    $('testPanel').hidden = m !== 'test';
    $('brain').hidden = m !== 'brain';
    $('sitePanel').hidden = m === 'brain';
    if (m !== 'test') { stopTest(); showDesign(S.current); world.flyHome(); }
    else { fillTestSelect(); $('testDesign').value = S.designs.evolved ? 'evolved' : S.current; $('testName').textContent = S.prob.load.name; }
    if (m === 'brain') renderBrain();
  }

  function bind() {
    document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
    $('span').addEventListener('input', (e) => { $('spanVal').textContent = e.target.value + ' m'; });
    $('span').addEventListener('change', (e) => { S.span = +e.target.value; S.run = null; $('btnEvolve').disabled = false; $('btnEvolve').textContent = '🧬 Evolve a bridge'; setSite(); world.flyHome(); });
    $('loadChoices').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      S.load = b.dataset.load; $('loadChoices').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      S.run = null; $('btnEvolve').disabled = false; $('btnEvolve').textContent = '🧬 Evolve a bridge'; setSite();
    }));
    $('matChoices').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      S.mat = b.dataset.mat; $('matChoices').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      S.run = null; $('btnEvolve').disabled = false; $('btnEvolve').textContent = '🧬 Evolve a bridge'; setSite();
    }));
    $('btnEvolve').addEventListener('click', () => { if (S.mode !== 'design') setMode('design'); startEvolve(); });
    $('btnMine').addEventListener('click', () => {
      S.editing = !S.editing;
      $('btnMine').classList.toggle('on', S.editing);
      $('elev').classList.toggle('edit', S.editing);
      if (S.editing) { if (S.mode !== 'design') setMode('design'); showDesign('mine'); toast('Edit the drawing below: drag yellow joints up or down, click lines to add or remove members. Sizes are picked automatically.', 5000); }
      else drawElevation();
    });
    $('mult').addEventListener('input', (e) => { $('multVal').textContent = (+e.target.value).toFixed(1) + '× design load'; });
    $('btnDrive').addEventListener('click', () => startDrive());
    $('btnBreak').addEventListener('click', findBreak);
    $('testDesign').addEventListener('change', () => { stopTest(); showDesign($('testDesign').value); });
    window.addEventListener('resize', () => { drawElevation(); renderResult(); drawEvo(); });
    bindElevation();
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.12, (now - last) / 1000); last = now;
    try {
      if (S.run) evolveTick();
      if (S.test) testTick(dt);
      world.render();
    } catch (err) { console.error(err); }
    requestAnimationFrame(frame);
  }

  bind();
  setSite();
  drawEvo();
  requestAnimationFrame(frame);
  setTimeout(() => toast('A 30 m river, a loaded truck, steel. Press <b>🧬 Evolve a bridge</b> and watch it find a cheaper design than the textbook ones.', 6500), 600);
})();
