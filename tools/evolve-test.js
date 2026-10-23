// Headless: evolve a bridge and compare with textbook trusses.
//   node tools/evolve-test.js [span] [load] [material]
require('../js/core.js');
const S = globalThis.Setu;
const span = +(process.argv[2] || 30), load = process.argv[3] || 'truck', mat = process.argv[4] || 'steel';
S.seed(3);
const prob = S.makeProblem(span, load, mat);
const fz = S.defaultFuzzy();
const t0 = Date.now();
const ga = new S.GA(prob, fz);
for (let g = 0; g < 150; g++) { ga.step(); if (g % 50 === 0) { const b = ga.best; console.log('gen', g, 'Rs', Math.round(b.res.costRs), 'kg', Math.round(b.res.massKg), 'safety', b.safety.toFixed(0), 'ok', b.ok, 'util', b.res.maxUtil.toFixed(2), 'buck', b.res.maxBuck.toFixed(2), 'defl', (b.res.maxDefl / b.res.deflLimit).toFixed(2)); } }
const b = ga.best;
console.log('EVOLVED', Math.round(b.res.massKg), 'kg', 'safety', b.safety.toFixed(0), 'pass', b.ok, 'members', b.res.members.length, (Date.now() - t0) + 'ms');
for (const t of ['pratt', 'howe', 'warren']) {
  const d = S.textbook(prob, t);
  const r = S.evaluate(prob, d, fz, true);
  console.log(t.padEnd(7), Math.round(r.res.massKg), 'kg', 'safety', r.safety.toFixed(0), 'pass', r.ok, 'mech', r.res.mechanism);
}
