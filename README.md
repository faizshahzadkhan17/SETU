# SETU (सेतु)

**Bridges that evolve.** A genetic algorithm designs truss bridges, a structural solver checks
every design, and a fuzzy-logic "safety officer" judges how safe each one is. Then a loaded
truck drives across in 3D, and you can push the load until the bridge breaks.

## The problem

Thousands of small bridges are built across rivers and streams in India every year, for
footpaths, village roads and district roads. Most use a standard textbook truss shape, picked
from a table. A standard shape is safe, but rarely the cheapest for a particular river width,
load and material. Material is most of the cost, and every extra tonne of steel is money that
could have built another bridge.

SETU searches for a design that passes the same safety checks with less material.

## How it works

| Part | Technique | What it does |
| --- | --- | --- |
| Structural check | **Direct stiffness method** (2D truss finite elements) | Computes the force in every member, the stresses and the sag, for the truck at every position along the bridge (driving on and off), plus the bridge's own weight |
| Member sizing | **Fully stressed design** | Gives each member the lightest section that safely carries its worst force, including buckling (Euler) for members in compression |
| Safety officer | **Fuzzy logic** (Mamdani, 4 inputs, 10 rules, centroid) | Rates each design from 0 to 100 using stress used, buckling used, sag vs. limit and spare members, the way an experienced engineer would weigh them |
| Designer | **Genetic algorithm** (tournament selection, blend + uniform crossover, Gaussian mutation, elitism) | Evolves the shape (height of each top joint), which members exist, and their layout. Fitness = material cost, with the fuzzy safety score as a soft constraint |

## What you can do

- **Set the site:** River width (12–50 m); what crosses it (a crowd of people, cars and autos,
  or a loaded truck); material (steel, timber, or treated bamboo for village footbridges).
- **Evolve:** Watch 60 bridges per generation get analysed and bred. The cost curve drops while
  the 3D bridge changes shape.
- **Compare:** The evolved bridge is shown next to the three classic designs (Pratt, Howe,
  Warren), each sized with the same method and the same safety rules.
- **Design your own:** Drag the top joints and add or remove members in the engineer's drawing.
  It's sized and checked instantly.
- **Load test:** Drive the vehicle across any design and watch each member change colour with
  the force in it. Raise the load or press **Find its breaking point**, and the bridge collapses
  into the river when a member fails.
- **Safety officer:** See the fuzzy membership functions, which rules fired for the current
  design, and the defuzzified safety score. Switch rules off and evolve again. Turn fuzzy safety
  off to compare with a crisp pass/fail fitness.

## Sample result

30 m span, loaded truck, steel (one side truss):

| Design | Weight | Passes all checks |
| --- | --- | --- |
| Evolved | ~2,650 kg | yes |
| Pratt truss | ~2,970 kg | yes |
| Howe truss | ~3,570 kg | yes |

About 11–15% less steel than the best textbook truss for the same site. Results vary from run to run.

## Running it

Open `index.html` through any static server:

```bash
python -m http.server 8000
# open http://localhost:8000
```

Headless test (Node):

```bash
node tools/evolve-test.js 30 truck steel
```

## Files

```
index.html             layout
css/style.css          styles
js/core.js             stiffness-method solver, member sizing, fuzzy safety, genetic algorithm
js/scene.js            Three.js river valley, bridge, vehicles, collapse
js/app.js              controls, engineer's drawing, evolution, load test, fuzzy view
tools/evolve-test.js   headless evolution vs. textbook trusses
```

## Limits

This is a concept-design and teaching tool. It models one side truss in 2D with pinned joints,
simplified IRC-style loads and design strengths, and no dynamic, wind, fatigue or connection
checks. Real bridges must be designed and checked by a qualified engineer to the relevant codes.

---

Faiz Shahzad Khan
