// tools/structure/ratchets.mjs
// The four structure ratchets (C1 cycles, C2 import budget, C3 boundaries,
// C4 hub register) as pure functions over scanner graphs, so they are tested
// with fixtures. C1 and C3 fail the build; C2 and C4 are report only (decided
// 2026-10-15): they print a trend line and their offenders, never a failure.
// Every message names the offending edge/file and the fix. The baselines
// (tools/structure/*.json) may only shrink; see README.md.
import { isProductFile, isTestFile } from "./scanner.mjs"

export const HUB_FAN_IN_RATIO = 0.25
export const MIN_CYCLE_SIZE = 3

const sortStr = (a) => [...a].sort()
const preview = (list, n = 8) => list.slice(0, n).join(", ") + (list.length > n ? `, … (+${list.length - n} more)` : "")

/** A project graph restricted to what the ratchets look at. */
export function prepare(graph) {
  const product = new Set(graph.files.filter(isProductFile))
  const tests = graph.files.filter(isTestFile)
  return { ...graph, product, tests }
}

// ---------------------------------------------------------------------------
// C1 — strongly connected components of the product import graph
// ---------------------------------------------------------------------------

/** Tarjan, iterative (a 70-deep recursion is fine, but the graph is arbitrary). */
export function stronglyConnected(nodes, edgesOf) {
  const index = new Map()
  const low = new Map()
  const onStack = new Set()
  const stack = []
  const out = []
  let counter = 0
  for (const root of nodes) {
    if (index.has(root)) continue
    const work = [[root, 0]]
    while (work.length > 0) {
      const frame = work[work.length - 1]
      const [v, i] = frame
      if (i === 0) {
        index.set(v, counter); low.set(v, counter); counter++
        stack.push(v); onStack.add(v)
      }
      const succ = edgesOf(v)
      if (i < succ.length) {
        frame[1] = i + 1
        const w = succ[i]
        if (!index.has(w)) work.push([w, 0])
        else if (onStack.has(w)) low.set(v, Math.min(low.get(v), index.get(w)))
        continue
      }
      work.pop()
      if (work.length > 0) {
        const parent = work[work.length - 1][0]
        low.set(parent, Math.min(low.get(parent), low.get(v)))
      }
      if (low.get(v) === index.get(v)) {
        const comp = []
        let w
        do { w = stack.pop(); onStack.delete(w); comp.push(w) } while (w !== v)
        out.push(comp)
      }
    }
  }
  return out
}

/** Product-only SCCs of size ≥ MIN_CYCLE_SIZE, each sorted, largest first. */
export function cycleComponents(g) {
  const edgesOf = (f) => g.edges.get(f).filter((t) => g.product.has(t))
  return stronglyConnected([...g.product].sort(), edgesOf)
    .filter((c) => c.length >= MIN_CYCLE_SIZE)
    .map(sortStr)
    .sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]))
}

/** Shortest import chain `start → … → start` inside `members`. */
export function cycleThrough(g, members, start) {
  const inSet = new Set(members)
  const prev = new Map()
  const queue = []
  for (const w of g.edges.get(start)) if (inSet.has(w) && !prev.has(w)) { prev.set(w, start); queue.push(w) }
  for (let q = 0; q < queue.length; q++) {
    const v = queue[q]
    if (g.edges.get(v).includes(start)) {
      const chain = [start]
      for (let c = v; c !== start; c = prev.get(c)) chain.splice(1, 0, c)
      return [...chain, start]
    }
    for (const w of g.edges.get(v)) if (inSet.has(w) && !prev.has(w)) { prev.set(w, v); queue.push(w) }
  }
  return [start]
}

export function checkCycles(project, g, baseline) {
  const failures = []
  const notes = []
  const current = cycleComponents(g)
  const recorded = (baseline?.components ?? []).map((c) => new Set(c))
  const recordedLargest = baseline?.largest ?? 0

  for (const comp of current) {
    const home = recorded.findIndex((r) => comp.every((f) => r.has(f)))
    if (home >= 0) continue
    // Not wholly inside one recorded cycle: a new cycle, or a recorded one that grew/merged.
    let best = -1
    let bestOverlap = 0
    recorded.forEach((r, i) => {
      const n = comp.filter((f) => r.has(f)).length
      if (n > bestOverlap) { best = i; bestOverlap = n }
    })
    const culprits = best < 0 ? comp : comp.filter((f) => !recorded[best].has(f))
    const chain = cycleThrough(g, comp, culprits[0])
    failures.push(
      `[cycles/${project}] ${best < 0 ? "NEW import cycle" : "a recorded cycle GREW or MERGED"} — ${comp.length} files now import each other in a loop (${culprits.length} not in the baseline: ${preview(culprits, 5)}).\n`
      + `    e.g. ${chain.join("\n      -> ")}\n`
      + "    Fix: break one edge in that chain — make the import `import type`, move the shared piece to a leaf module both sides import, or inject the collaborator at registration time (the way registerStaticCreditCosts does). Do NOT add the files to tools/structure/cycles.json.")
  }
  const largest = current[0]?.length ?? 0
  if (largest > recordedLargest) {
    failures.push(`[cycles/${project}] the largest import cycle grew: ${largest} files (baseline ${recordedLargest}). Break the cycle instead of widening it.`)
  }

  const stale = baseline?.components?.some((c) => !current.some((cur) => cur.length === c.length && cur.every((f, i) => f === c[i]))) ?? false
  if (stale || largest < recordedLargest) {
    notes.push(`[cycles/${project}] the cycle shrank (largest ${largest}, baseline ${recordedLargest}) — tighten the baseline: node tools/structure/cli.mjs --tighten`)
  }
  return { failures, notes, current: { largest, components: current } }
}

// ---------------------------------------------------------------------------
// Closures (C2, C4)
// ---------------------------------------------------------------------------

/** Every file a test loads, through any chain (helpers included, itself excluded). */
export function closureOf(g, start) {
  const seen = new Set([start])
  const stack = [start]
  while (stack.length > 0) {
    for (const w of g.edges.get(stack.pop())) if (!seen.has(w)) { seen.add(w); stack.push(w) }
  }
  seen.delete(start)
  return seen
}

/** For each test: the number of product files it loads; and each product file's fan-in. */
export function measureClosures(g) {
  const size = new Map()
  const fanIn = new Map()
  for (const t of g.tests) {
    let n = 0
    for (const f of closureOf(g, t)) {
      if (!g.product.has(f)) continue
      n++
      fanIn.set(f, (fanIn.get(f) ?? 0) + 1)
    }
    size.set(t, n)
  }
  return { size, fanIn }
}

// ---------------------------------------------------------------------------
// C2 — test import budget
// ---------------------------------------------------------------------------

function heaviestImports(g, test, n = 3) {
  return g.edges.get(test)
    .map((d) => [d, g.product.has(d) ? 1 + [...closureOf(g, d)].filter((x) => g.product.has(x)).length : 0])
    .sort((a, b) => b[1] - a[1]).slice(0, n)
    .map(([d, k]) => `${d} (${k} files)`)
}

// REPORT ONLY (decided 2026-10-15): a budget overrun never fails the build. The
// check returns `findings` (one line per offender, the fix included) and a
// one-line `report` with the trend against the baseline, for the CI log and job
// summary; `notes` still prompt `--tighten` when a listed test slimmed down.
export function checkImportBudget(project, g, measured, baseline) {
  const findings = []
  const notes = []
  const limit = baseline?.default ?? 300
  const listed = baseline?.tests?.[project] ?? {}
  const fresh = []
  const grew = []
  let shrank = 0
  let within = 0
  let over = 0
  for (const t of g.tests) {
    const size = measured.size.get(t)
    if (size > limit) over++
    const cap = listed[t]
    if (cap === undefined) {
      if (size > limit) fresh.push([t, size])
    } else if (size > cap) {
      grew.push([t, size, cap])
    } else if (size <= limit) {
      within++
      notes.push(`[import-budget/${project}] ${t} is now within the default budget (${size} ≤ ${limit}) — remove it from the list: node tools/structure/cli.mjs --tighten`)
    } else if (size < cap) {
      shrank++
      notes.push(`[import-budget/${project}] ${t} shrank (${size} < recorded ${cap}) — tighten the baseline: node tools/structure/cli.mjs --tighten`)
    }
  }
  const SHOWN = 5
  fresh.sort((x, y) => y[1] - x[1])
  for (const [t, size] of fresh.slice(0, SHOWN)) {
    findings.push(`[import-budget/${project}] ${t} loads ${size} product files (budget ${limit}). Heaviest direct imports: ${heaviestImports(g, t).join("; ")}.\n`
      + "    To fix: import the narrow module instead of a hub/barrel, or mock the heavy collaborator, so the test loads less.")
  }
  if (fresh.length > SHOWN) findings.push(`[import-budget/${project}] …and ${fresh.length - SHOWN} more unlisted tests over the budget.`)
  // One new import inside a module many heavy tests share grows all of them by
  // the same file: name a few, then say it once instead of hundreds of times.
  grew.sort((x, y) => (y[1] - y[2]) - (x[1] - x[2]))
  for (const [t, size, cap] of grew.slice(0, SHOWN)) {
    findings.push(`[import-budget/${project}] ${t} grew to ${size} product files (recorded ${cap}). Heaviest direct imports: ${heaviestImports(g, t).join("; ")}.\n`
      + "    To fix: undo the import that pulled the new files in, or make it narrower (import the leaf module, `import type`, or a dynamic import() where it is used).")
  }
  if (grew.length > SHOWN) {
    const by = grew.map(([, size, cap]) => size - cap)
    const lo = Math.min(...by)
    const hi = Math.max(...by)
    findings.push(`[import-budget/${project}] …and ${grew.length - SHOWN} more listed tests grew (${grew.length} in all, by ${lo === hi ? lo : `${lo}–${hi}`} file${hi === 1 ? "" : "s"} each). `
      + "When many grow at once, a module they all load gained an import — usually a hub (tools/structure/hubs.json) or a member of the recorded cycle.")
  }
  for (const t of Object.keys(listed)) {
    if (!measured.size.has(t)) notes.push(`[import-budget/${project}] ${t} no longer exists — remove it from the list: node tools/structure/cli.mjs --tighten`)
  }
  const heaviest = g.tests.map((t) => [t, measured.size.get(t)]).filter(([, n]) => n > limit)
    .sort((x, y) => y[1] - x[1]).slice(0, 3).map(([t, n]) => `${t} (${n})`)
  const report = `[import-budget/${project}] report only — ${over} tests over the ${limit}-file budget (baseline lists ${Object.keys(listed).length}): `
    + `${fresh.length} new over budget, ${grew.length} grew, ${shrank} shrank, ${within} back within budget.`
    + (heaviest.length > 0 ? ` Heaviest: ${heaviest.join(", ")}.` : "")
  return { failures: [], findings, notes, report }
}

// ---------------------------------------------------------------------------
// C3 — boundary rules
// ---------------------------------------------------------------------------

// (Backend core ↛ ee/billing/credits.ts is already enforced for static imports
// by tools/check-ee-imports.mjs, whose ALLOWLIST is the exception list — not
// duplicated here.)
export const BOUNDARY_RULES = [
  {
    id: "frontend-lib-not-ui",
    project: "frontend",
    from: /^frontend\/src\/lib\//,
    to: /^frontend\/src\/(?:components|app)\//,
    why: "src/lib is the layer below the UI: it may not import src/components or src/app",
    fix: "move the shared piece down into src/lib (or a hook/store the component reads), or invert it: let the component pass the value/callback in",
  },
]

export function boundaryEdges(rule, g) {
  const out = []
  for (const f of g.product) {
    if (!rule.from.test(f)) continue
    for (const t of g.edges.get(f)) if (g.product.has(t) && rule.to.test(t)) out.push(`${f} -> ${t}`)
  }
  return out.sort()
}

export function checkBoundaries(project, g, baseline) {
  const failures = []
  const notes = []
  for (const rule of BOUNDARY_RULES.filter((r) => r.project === project)) {
    const now = boundaryEdges(rule, g)
    const known = new Set(baseline?.[rule.id] ?? [])
    for (const e of now.filter((x) => !known.has(x))) {
      failures.push(`[boundaries/${rule.id}] ${e} — ${rule.why}.\n    Fix: ${rule.fix}. Do NOT add the edge to tools/structure/boundaries.json — that list only shrinks.`)
    }
    const nowSet = new Set(now)
    if ([...known].some((e) => !nowSet.has(e))) {
      notes.push(`[boundaries/${rule.id}] ${[...known].filter((e) => !nowSet.has(e)).length} recorded violation(s) are fixed — tighten the baseline: node tools/structure/cli.mjs --tighten`)
    }
  }
  return { failures, notes }
}

// ---------------------------------------------------------------------------
// C4 — hub register
// ---------------------------------------------------------------------------

export const hubThreshold = (testCount) => Math.max(1, Math.ceil(testCount * HUB_FAN_IN_RATIO))

export function currentHubs(g, measured) {
  const min = hubThreshold(g.tests.length)
  return [...measured.fanIn].filter(([, n]) => n >= min).map(([f]) => f).sort()
}

// REPORT ONLY (decided 2026-10-15), like the import budget: entering the hub
// set is a finding and a trend line, never a failure.
export function checkHubs(project, g, measured, baseline) {
  const findings = []
  const notes = []
  const min = hubThreshold(g.tests.length)
  const now = currentHubs(g, measured)
  const known = new Set(baseline?.[project] ?? [])
  const pct = (n) => Math.round(100 * n / g.tests.length)
  const entered = now.filter((x) => !known.has(x)).sort((x, y) => measured.fanIn.get(y) - measured.fanIn.get(x))
  for (const f of entered) {
    const n = measured.fanIn.get(f)
    findings.push(`[hubs/${project}] ${f} is now loaded by ${n} of ${g.tests.length} tests (${pct(n)} %, hub threshold ${min} = ${HUB_FAN_IN_RATIO * 100} %) and is not in the hub register.\n`
      + "    Every edit to a hub selects most of the suite. To fix: have fewer tests reach it (import a narrower module, split the hub, break the cycle that pulls it in).")
  }
  const nowSet = new Set(now)
  const gone = [...known].filter((f) => !nowSet.has(f))
  if (gone.length > 0) {
    notes.push(`[hubs/${project}] ${gone.length} registered hub(s) dropped below ${HUB_FAN_IN_RATIO * 100} % fan-in (${preview(gone, 3)}) — remove from the register: node tools/structure/cli.mjs --tighten`)
  }
  const report = `[hubs/${project}] report only — ${now.length} hubs (fan-in ≥ ${min} of ${g.tests.length} tests; register lists ${known.size}): `
    + `${entered.length} entered, ${gone.length} left.`
    + (entered.length > 0 ? ` Entered: ${entered.slice(0, 3).map((f) => `${f} (${pct(measured.fanIn.get(f))} %)`).join(", ")}${entered.length > 3 ? ", …" : ""}.` : "")
  return { failures: [], findings, notes, report, current: now }
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

/** @param {{name:string}[]} graphs prepared graphs; `baselines` = the four JSON files' contents */
export function runAll(graphs, baselines) {
  const failures = []
  const notes = []
  const findings = []
  const reports = []
  const current = { cycles: {}, importBudget: {}, boundaries: {}, hubs: {} }
  const summary = []
  for (const g of graphs) {
    const measured = measureClosures(g)
    const c1 = checkCycles(g.name, g, baselines.cycles?.[g.name])
    const c2 = checkImportBudget(g.name, g, measured, baselines.importBudget)
    const c3 = checkBoundaries(g.name, g, baselines.boundaries)
    const c4 = checkHubs(g.name, g, measured, baselines.hubs)
    for (const r of [c1, c2, c3, c4]) { failures.push(...r.failures); notes.push(...r.notes) }
    for (const r of [c2, c4]) { findings.push(...r.findings); reports.push(r.report) }
    current.cycles[g.name] = c1.current
    current.importBudget[g.name] = Object.fromEntries(
      g.tests.filter((t) => measured.size.get(t) > (baselines.importBudget?.default ?? 300))
        .sort().map((t) => [t, measured.size.get(t)]))
    current.boundaries = { ...current.boundaries, ...Object.fromEntries(BOUNDARY_RULES.filter((r) => r.project === g.name).map((r) => [r.id, boundaryEdges(r, g)])) }
    current.hubs[g.name] = c4.current
    summary.push(`${g.name}: ${g.tests.length} tests, ${g.product.size} product files, largest cycle ${c1.current.largest}, `
      + `${Object.keys(current.importBudget[g.name]).length} over-budget tests, ${c4.current.length} hubs`)
  }
  // failures: C1 + C3, which fail the build. findings + reports: C2 + C4, report only.
  return { failures, notes, findings, reports, current, summary }
}

const sortedEntries = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)))

/** Baselines recording today's state exactly (initial creation; reviewers see the diff). */
export function initialBaselines(current, defaultBudget = 300) {
  return {
    cycles: Object.fromEntries(Object.entries(current.cycles).map(([p, c]) => [p, { largest: c.largest, components: c.components }])),
    importBudget: { default: defaultBudget, tests: current.importBudget },
    boundaries: sortedEntries(current.boundaries),
    hubs: sortedEntries(current.hubs),
  }
}

/**
 * Shrinks the baselines to what is true now — never adds an entry or raises a
 * number. Only meaningful when runAll has no failures.
 */
export function tightenedBaselines(current, baselines) {
  const cycles = {}
  for (const [p, c] of Object.entries(current.cycles)) {
    const recorded = (baselines.cycles?.[p]?.components ?? []).map((r) => new Set(r))
    const kept = c.components.filter((comp) => recorded.some((r) => comp.every((f) => r.has(f))))
    cycles[p] = { largest: kept[0]?.length ?? 0, components: kept }
  }
  const limit = baselines.importBudget?.default ?? 300
  const tests = {}
  for (const [p, now] of Object.entries(current.importBudget)) {
    const listed = baselines.importBudget?.tests?.[p] ?? {}
    tests[p] = Object.fromEntries(Object.entries(now).filter(([t, n]) => listed[t] !== undefined && n > limit).map(([t, n]) => [t, Math.min(n, listed[t])]))
  }
  const boundaries = {}
  for (const [id, now] of Object.entries(current.boundaries)) {
    const known = new Set(baselines.boundaries?.[id] ?? [])
    boundaries[id] = now.filter((e) => known.has(e))
  }
  const hubs = {}
  for (const [p, now] of Object.entries(current.hubs)) {
    const known = new Set(baselines.hubs?.[p] ?? [])
    hubs[p] = now.filter((f) => known.has(f))
  }
  return { cycles, importBudget: { default: limit, tests }, boundaries, hubs }
}
