#!/usr/bin/env node
// Import cost of package specifiers (or file paths) as a consumer sees it:
//   node tools/package-entries/measure-import.mjs <runs> <spec-or-path>...
// Per spec: median over <runs> FRESH processes (run from backend/) of the import's
// CPU time (user+sys, ms) and wall time, for ESM import and CJS require. CPU time
// is the column to compare on a shared/loaded machine; Node start-up is excluded.
import { execFileSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
const [runs, ...specs] = process.argv.slice(2)
const cwd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "backend")
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] }
const one = (load) => JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e",
  `import {createRequire} from "node:module"; const require=createRequire(${JSON.stringify(cwd + "/x.js")});
   const c=process.cpuUsage(); const t=performance.now(); ${load}; const w=performance.now()-t; const u=process.cpuUsage(c);
   console.log(JSON.stringify({cpu:(u.user+u.system)/1000, wall:w}))`], { cwd, encoding: "utf8" }))
console.log("spec\tesm_cpu\tesm_wall\tcjs_cpu\tcjs_wall")
for (const spec of specs) {
  const e = [], c = []
  for (let i = 0; i < Number(runs); i++) {
    e.push(one(`await import(${JSON.stringify(spec)})`))
    c.push(one(`require(${JSON.stringify(spec)})`))
  }
  const f = (a, k) => med(a.map((x) => x[k])).toFixed(1)
  console.log(`${spec}\t${f(e, "cpu")}\t${f(e, "wall")}\t${f(c, "cpu")}\t${f(c, "wall")}`)
}
