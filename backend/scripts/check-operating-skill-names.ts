// NODARO_TOKEN=<bearer> npx tsx backend/scripts/check-operating-skill-names.ts --api https://next.nodaro.ai
//   railway run --service <service> -- npx tsx backend/scripts/check-operating-skill-names.ts --api https://next.nodaro.ai
//
// Run it from the REPO ROOT (the fixture path below is repo-relative), with the
// backend env present: it imports the tool module for the name list, and that
// import loads `lib/config.ts`, which refuses to be imported without the
// service env — the same reason `check-loops-templates.ts` documents a
// `railway run` invocation.
//
// The TOOL-NAME half of the operating-skill drift check. The op-name
// half lives in the plugins repo, against the op schema's own option list; only
// the tool names can be checked from here, because only this tree has them — and
// only the SERVED skill has the guide, which is why this is an acceptance script
// and not a test: it needs a cloud deployment and a token, which CI has neither of.
import { readFileSync } from "node:fs"

import { STUDIO_PRODUCTION_TOOL_NAMES } from "../src/lib/mcp/tools/_studio-helpers.js"

// `indexOf` is read for its ABSENCE, not just its neighbour: `-1 + 1` is 0, so
// a forgotten `--api` would otherwise fetch the node binary's own path as a URL
// and fail with something that names neither the flag nor the deployment.
const apiFlag = process.argv.indexOf("--api")
const api = apiFlag === -1 ? "" : (process.argv[apiFlag + 1] ?? "")
if (!api) {
  console.error("usage: NODARO_TOKEN=<bearer> npx tsx backend/scripts/check-operating-skill-names.ts --api <base url>")
  process.exit(1)
}

// A deployment that is unreachable is a failed check, not a stack trace: every
// other failure here exits 1 with a sentence, and this one is the likeliest.
let res: Response
try {
  res = await fetch(`${api}/v1/studio/productions/skill`, {
    headers: { Authorization: `Bearer ${process.env.NODARO_TOKEN ?? ""}` },
  })
} catch (error) {
  console.error(`skill: could not reach ${api} — ${(error as Error).message}`)
  process.exit(1)
}
if (!res.ok) { console.error(`skill: ${res.status}`); process.exit(1) }
// The route replies in the platform's `{ data: … }` envelope, so the guide is
// `data.operating` — reading a bare `operating` off the response would find
// `undefined` on every deployment, healthy ones included.
const { data } = (await res.json()) as { data?: { operating?: unknown } }
const operating = data?.operating
if (typeof operating !== "string" || !operating.trim()) {
  console.error("the served skill has no non-empty `operating` part"); process.exit(1)
}

// The fixture is the family's registered surface (regenerated in this same PR
// from a real tools/list), so the guide is checked against what actually ships.
const surface = JSON.parse(
  readFileSync("backend/src/lib/mcp/__tests__/fixtures/tool-surface.json", "utf8"),
) as Record<string, string[]>
// The key names the FULL grant on cloud — the surface a consented client sees.
// Named rather than assumed: if the fixture's keys are ever reshaped, this must
// say so rather than compare every tool against an empty set and pass.
const fullSurface = surface["cloud/all"]
if (!Array.isArray(fullSurface)) {
  console.error("the tool-surface fixture has no `cloud/all` key — the surface it is checked against"); process.exit(1)
}
const registered = new Set(fullSurface)
const backticked = new Set([...operating.matchAll(/`([a-z0-9_]+)`/g)].map((m) => m[1]))

// `studio_production` is the Director's LLM-structured schema name, not a tool.
const strays = [...backticked].filter(
  (n) => n.includes("studio") && n !== "studio_production" && !registered.has(n),
)
const unmentioned = STUDIO_PRODUCTION_TOOL_NAMES.filter((n) => !backticked.has(n))
if (strays.length || unmentioned.length) {
  console.error("named in the guide but not a registered tool:", strays)
  console.error("registered tools the guide never mentions:", unmentioned)
  process.exit(1)
}
console.log(`OK: ${STUDIO_PRODUCTION_TOOL_NAMES.length} tools, all mentioned, no strays.`)
