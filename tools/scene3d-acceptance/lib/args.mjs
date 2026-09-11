/**
 * Argument tables for the six subcommands.
 *
 * The tables are DATA and exported, so the unit tests drive exactly the parser
 * the CLI does. A hand-rolled `process.argv` walk per subcommand is how two
 * surfaces of the same harness start disagreeing about what `--repair-passes`
 * means.
 *
 * `node:util`'s `parseArgs` does the tokenizing (Node 22 — no dependency);
 * everything here is the schema, the coercion and the refusals.
 */
import { parseArgs } from "node:util"

/** Options every subcommand shares. */
export const COMMON_OPTIONS = Object.freeze({
  out: { type: "string", default: "scene3d-receipts", help: "directory receipts are written to" },
  "base-url": { type: "string", help: "overrides $NODARO_BASE_URL" },
  "timeout-min": { type: "string", default: "60", help: "per-job wall-clock cap in minutes" },
  "poll-ms": { type: "string", default: "3000", help: "job status poll interval" },
  label: { type: "string", help: "free-text label recorded in the receipt" },
  "dry-run": { type: "boolean", default: false, help: "print the request bodies and exit; no network, no credits" },
  help: { type: "boolean", default: false, help: "print usage" },
})

const REFERENCE_ROLES = ["appearance", "layout", "motion"]

export const SUBCOMMANDS = Object.freeze({
  authoring: {
    summary: "Pro run from a prompt with references, then a free edit and a render-only re-run",
    options: {
      prompt: { type: "string", help: "the brief (overrides --prompt-file)" },
      "prompt-file": { type: "string", help: "read the brief from a file" },
      ref: { type: "string", multiple: true, default: [], help: "image reference as URL[#appearance|#layout] (repeatable)" },
      "motion-ref": { type: "string", help: "one video reference URL, role motion" },
      "repair-passes": { type: "string", default: "2", help: "correction budget, 0-2" },
      duration: { type: "string", default: "10", help: "seconds" },
      fps: { type: "string", default: "24" },
      aspect: { type: "string", default: "16:9" },
      engine: { type: "string", help: "pro engine override; the deployment's default when omitted" },
      "skip-edit": { type: "boolean", default: false, help: "skip the deterministic 0-credit edit" },
      "skip-render-only": { type: "boolean", default: false, help: "skip the render-only re-run" },
    },
  },
  lifecycle: {
    summary: "one Pro run, phase transitions printed, optional cancel; or --observe an existing job",
    options: {
      prompt: { type: "string" },
      "prompt-file": { type: "string" },
      duration: { type: "string", default: "10" },
      fps: { type: "string", default: "24" },
      aspect: { type: "string", default: "16:9" },
      "repair-passes": { type: "string", default: "2" },
      "cancel-at": { type: "string", help: "a status (pending|queued|processing), an engine phase name, progress:<n>, or <seconds>" },
      observe: { type: "string", help: "attach to an existing job id instead of starting one" },
      grace: { type: "string", default: "90", help: "seconds to keep watching after a terminal state" },
    },
  },
  "table-fixture": {
    summary: "the 30s 21:9 table fixture, rendered and measured frame by frame",
    options: {
      "prompt-file": { type: "string", help: "defaults to fixtures/table-prompt.txt" },
      duration: { type: "string", default: "30" },
      fps: { type: "string", default: "24" },
      aspect: { type: "string", default: "21:9" },
      "repair-passes": { type: "string", default: "2" },
      video: { type: "string", help: "measure this local MP4 instead of rendering one (no credits)" },
      "analysis-width": { type: "string", default: "384", help: "frames are scaled to this width before measurement" },
      "keep-frames": { type: "boolean", default: false, help: "leave the extracted work directory in place" },
      "cut-tolerance": { type: "string", default: "1", help: "frames a cut may land either side of its nominal index" },
      "min-subject-area": { type: "string", default: "0.0015", help: "smallest projected area (frame fraction) that counts as the subject being present" },
      "min-shoulder-foreground": { type: "string", default: "0.02", help: "smallest foreground-band occupancy that counts as a shoulder mass" },
      "window-frame-fraction": { type: "string", default: "0.9", help: "fraction of a window's frames that must satisfy its checks" },
    },
  },
  "blender-cloud-v2": {
    summary: "the MCP-equivalent Basic path: generate → edit → render on engine blender-cloud",
    options: {
      prompt: { type: "string" },
      "prompt-file": { type: "string" },
      "edit-prompt": { type: "string", help: "the instruction the edit step sends" },
      ref: { type: "string", multiple: true, default: [], help: "image reference as URL[#role]" },
      "skip-render": { type: "boolean", default: false, help: "stop after the edit; do not render the revision" },
      duration: { type: "string", default: "4" },
      fps: { type: "string", default: "24" },
      aspect: { type: "string", default: "16:9" },
      "repair-passes": { type: "string", default: "2" },
    },
  },
  "seedance-ab": {
    summary: "the controlled A/B: image reference only vs image + clay video + scoping line",
    options: {
      "image-ref": { type: "string", help: "appearance image URL — REQUIRED; the frozen A/B URLs are in the private acceptance documents, see README" },
      "clay-ref": { type: "string", help: "clay guide video URL — required for arm B" },
      "prompt-file": { type: "string", help: "the common prompt, read from a file (see README)" },
      prompt: { type: "string", help: "the common prompt inline" },
      "scoping-line": { type: "string", help: "the sentence arm B adds; default names what the reference is and is not for" },
      provider: { type: "string", default: "seedance-2-5" },
      duration: { type: "string", default: "4" },
      resolution: { type: "string", default: "480p" },
      aspect: { type: "string", default: "16:9" },
      arm: { type: "string", default: "both", help: "both|a|b" },
      sound: { type: "boolean", default: false, help: "native audio; the frozen A/B is sound off" },
      "image-ref-field": { type: "string", default: "referenceImageUrls", help: "referenceImageUrls (a reference) or imageUrl (a start frame)" },
      "analysis-width": { type: "string", default: "384" },
      "central-fraction": { type: "string", default: "0.25", help: "width of the central column the red measurement reads" },
      "allow-key": { type: "string", multiple: true, default: [], help: "an extra input_data key the arms may differ in (repeatable); recorded in the receipt" },
    },
  },
  benchmark: {
    summary: "N concurrent Pro runs, phase timings and p50/p95 across repeats",
    options: {
      users: { type: "string", default: "1", help: "1, 2 or 4 concurrent runs" },
      repeats: { type: "string", default: "1" },
      fixture: { type: "string", default: "vehicle", help: "table|vehicle" },
      duration: { type: "string", help: "overrides the fixture's duration" },
      fps: { type: "string", default: "24" },
      aspect: { type: "string", help: "overrides the fixture's aspect" },
      "repair-passes": { type: "string", default: "2" },
      "prompt-file": { type: "string", help: "overrides the fixture's brief" },
    },
  },
})

function stripHelp(options) {
  const out = {}
  for (const [key, spec] of Object.entries(options)) {
    const { help: _help, ...rest } = spec
    out[key] = rest
  }
  return out
}

export function optionTable(subcommand) {
  const entry = SUBCOMMANDS[subcommand]
  if (!entry) throw new Error(`unknown subcommand: ${subcommand}`)
  return { ...COMMON_OPTIONS, ...entry.options }
}

export function toInt(value, name, { min, max } = {}) {
  if (value === undefined || value === null || value === "") return undefined
  const n = Number(value)
  if (!Number.isFinite(n) || !Number.isInteger(n)) throw new Error(`--${name} must be an integer, got "${value}"`)
  if (min !== undefined && n < min) throw new Error(`--${name} must be >= ${min}, got ${n}`)
  if (max !== undefined && n > max) throw new Error(`--${name} must be <= ${max}, got ${n}`)
  return n
}

export function toNumber(value, name, { min, max } = {}) {
  if (value === undefined || value === null || value === "") return undefined
  const n = Number(value)
  if (!Number.isFinite(n)) throw new Error(`--${name} must be a number, got "${value}"`)
  if (min !== undefined && n < min) throw new Error(`--${name} must be >= ${min}, got ${n}`)
  if (max !== undefined && n > max) throw new Error(`--${name} must be <= ${max}, got ${n}`)
  return n
}

/**
 * `URL[#role]` → a Scene3D reference.
 *
 * The role is part of the contract (`appearance` | `layout` | `motion`), not a
 * hint, so an unknown one is refused here rather than sent and rejected after
 * the harness has already quoted.
 */
export function parseReference(spec, index, { defaultRole = "appearance", kind = "image" } = {}) {
  const raw = String(spec)
  const hash = raw.lastIndexOf("#")
  const url = hash > 0 ? raw.slice(0, hash) : raw
  const role = hash > 0 ? raw.slice(hash + 1) : defaultRole
  if (!REFERENCE_ROLES.includes(role)) {
    throw new Error(`reference role must be one of ${REFERENCE_ROLES.join(", ")}, got "${role}"`)
  }
  if (!/^https?:\/\//.test(url)) throw new Error(`reference URL must be http(s), got "${url}"`)
  return { id: `ref-${index}`, kind, role, url }
}

/**
 * `--cancel-at` accepts only what the wire can actually be observed to do.
 *
 * There are no planner/build/render sub-phases in a job's status, so offering
 * them would be a control that silently never fires. A number of seconds is
 * the escape hatch for "somewhere inside processing".
 */
export function parseCancelAt(value) {
  if (value === undefined || value === null || value === "") return null
  const text = String(value).trim()
  if (/^(pending|queued|processing|pending_review)$/.test(text)) return { kind: "status", status: text }
  const progress = /^progress:(\d+(?:\.\d+)?)$/.exec(text)
  if (progress) return { kind: "progress", progress: Number(progress[1]) }
  const seconds = /^(\d+(?:\.\d+)?)s?$/.exec(text)
  if (seconds) return { kind: "seconds", seconds: Number(seconds[1]) }
  // Any other identifier is an ENGINE PHASE. It is accepted rather than
  // refused because the phase vocabulary belongs to the deployed engine, not
  // to this harness — but a trigger that never fires is recorded as a FAILED
  // assertion by the lifecycle probe, so a misspelling cannot quietly become
  // "the run completed normally".
  if (/^[a-z][a-z0-9_-]{1,40}$/i.test(text)) return { kind: "phase", name: text }
  throw new Error(`--cancel-at must be a status, an engine phase name, progress:<n> or <seconds>, got "${value}"`)
}

/** The top-level listing, printed with no subcommand or an unknown one. */
export function topUsage() {
  const lines = ["scene3d-acceptance <subcommand> [options]", "", "Subcommands:"]
  for (const [name, entry] of Object.entries(SUBCOMMANDS)) lines.push(`  ${name.padEnd(17)}${entry.summary}`)
  lines.push("", "`<subcommand> --help` prints that subcommand's options.")
  lines.push("Auth comes from $NODARO_API_KEY and $NODARO_BASE_URL. Neither is ever written to a receipt.")
  return lines.join("\n")
}

export function usage(subcommand) {
  const entry = SUBCOMMANDS[subcommand]
  const lines = [`scene3d-acceptance ${subcommand} — ${entry.summary}`, "", "Options:"]
  for (const [key, spec] of Object.entries({ ...entry.options, ...COMMON_OPTIONS })) {
    const type = spec.type === "boolean" ? "" : " <value>"
    const dflt = spec.default !== undefined && spec.default !== false ? ` (default: ${JSON.stringify(spec.default)})` : ""
    lines.push(`  --${key}${type}${dflt}${spec.help ? ` — ${spec.help}` : ""}`)
  }
  lines.push("", "Auth comes from $NODARO_API_KEY and $NODARO_BASE_URL. Neither is ever written to a receipt.")
  return lines.join("\n")
}

/**
 * Parse, coerce and normalise one subcommand's arguments.
 *
 * Returns the raw `values` alongside the normalised fields so a receipt can
 * record both what was typed and what it was understood to mean.
 */
export function parseSubcommandArgs(subcommand, argv) {
  const options = stripHelp(optionTable(subcommand))
  const { values, positionals } = parseArgs({ args: argv, options, allowPositionals: true, strict: true })
  const common = {
    out: values.out ?? "scene3d-receipts",
    baseUrl: values["base-url"],
    timeoutMs: (toNumber(values["timeout-min"], "timeout-min", { min: 1, max: 720 }) ?? 60) * 60_000,
    pollMs: toInt(values["poll-ms"], "poll-ms", { min: 250, max: 60_000 }) ?? 3000,
    label: values.label ?? null,
    dryRun: values["dry-run"] === true,
    help: values.help === true,
  }
  return { subcommand, values, positionals, ...common }
}
