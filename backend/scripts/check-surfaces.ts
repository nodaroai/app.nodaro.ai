/**
 * check:surfaces — for a feature, which user-facing surfaces offer it: the REST
 * route, the OpenAPI spec, the SDK, the CLI, the MCP tools, and the docs for
 * each.
 *
 *   npm run check:surfaces -- characters          # one feature, a row per atom
 *   npm run check:surfaces -- node:generate-image # one node
 *   npm run check:surfaces -- --category video    # every node of a category
 *   npm run check:surfaces -- --all               # one line per feature
 *   … --json                # the report as JSON (schema: lib/check-surfaces/types.ts)
 *   … --surfaces sdk,cli    # only these columns
 *   … --runtime [--edition cloud|community]   # boot the app for the exact route set
 *   … --strict              # exit 1 on any gap or stale exemption
 *
 * Exit codes: 0 report printed (gaps or not, unless --strict), 1 gaps under
 * --strict, 2 usage error or an extractor crash.
 *
 * How the surfaces are read, and what counts as a gap, is in
 * docs/contributing.md ("Checking a feature's surfaces"). Intended gaps go in
 * check-surfaces.exemptions.ts.
 */
// @reads-none runs only git rev-parse for the commit id; every surface is read by lib/check-surfaces/*, declared there
import { execFileSync } from "node:child_process"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..")

// The route and node modules read their config when first imported, so the
// stand-ins go in before any of them is. Nothing here talks to a database.
process.env.DOTENV_CONFIG_PATH ??= join(REPO_ROOT, "backend", ".check-surfaces-no.env")
process.env.SUPABASE_URL ??= "http://127.0.0.1:9"
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "check-surfaces-stand-in"
process.env.INTERNAL_ORCHESTRATOR_SECRET ??= "check-surfaces-stand-in-secret-000000000000"

interface Args {
  targets: string[]
  all: boolean
  category?: string
  json: boolean
  strict: boolean
  runtime: boolean
  edition: "cloud" | "community"
  surfaces?: string[]
}

function usage(message: string): never {
  console.error(`check:surfaces: ${message}\nusage: npm run check:surfaces -- <feature…> | --all | --category <c> [--json] [--strict] [--surfaces a,b] [--runtime [--edition cloud|community]]`)
  process.exit(2)
}

function parseArgs(argv: string[]): Args {
  const a: Args = { targets: [], all: false, json: false, strict: false, runtime: false, edition: "cloud" }
  let editionGiven = false
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i]!
    if (v === "--all") a.all = true
    else if (v === "--json") a.json = true
    else if (v === "--strict") a.strict = true
    else if (v === "--runtime") a.runtime = true
    else if (v === "--category") a.category = argv[++i] ?? usage("--category needs a value")
    else if (v === "--edition") {
      const e = argv[++i]
      if (e !== "cloud" && e !== "community") usage("--edition is cloud or community")
      a.edition = e
      editionGiven = true
    } else if (v === "--surfaces") a.surfaces = (argv[++i] ?? usage("--surfaces needs a list")).split(",")
    else if (v.startsWith("--")) usage(`unknown flag ${v}`)
    else a.targets.push(v)
  }
  if (!a.all && !a.category && !a.targets.length) usage("name a feature, --category or --all")
  if (editionGiven && !a.runtime) usage("--edition needs --runtime (without it the report is the static route set)")
  return a
}

function gitSha(): string {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" }).trim()
  } catch {
    return "unknown"
  }
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2))
  const { SURFACES } = await import("./lib/check-surfaces/types.js")
  if (args.surfaces) {
    const bad = args.surfaces.filter((s) => !(SURFACES as readonly string[]).includes(s))
    if (bad.length) usage(`unknown surface ${bad.join(", ")} (one of ${SURFACES.join(", ")})`)
  }
  const { collectInputs } = await import("./lib/check-surfaces/collect.js")
  const { buildModel, strictFails } = await import("./lib/check-surfaces/model.js")
  const { renderAll, renderFeature } = await import("./lib/check-surfaces/render.js")
  const { FEATURE_ALIASES } = await import("./lib/check-surfaces/features.js")

  const inputs = await collectInputs(REPO_ROOT, { runtime: args.runtime ? args.edition : null, sha: gitSha() })
  const report = buildModel(inputs)

  // Which features were asked for.
  let selected = report.features
  if (!args.all) {
    const wanted = new Set<string>()
    for (const t of args.targets) {
      if (t === "node:*") report.features.filter((f) => f.id.startsWith("node:")).forEach((f) => wanted.add(f.id))
      else {
        const alias = FEATURE_ALIASES.find((f) => f.id === t || f.cli.includes(t))
        const id = alias?.id ?? t
        if (!report.features.some((f) => f.id === id)) usage(`no feature "${t}" (try --all for the list)`)
        wanted.add(id)
      }
    }
    if (args.category) {
      const types = new Set(inputs.nodes.filter((n) => n.category === args.category).map((n) => `node:${n.type}`))
      if (!types.size) usage(`no node category "${args.category}" (one of ${[...new Set(inputs.nodes.map((n) => n.category))].sort().join(", ")})`)
      types.forEach((t) => wanted.add(t))
    }
    selected = report.features.filter((f) => wanted.has(f.id))
  }
  const shown = { ...report, features: selected }

  if (args.json) {
    process.stdout.write(`${JSON.stringify(shown, null, 2)}\n`)
  } else if (args.all) {
    const extras = [
      `SDK reference: duplicate sections ${inputs.sdkDocs.duplicateSections.join(", ") || "none"}`,
      `MCP tools registered outside backend/src/lib/mcp/tools: ${inputs.mcp.notFoundInSource.join(", ") || "none"}`,
      `MCP registrations no edition serves: ${inputs.mcp.astOnly.join(", ") || "none"}`,
    ]
    process.stdout.write(`${renderAll(shown, extras)}\n`)
  } else {
    const surfaces = args.surfaces as Parameters<typeof renderFeature>[2]
    // Stale exemptions are global and fail --strict whichever feature is shown,
    // so say so here too.
    const stale = report.staleExemptions.length ? `\n\nStale exemptions (fail --strict): ${report.staleExemptions.join("; ")}` : ""
    process.stdout.write(`${selected.map((f) => renderFeature(shown, f, surfaces)).join("\n\n")}${stale}\n`)
  }

  if (!args.strict) return 0
  return strictFails(selected, report.staleExemptions, args.surfaces as Parameters<typeof strictFails>[2]) ? 1 : 0
}

main().then(
  // The route and node modules open a Redis connection on import; exit
  // instead of waiting for it.
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(`check:surfaces: extractor failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`)
    process.exit(2)
  },
)
