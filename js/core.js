/*
 * core.js
 * SETU engine. No DOM code, so it runs in the browser and in Node.
 *
 *   structure - 2D truss model of one side of the bridge, solved with the
 *               direct stiffness method (the standard finite-element method
 *               for trusses): member forces, stresses, deflections
 *   checks    - tension/compression stress, Euler buckling, deflection limit
 *   fuzzy     - Mamdani fuzzy system that rates how safe a design is
 *   GA        - genetic algorithm that evolves the bridge shape, which
 *               members exist and how thick each one is
 */
(function (root) {
  'use strict';

  // ------------------------------------------------------------------
  // Random numbers
  // ------------------------------------------------------------------
  function mulberry32(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  let rand = mulberry32(2610);
  const random = () => rand();
  const seed = (s) => { rand = mulberry32(s); };
  const randInt = (n) => Math.floor(rand() * n);
  function gauss() { let u = 0; while (u === 0) u = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand()); }
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  // ------------------------------------------------------------------
  // Materials and sections
  // ------------------------------------------------------------------
  // Strengths are design values (already divided by a material safety factor).
  function tube(D, t) {
    const d = D - 2 * t;
    return { label: `Ø${D}×${t}`, A: (Math.PI * (D * D - d * d)) / 4, I: (Math.PI * (D ** 4 - d ** 4)) / 64, D };
  }
  function square(b) { return { label: `${b}×${b}`, A: b * b, I: (b ** 4) / 12, D: b }; }
  function bundle(n, D, t) { const s = tube(D, t); return { label: `${n}×Ø${D}`, A: s.A * n, I: s.I * n, D: D * Math.sqrt(n) }; }

  const MATERIALS = {
    steel: {
      name: 'Steel', grade: 'Fe 250 tubes', E: 200000, ft: 227, fc: 227, density: 7850, rupeesPerKg: 95, colour: '#d94f3d',
      sections: [tube(48.3, 3.2), tube(60.3, 3.6), tube(76.1, 4), tube(88.9, 4.8), tube(114.3, 5.4), tube(139.7, 6.3), tube(168.3, 7.1), tube(219.1, 8), tube(273, 10)],
    },
    timber: {
      name: 'Timber', grade: 'Sal, structural grade', E: 12500, ft: 12, fc: 10, density: 880, rupeesPerKg: 110, colour: '#a8713f',
      sections: [square(75), square(100), square(125), square(150), square(200), square(250), square(300)],
    },
    bamboo: {
      name: 'Bamboo', grade: 'Treated Dendrocalamus culms', E: 15000, ft: 40, fc: 25, density: 700, rupeesPerKg: 30, colour: '#c9b25a',
      sections: [tube(70, 8), tube(90, 10), tube(110, 12), bundle(2, 100, 11), bundle(3, 100, 11), bundle(4, 110, 12), bundle(6, 110, 12), bundle(8, 120, 13), bundle(12, 120, 13)],
    },
  };

  // Loads carried by ONE of the two side trusses (kN, kN/m).
  const LOADS = {
    people: { name: 'Footbridge crowd', deckDead: 2.0, udl: 5.0, axles: null, widthM: 2.5, limitRatio: 300 },
    car: { name: 'Cars and autos', deckDead: 6.0, udl: 0, axles: [{ dx: 0, P: 20 }, { dx: 2.6, P: 20 }], widthM: 4.5, limitRatio: 400 },
    truck: { name: 'Loaded truck', deckDead: 9.0, udl: 0, axles: [{ dx: 0, P: 35 }, { dx: 3.5, P: 100 }, { dx: 4.8, P: 100 }], widthM: 6, limitRatio: 600 },
  };
  const LOAD_FACTOR = 1.5;

  // ------------------------------------------------------------------
  // Problem: span, panels, ground structure of candidate members
  // ------------------------------------------------------------------
  // Deck nodes 0..n along y = 0; upper nodes 1..n-1 above them.
  function makeProblem(spanM, loadKey, materialKey) {
    const n = clamp(Math.round(spanM / 5), 4, 12);
    const mat = MATERIALS[materialKey], load = LOADS[loadKey];
    const cand = [];
    const D = (i) => i;                 // deck node index
    const U = (i) => n + i;             // upper node index (i = 1..n-1), node id n+i
    for (let i = 0; i < n; i++) cand.push({ a: D(i), b: D(i + 1), kind: 'deck' });
    for (let i = 1; i < n - 1; i++) cand.push({ a: U(i), b: U(i + 1), kind: 'top' });
    cand.push({ a: D(0), b: U(1), kind: 'end' });
    cand.push({ a: U(n - 1), b: D(n), kind: 'end' });
    for (let i = 1; i < n; i++) cand.push({ a: D(i), b: U(i), kind: 'vert' });
    for (let i = 1; i < n; i++) {
      if (i - 1 >= 1) cand.push({ a: D(i), b: U(i - 1), kind: 'diag' });
      if (i + 1 <= n - 1) cand.push({ a: D(i), b: U(i + 1), kind: 'diag' });
    }
    cand.forEach((c, k) => { c.k = k; });
    return { span: spanM, n, panel: spanM / n, hMax: Math.max(2, spanM / 4), mat, load, materialKey, loadKey, cand, nNodes: 2 * n };
  }

  // Design = { h: Float32Array(n-1) heights, dx: Float32Array(n-1) shifts, s: Int8Array(cand) section index or -1 }
  function geometry(prob, des) {
    const { n, panel } = prob;
    const xy = new Float64Array(prob.nNodes * 2);
    for (let i = 0; i <= n; i++) { xy[i * 2] = i * panel; xy[i * 2 + 1] = 0; }
    for (let i = 1; i < n; i++) {
      const id = n + i;
      xy[id * 2] = i * panel + des.dx[i - 1] * panel;
      xy[id * 2 + 1] = des.h[i - 1];
    }
    return xy;
  }

  // ------------------------------------------------------------------
  // Direct stiffness method
  // ------------------------------------------------------------------
  function solve(K, F, ndof) {
    // Gaussian elimination with partial pivoting; returns null for a mechanism.
    const A = K, b = F;
    let scale = 0;
    for (let c = 0; c < ndof; c++) scale = Math.max(scale, Math.abs(A[c * ndof + c]));
    const tiny = scale * 1e-9;
    for (let c = 0; c < ndof; c++) {
      let p = c, mx = Math.abs(A[c * ndof + c]);
      for (let r = c + 1; r < ndof; r++) { const v = Math.abs(A[r * ndof + c]); if (v > mx) { mx = v; p = r; } }
      if (mx < tiny) return null;
      if (p !== c) {
        for (let k = 0; k < ndof; k++) { const t = A[c * ndof + k]; A[c * ndof + k] = A[p * ndof + k]; A[p * ndof + k] = t; }
        const t = b[c]; b[c] = b[p]; b[p] = t;
      }
      const piv = A[c * ndof + c];
      for (let r = c + 1; r < ndof; r++) {
        const f = A[r * ndof + c] / piv;
        if (f === 0) continue;
        for (let k = c; k < ndof; k++) A[r * ndof + k] -= f * A[c * ndof + k];
        b[r] -= f * b[c];
      }
    }
    const x = new Float64Array(ndof);
    for (let r = ndof - 1; r >= 0; r--) {
      let s = b[r];
      for (let k = r + 1; k < ndof; k++) s -= A[r * ndof + k] * x[k];
      x[r] = s / A[r * ndof + r];
    }
    return x;
  }

  // Analyse a design under every load case. Returns forces, checks, mass, cost.
  function analyse(prob, des) {
    const { n, mat, load, span } = prob;
    const xy = geometry(prob, des);
    const members = [];
    const used = new Uint8Array(prob.nNodes);
    for (const c of prob.cand) {
      const s = des.s[c.k];
      if (s < 0) continue;
      const sec = mat.sections[s];
      const x1 = xy[c.a * 2], y1 = xy[c.a * 2 + 1], x2 = xy[c.b * 2], y2 = xy[c.b * 2 + 1];
      const L = Math.hypot(x2 - x1, y2 - y1);
      if (L < 0.3) continue;
      members.push({ c, sec, s, L, cx: (x2 - x1) / L, cy: (y2 - y1) / L });
      used[c.a] = 1; used[c.b] = 1;
    }
    for (let i = 0; i <= n; i++) used[i] = 1;   // deck nodes always exist
    // dof numbering for used nodes
    const map = new Int16Array(prob.nNodes).fill(-1);
    let nd = 0;
    for (let i = 0; i < prob.nNodes; i++) if (used[i]) { map[i] = nd; nd += 2; }
    // supports: node 0 pinned (x, y), node n roller (y)
    const fixed = new Set([map[0], map[0] + 1, map[n] + 1]);
    const free = [];
    for (let d = 0; d < nd; d++) if (!fixed.has(d)) free.push(d);
    const fIndex = new Int16Array(nd).fill(-1);
    free.forEach((d, i) => { fIndex[d] = i; });
    const nf = free.length;

    // mass and self-weight
    let massKg = 0;
    for (const m of members) { m.kg = (m.sec.A * 1e-6) * m.L * mat.density; massKg += m.kg; }
    const result = {
      xy, members, massKg, costRs: massKg * mat.rupeesPerKg, mechanism: false,
      maxUtil: 0, maxBuck: 0, maxDefl: 0, deflLimit: (span * 1000) / load.limitRatio, cases: [], worstCase: 0,
    };
    if (members.length < 2 * prob.nNodes - 3 - 0) { /* may still be stable; let the solver decide */ }

    // stiffness (E in MPa = N/mm^2, A in mm^2, L in m -> use kN and mm)
    const K = new Float64Array(nf * nf);
    for (const m of members) {
      const k = (mat.E * m.sec.A) / (m.L * 1000) / 1000; // kN/mm
      const ia = map[m.c.a], ib = map[m.c.b];
      const dofs = [ia, ia + 1, ib, ib + 1];
      const v = [-m.cx, -m.cy, m.cx, m.cy];
      for (let p = 0; p < 4; p++) {
        const fp = fIndex[dofs[p]];
        if (fp < 0) continue;
        for (let q = 0; q < 4; q++) {
          const fq = fIndex[dofs[q]];
          if (fq < 0) continue;
          K[fp * nf + fq] += k * v[p] * v[q];
        }
      }
    }

    // load cases: dead + live at several positions
    const deadNode = new Float64Array(prob.nNodes);
    for (const m of members) { const w = (m.kg * 9.81) / 1000 / 2; deadNode[m.c.a] += w; deadNode[m.c.b] += w; }
    for (let i = 0; i <= n; i++) deadNode[i] += load.deckDead * prob.panel * (i === 0 || i === n ? 0.5 : 1);
    const cases = [];
    if (load.udl) {
      const full = new Float64Array(prob.nNodes);
      for (let i = 0; i <= n; i++) full[i] = load.udl * prob.panel * (i === 0 || i === n ? 0.5 : 1);
      cases.push({ label: 'crowd on full span', live: full, at: null });
      const half = new Float64Array(prob.nNodes);
      for (let i = 0; i <= Math.ceil(n / 2); i++) half[i] = full[i];
      cases.push({ label: 'crowd on half span', live: half, at: null });
    } else {
      // every half panel, including the truck driving on and off
      const total = load.axles[load.axles.length - 1].dx;
      const stepX = prob.panel / 2;
      for (let x0 = -total + stepX / 2; x0 <= span; x0 += stepX) {
        const live = new Float64Array(prob.nNodes);
        for (const ax of load.axles) {
          const x = x0 + ax.dx;
          if (x < 0 || x > span) continue;
          const f = x / prob.panel, i = Math.min(n - 1, Math.floor(f)), t = f - i;
          live[i] += ax.P * (1 - t); live[i + 1] += ax.P * t;
        }
        cases.push({ label: `vehicle at ${x0.toFixed(1)} m`, live, at: x0 });
      }
    }
    for (let ci = 0; ci < cases.length; ci++) {
      const Kc = new Float64Array(K), F = new Float64Array(nf);
      for (let i = 0; i < prob.nNodes; i++) {
        if (map[i] < 0) continue;
        const fy = fIndex[map[i] + 1];
        if (fy >= 0) F[fy] = -(deadNode[i] + cases[ci].live[i]) * LOAD_FACTOR;
      }
      const u = solve(Kc, F, nf);
      if (!u) { result.mechanism = true; return result; }
      let umax = 0;
      for (let i = 0; i < nf; i++) umax = Math.max(umax, Math.abs(u[i]));
      if (umax > span * 1000 * 0.2) { result.mechanism = true; return result; }   // wobbly: effectively a mechanism
      const full = new Float64Array(nd);
      free.forEach((d, i) => { full[d] = u[i]; });
      let defl = 0;
      for (let i = 0; i <= n; i++) defl = Math.max(defl, -full[map[i] + 1] / LOAD_FACTOR); // service deflection
      const forces = new Float64Array(members.length);
      let util = 0, buck = 0, worst = -1;
      members.forEach((m, j) => {
        const ia = map[m.c.a], ib = map[m.c.b];
        const ext = (full[ib] - full[ia]) * m.cx + (full[ib + 1] - full[ia + 1]) * m.cy; // mm
        const N = ((mat.E * m.sec.A) / (m.L * 1000)) * ext / 1000;                       // kN (+ tension)
        forces[j] = N;
        const stress = (Math.abs(N) * 1000) / m.sec.A;                                   // MPa
        const cap = N >= 0 ? mat.ft : mat.fc;
        const u1 = stress / cap;
        let u2 = 0;
        if (N < 0) {
          const Pcr = (Math.PI ** 2 * mat.E * m.sec.I) / ((m.L * 1000) ** 2) / 1000 / 1.5; // kN, with factor
          u2 = -N / Pcr;
        }
        const uj = Math.max(u1, u2);
        if (uj > Math.max(util, buck)) worst = j;
        util = Math.max(util, u1); buck = Math.max(buck, u2);
      });
      cases[ci].forces = forces; cases[ci].util = util; cases[ci].buck = buck; cases[ci].defl = defl; cases[ci].worst = worst;
      cases[ci].disp = full; cases[ci].map = map;
      if (Math.max(util, buck) > Math.max(result.maxUtil, result.maxBuck)) result.worstCase = ci;
      result.maxUtil = Math.max(result.maxUtil, util);
      result.maxBuck = Math.max(result.maxBuck, buck);
      result.maxDefl = Math.max(result.maxDefl, defl);
    }
    result.cases = cases;
    // per-member envelope of utilisation
    result.memberUtil = members.map((m, j) => {
      let u = 0;
      for (const c of cases) {
        const N = c.forces[j], stress = (Math.abs(N) * 1000) / m.sec.A;
        let v = stress / (N >= 0 ? mat.ft : mat.fc);
        if (N < 0) v = Math.max(v, -N / ((Math.PI ** 2 * mat.E * m.sec.I) / ((m.L * 1000) ** 2) / 1000 / 1.5));
        u = Math.max(u, v);
      }
      return u;
    });
    result.redundancy = clamp((members.length - (nd - 3)) / Math.max(1, n), 0, 1);
    return result;
  }

  // One load case on its own, with a load multiplier (used by the live load
  // test: the vehicle's position and the overload slider change every frame).
  // live: Float64Array of extra downward kN per node (unfactored).
  function analyseCase(prob, des, live, mult, base) {
    const res = base || analyse(prob, des);
    if (res.mechanism) return { mechanism: true };
    const { n, mat } = prob;
    const members = res.members;
    const map = res.cases[0].map;
    let nd = 0; for (let i = 0; i < map.length; i++) if (map[i] >= 0) nd = Math.max(nd, map[i] + 2);
    const fixed = new Set([map[0], map[0] + 1, map[n] + 1]);
    const free = []; for (let d = 0; d < nd; d++) if (!fixed.has(d)) free.push(d);
    const fIndex = new Int16Array(nd).fill(-1); free.forEach((d, i) => { fIndex[d] = i; });
    const nf = free.length, K = new Float64Array(nf * nf);
    for (const m of members) {
      const k = (mat.E * m.sec.A) / (m.L * 1000) / 1000;
      const ia = map[m.c.a], ib = map[m.c.b], dofs = [ia, ia + 1, ib, ib + 1], v = [-m.cx, -m.cy, m.cx, m.cy];
      for (let p = 0; p < 4; p++) { const fp = fIndex[dofs[p]]; if (fp < 0) continue; for (let q = 0; q < 4; q++) { const fq = fIndex[dofs[q]]; if (fq >= 0) K[fp * nf + fq] += k * v[p] * v[q]; } }
    }
    const dead = new Float64Array(prob.nNodes);
    for (const m of members) { const w = (m.kg * 9.81) / 1000 / 2; dead[m.c.a] += w; dead[m.c.b] += w; }
    for (let i = 0; i <= n; i++) dead[i] += prob.load.deckDead * prob.panel * (i === 0 || i === n ? 0.5 : 1);
    const F = new Float64Array(nf);
    for (let i = 0; i < prob.nNodes; i++) {
      if (map[i] < 0) continue;
      const fy = fIndex[map[i] + 1];
      if (fy >= 0) F[fy] = -(dead[i] + live[i] * mult);
    }
    const u = solve(K, F, nf);
    if (!u) return { mechanism: true };
    const full = new Float64Array(nd); free.forEach((d, i) => { full[d] = u[i]; });
    const util = members.map((m) => {
      const ia = map[m.c.a], ib = map[m.c.b];
      const ext = (full[ib] - full[ia]) * m.cx + (full[ib + 1] - full[ia + 1]) * m.cy;
      const N = ((mat.E * m.sec.A) / (m.L * 1000)) * ext / 1000;
      m.N = N;
      // real capacity (no design safety margins): material strength x 1.5, buckling without factor
      let v = ((Math.abs(N) * 1000) / m.sec.A) / ((N >= 0 ? mat.ft : mat.fc) * 1.5);
      if (N < 0) v = Math.max(v, -N / ((Math.PI ** 2 * mat.E * m.sec.I) / ((m.L * 1000) ** 2) / 1000));
      return v;
    });
    return { members, util, disp: full, map, xy: res.xy, mechanism: false };
  }

  // Live loads for a vehicle whose front axle is at x (m), or a crowd up to x.
  function liveAt(prob, x) {
    const live = new Float64Array(prob.nNodes), { n, panel, load } = prob;
    const put = (pos, P) => {
      if (pos < 0 || pos > prob.span) return;
      const f = pos / panel, i = Math.min(n - 1, Math.floor(f)), t = f - i;
      live[i] += P * (1 - t); live[i + 1] += P * t;
    };
    if (load.udl) {
      for (let i = 0; i <= n; i++) {
        const xi = i * panel;
        if (xi <= x) live[i] += load.udl * panel * (i === 0 || i === n ? 0.5 : 1);
      }
    } else {
      for (const ax of load.axles) put(x - ax.dx, ax.P);
    }
    return live;
  }

  // ------------------------------------------------------------------
  // Fuzzy safety rating
  // ------------------------------------------------------------------
  function mu(x, [a, b, c]) {
    if (x <= a) return a === b ? 1 : 0;
    if (x >= c) return b === c ? 1 : 0;
    return x < b ? (x - a) / (b - a) : (c - x) / (c - b);
  }
  function defaultFuzzy() {
    return {
      inputs: {
        stress: { label: 'Stress used', max: 1.6, sets: { low: [0, 0, 0.6], medium: [0.4, 0.75, 1.0], high: [0.9, 1.2, 1.2] } },
        buckling: { label: 'Buckling used', max: 1.6, sets: { low: [0, 0, 0.6], medium: [0.4, 0.75, 1.0], high: [0.9, 1.2, 1.2] } },
        sag: { label: 'Sag vs. limit', max: 1.6, sets: { small: [0, 0, 0.7], ok: [0.5, 0.85, 1.05], large: [0.95, 1.25, 1.25] } },
        backup: { label: 'Spare members', max: 1, sets: { none: [0, 0, 0.35], some: [0.15, 0.5, 0.85], plenty: [0.6, 1, 1] } },
      },
      output: { label: 'Safety', sets: { unsafe: [0, 0, 0.3], risky: [0.15, 0.4, 0.6], good: [0.5, 0.72, 0.9], excellent: [0.8, 1, 1] } },
      rules: [
        { on: true, if: [['stress', 'low'], ['buckling', 'low'], ['sag', 'small']], then: 'excellent' },
        { on: true, if: [['stress', 'medium'], ['buckling', 'low'], ['sag', 'small']], then: 'good' },
        { on: true, if: [['stress', 'medium'], ['buckling', 'medium'], ['sag', 'ok']], then: 'good' },
        { on: true, if: [['stress', 'low'], ['buckling', 'medium']], then: 'good' },
        { on: true, if: [['stress', 'high']], then: 'unsafe' },
        { on: true, if: [['buckling', 'high']], then: 'unsafe' },
        { on: true, if: [['sag', 'large']], then: 'risky' },
        { on: true, if: [['stress', 'medium'], ['backup', 'none']], then: 'risky' },
        { on: true, if: [['stress', 'medium'], ['backup', 'plenty']], then: 'good' },
        { on: true, if: [['sag', 'ok'], ['backup', 'some']], then: 'good' },
      ],
    };
  }
  function fuzzyEval(fz, x, explain) {
    const agg = new Float32Array(101), fired = [];
    fz.rules.forEach((r, k) => {
      if (!r.on) return;
      let w = 1;
      for (const [v, s] of r.if) w = Math.min(w, mu(x[v], fz.inputs[v].sets[s]));
      if (w <= 0) return;
      fired.push({ k, w });
      const set = fz.output.sets[r.then];
      for (let i = 0; i <= 100; i++) { const m = Math.min(w, mu(i / 100, set)); if (m > agg[i]) agg[i] = m; }
    });
    let num = 0, den = 0;
    for (let i = 0; i <= 100; i++) { num += agg[i] * i; den += agg[i]; }
    const v = den > 0 ? num / den : 0;
    return explain ? { value: v, agg, fired } : v;
  }
  function fuzzyInputs(res) {
    return {
      stress: clamp(res.maxUtil, 0, 1.6),
      buckling: clamp(res.maxBuck, 0, 1.6),
      sag: clamp(res.maxDefl / res.deflLimit, 0, 1.6),
      backup: res.redundancy,
    };
  }
  // A crisp pass/fail, used to report results honestly alongside the fuzzy score.
  function passes(res) { return !res.mechanism && res.maxUtil <= 1 && res.maxBuck <= 1 && res.maxDefl <= res.deflLimit; }

  // ------------------------------------------------------------------
  // Member sizing: "fully stressed design", the classic engineering rule.
  // Each member gets the lightest section that carries its worst force,
  // then the bridge is re-analysed (its own weight changed) and repeated.
  // The GA decides the shape and which members exist; this picks sizes.
  // ------------------------------------------------------------------
  function sizeMembers(prob, des, rounds) {
    const mat = prob.mat, secs = mat.sections;
    let res = null;
    for (let r = 0; r < (rounds || 3); r++) {
      res = analyse(prob, des);
      if (res.mechanism) return res;
      res.members.forEach((m, j) => {
        let T = 0, C = 0;
        for (const c of res.cases) { const N = c.forces[j]; if (N > T) T = N; if (-N > C) C = -N; }
        let pick = secs.length - 1;
        for (let i = 0; i < secs.length; i++) {
          const sc = secs[i];
          const okT = (T * 1000) / sc.A <= mat.ft * 0.95;
          const okC = (C * 1000) / sc.A <= mat.fc * 0.95 && C <= ((Math.PI ** 2 * mat.E * sc.I) / ((m.L * 1000) ** 2) / 1000 / 1.5) * 0.95;
          if (okT && okC) { pick = i; break; }
        }
        des.s[m.c.k] = pick;
      });
    }
    return analyse(prob, des);
  }

  // ------------------------------------------------------------------
  // Fitness: material cost, with fuzzy safety as a soft constraint
  // ------------------------------------------------------------------
  const SAFE_TARGET = 62;
  function evaluate(prob, des, fz, useFuzzy, noSizing) {
    const res = noSizing ? analyse(prob, des) : sizeMembers(prob, des, 3);
    if (res.mechanism) return { res, safety: 0, fit: 1e12, ok: false };
    let safety, pen;
    if (useFuzzy === false) {
      // crisp alternative: hard pass/fail with a big step penalty
      safety = passes(res) ? 100 : 0;
      pen = passes(res) ? 0 : 3 + Math.max(0, res.maxUtil - 1, res.maxBuck - 1, res.maxDefl / res.deflLimit - 1) * 4;
    } else {
      safety = fuzzyEval(fz, fuzzyInputs(res));
      pen = safety < SAFE_TARGET ? ((SAFE_TARGET - safety) / 8) ** 2 : 0;
      // beyond the fuzzy range, keep pushing towards safety
      const over = Math.max(0, res.maxUtil - 1.2, res.maxBuck - 1.2, res.maxDefl / res.deflLimit - 1.25);
      pen += 6 * Math.log1p(over);
    }
    return { res, safety, fit: res.costRs * (1 + pen), ok: passes(res) };
  }

  // ------------------------------------------------------------------
  // Genetic algorithm
  // ------------------------------------------------------------------
  function randomDesign(prob) {
    const m = prob.n - 1, ns = prob.mat.sections.length;
    const des = { h: new Float32Array(m), dx: new Float32Array(m), s: new Int8Array(prob.cand.length) };
    const base = (0.3 + random() * 0.7) * prob.hMax;
    for (let i = 0; i < m; i++) { des.h[i] = clamp(base * (0.6 + random() * 0.6), 0.5, prob.hMax); des.dx[i] = (random() - 0.5) * 0.3; }
    for (const c of prob.cand) {
      const always = c.kind === 'deck' || c.kind === 'top' || c.kind === 'end';
      des.s[c.k] = always || random() < 0.6 ? randInt(ns) : -1;
    }
    return des;
  }
  function cloneDesign(d) { return { h: new Float32Array(d.h), dx: new Float32Array(d.dx), s: new Int8Array(d.s) }; }

  // Classic textbook trusses for comparison (fixed shape; only sizes evolve).
  function textbook(prob, type) {
    const m = prob.n - 1, mid = prob.n / 2;
    const des = { h: new Float32Array(m).fill(Math.max(1.5, prob.span / 7)), dx: new Float32Array(m), s: new Int8Array(prob.cand.length).fill(-1) };
    for (const c of prob.cand) {
      const ns = prob.mat.sections.length;
      const pick = () => Math.floor(ns / 2);
      if (c.kind === 'deck' || c.kind === 'top' || c.kind === 'end') des.s[c.k] = pick();
      else if (c.kind === 'vert') des.s[c.k] = pick();
      else {
        const di = c.a, ui = c.b - prob.n; // deck i to upper j
        const towardsCentre = Math.abs(ui - mid) < Math.abs(di - mid);
        if (type === 'pratt' && !towardsCentre) des.s[c.k] = pick();
        if (type === 'howe' && towardsCentre) des.s[c.k] = pick();
        if (type === 'warren') {                     // diagonals alternate panel by panel
          const p = Math.min(di, ui), rising = ui === di + 1;
          if ((p % 2 === 0) === rising) des.s[c.k] = pick();
        }
      }
    }
    return des;
  }

  function GA(prob, fz, opts) {
    opts = opts || {};
    this.prob = prob; this.fz = fz;
    this.pop = opts.pop || 70;
    this.fixedShape = opts.fixedShape || null;   // sizing-only mode
    this.useFuzzy = opts.useFuzzy !== false;
    this.noSizing = !!opts.noSizing;
    this.gen = 0; this.history = [];
    this.individuals = [];
    for (let i = 0; i < this.pop; i++) {
      const d = this.fixedShape ? this.resize(cloneDesign(this.fixedShape)) : randomDesign(prob);
      this.individuals.push(this.score(d));
    }
    this.sort();
  }
  GA.prototype.resize = function (d) {
    const ns = this.prob.mat.sections.length;
    for (let k = 0; k < d.s.length; k++) if (d.s[k] >= 0) d.s[k] = randInt(ns);
    return d;
  };
  GA.prototype.score = function (d) { const e = evaluate(this.prob, d, this.fz, this.useFuzzy, this.noSizing); e.d = d; return e; };
  GA.prototype.sort = function () {
    this.individuals.sort((a, b) => a.fit - b.fit);
    this.best = this.individuals[0];
    this.history.push({ cost: this.best.res.costRs, fit: this.best.fit, safety: this.best.safety });
  };
  GA.prototype.select = function () {
    let b = null;
    for (let i = 0; i < 3; i++) { const c = this.individuals[randInt(this.individuals.length)]; if (!b || c.fit < b.fit) b = c; }
    return b;
  };
  GA.prototype.step = function () {
    const prob = this.prob, ns = prob.mat.sections.length;
    const next = this.individuals.slice(0, 2);
    while (next.length < this.pop) {
      const A = this.select().d, B = this.select().d;
      const c = cloneDesign(A);
      if (!this.fixedShape) {
        const w = random();
        for (let i = 0; i < c.h.length; i++) {
          c.h[i] = A.h[i] * w + B.h[i] * (1 - w);
          c.dx[i] = random() < 0.5 ? A.dx[i] : B.dx[i];
          if (random() < 0.15) c.h[i] = clamp(c.h[i] + gauss() * prob.hMax * 0.08, 0.4, prob.hMax);
          if (random() < 0.08) c.dx[i] = clamp(c.dx[i] + gauss() * 0.1, -0.4, 0.4);
        }
      }
      for (let k = 0; k < c.s.length; k++) {
        if (random() < 0.5) c.s[k] = B.s[k];
        if (this.fixedShape && this.fixedShape.s[k] < 0) { c.s[k] = -1; continue; }
        if (random() < 0.06) {
          const kind = prob.cand[k].kind;
          const optional = !this.fixedShape && (kind === 'vert' || kind === 'diag');
          if (optional && random() < 0.3) c.s[k] = c.s[k] < 0 ? randInt(ns) : -1;
          else if (c.s[k] >= 0) c.s[k] = clamp(c.s[k] + (random() < 0.5 ? -1 : 1), 0, ns - 1);
          else if (!optional) c.s[k] = randInt(ns);
        }
      }
      next.push(this.score(c));
    }
    this.individuals = next;
    this.gen++;
    this.sort();
    return this.best;
  };

  root.Setu = {
    seed, random, randInt, gauss, clamp, mulberry32,
    MATERIALS, LOADS, LOAD_FACTOR, makeProblem, geometry, analyse, analyseCase, liveAt, passes,
    mu, defaultFuzzy, fuzzyEval, fuzzyInputs, evaluate, SAFE_TARGET,
    randomDesign, cloneDesign, textbook, GA, sizeMembers,
  };
})(typeof window !== 'undefined' ? window : globalThis);
