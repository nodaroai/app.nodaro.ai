#!/usr/bin/env node
/**
 * Tenant-scope lint — catches cross-tenant IDOR regressions before merge.
 *
 * The backend uses a global Supabase service-role client (bypasses RLS), so
 * every user-facing route that reads/updates/deletes a tenant-owned row by
 * id MUST also scope the query by `.eq("user_id", userId)`. This script
 * walks backend/src/routes/ and fails when it finds an unscoped chain.
 *
 * Why a custom script rather than Semgrep:
 *   Semgrep's `pattern-not` on TypeScript method chains matches at the AST
 *   node level. For `.eq("id", X).eq("user_id", Y).select().single()`, the
 *   unscoped `.eq("id", X)` is a *sub-node* of the scoped chain, so no
 *   combination of pattern/pattern-not reliably distinguishes the two
 *   (verified empirically — tests with pattern-not, pattern-not-regex, and
 *   exhaustive method-chain enumerations all flagged both as unscoped).
 *   Multi-line text analysis sidesteps the tree-matching limitation.
 *
 * Three classes flagged:
 *   supabase.from("<tenant>").select(...).eq("id", X).single()   — read IDOR
 *   supabase.from("<tenant>").update(...).eq("id", X)            — takeover
 *   supabase.from("<tenant>").delete(...).eq("id", X)            — delete IDOR
 *
 * To add a new tenant-owned table: append to TENANT_TABLES.
 * To exempt a route with a legitimate cross-user pattern (admin, OAuth
 * callback, public share-token, etc.): add it to ALLOWED_PATHS with a
 * justification comment. Prefer tightening the route over widening the list.
 *
 * Per-line exemptions: suffix the `.from("<tenant>")` line with
 *   // tenant-scope-ignore: <reason>
 * when the handler verifies ownership post-fetch (e.g., reads user_id then
 * checks `row.user_id === req.userId`).
 */
import { readFileSync, writeFileSync, existsSync, statSync, readdirSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createHash } from "node:crypto"

const __dirname = fileURLToPath(new URL(".", import.meta.url))
const BACKEND_ROOT = resolve(__dirname, "..")
const ROUTES_DIR = join(BACKEND_ROOT, "src", "routes")
const BASELINE_PATH = join(__dirname, "tenant-scope-baseline.json")

// ---------------------------------------------------------------------------
// Tenant-owned tables — rows belong to a single user_id, accessible only by
// that user or admins. Adding a new tenant table is a conscious decision.
// ---------------------------------------------------------------------------

const TENANT_TABLES = new Set([
  "characters",
  "objects",
  "locations",
  "faces",
  "voice_clones",
  "workflows",
  "projects",
  "jobs",
  "usage_logs",
  "app_runs",
  "workflow_executions",
  "workflow_triggers",
  "social_connections",
  "credit_transactions",
  "credit_anomalies",
  "subscriptions",
  "stripe_customers",
  "api_tokens",
  "assets",
  "published_apps",
  "folders",
])

// ---------------------------------------------------------------------------
// Allowed paths — routes where the id-only lookup is intentional.
// Justification REQUIRED for every entry.
// ---------------------------------------------------------------------------

const ALLOWED_PATHS = [
  // Admin routes authorize on req.userRole === "admin"; ownership scoping
  // doesn't apply.
  /^src\/routes\/admin.*\.ts$/,

  // Stripe webhook: signature-verified, operates on stripe_customers /
  // subscriptions / transactions linked via stripe_*_id, not user_id.
  /^src\/routes\/stripe-webhook\.ts$/,

  // Social OAuth callback: CSRF-state-authed, owns the social_connections
  // row it creates before the session has a stable user context.
  /^src\/routes\/social-auth\.ts$/,

  // Public webhook runner: token IS the auth. Execution runs on behalf of
  // the workflow owner regardless of caller identity (that's the feature).
  /^src\/routes\/webhook-triggers\.ts$/,
  /^src\/routes\/webhook-output\.ts$/,

  // Presentation "viewer pays": share_token auths the run. Viewer runs
  // owner's workflow — scoping to viewer would break the feature.
  /^src\/routes\/presentation\.ts$/,

  // Public gallery / download proxy — no tenant scope by design.
  /^src\/routes\/gallery\.ts$/,
  /^src\/routes\/download\.ts$/,

  // App runtime: runner runs creator's app. Scoping is handled by app
  // eligibility + monetization layer, not per-query user_id.
  /^src\/routes\/app-runner\.ts$/,
  /^src\/routes\/component-execute\.ts$/,
  /^src\/routes\/app-analytics\.ts$/,
  /^src\/routes\/published-apps\.ts$/,

  // API tokens: scoped via resolved.userId internally, not req.userId. Has
  // its own scoping logic; audited.
  /^src\/routes\/api-tokens\.ts$/,

  // Test fixtures mock supabase.
  /^src\/routes\/__tests__\//,
]

const IGNORE_COMMENT = /\/\/\s*tenant-scope-ignore(:|$)/

// ---------------------------------------------------------------------------
// Scan
// ---------------------------------------------------------------------------

function walkTs(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) {
      walkTs(full, out)
    } else if (name.endsWith(".ts")) {
      out.push(full)
    }
  }
  return out
}

function isAllowed(relPath) {
  return ALLOWED_PATHS.some((re) => re.test(relPath))
}

/**
 * Count unbalanced parens in a line, ignoring parens inside strings and
 * single-line comments. Simple two-char-lookahead tokenizer — handles
 * double-quote, single-quote, and backtick strings (with escape sequences)
 * and `//` line comments. Block comments aren't handled because none of
 * the Supabase chain arguments use them.
 */
function parenDelta(line) {
  let depth = 0
  let str = null
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (str) {
      if (c === "\\") { i++; continue }
      if (c === str) str = null
      continue
    }
    if (c === '"' || c === "'" || c === "`") { str = c; continue }
    if (c === "/" && line[i + 1] === "/") break
    if (c === "(") depth++
    else if (c === ")") depth--
  }
  return depth
}

/**
 * Collect a chained-call block starting at `startIdx`. A chain continues:
 *  - while we're inside an open function-call argument list (paren depth > 0),
 *    regardless of what the line looks like; or
 *  - at depth 0, while the next line (after whitespace) starts with `.`, or
 *    is blank / comment-only.
 *
 * Tracks paren depth so multi-line `.update({...}).eq("id", $)` chains are
 * captured correctly — without this, the collector stops at the first line
 * inside the `.update()` object literal and misses the subsequent `.eq()`.
 *
 * Text-level heuristic rather than AST: matches the codebase's consistent
 * chain-per-line formatting and sidesteps Semgrep's AST-node matching
 * limitation on nested method calls.
 */
function collectChain(lines, startIdx) {
  const chain = [lines[startIdx]]
  let depth = parenDelta(lines[startIdx])

  for (let j = startIdx + 1; j < lines.length; j++) {
    if (depth > 0) {
      chain.push(lines[j])
      depth += parenDelta(lines[j])
      continue
    }
    const trimmed = lines[j].trim()
    if (trimmed === "" || trimmed.startsWith("//")) {
      chain.push(lines[j])
      continue
    }
    if (trimmed.startsWith(".")) {
      chain.push(lines[j])
      depth += parenDelta(lines[j])
      continue
    }
    break
  }
  return chain.join("\n")
}

function scan(filePath) {
  const src = readFileSync(filePath, "utf8")
  const lines = src.split("\n")
  const findings = []

  const fromRe = /\.from\(\s*["']([a-z_][a-z0-9_]*)["']\s*\)/
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(fromRe)
    if (!match) continue
    const table = match[1]
    if (!TENANT_TABLES.has(table)) continue

    // Honor ignore comment on the .from(...) line OR the line directly above
    // (common for single-line chains where the whole call fits on one line).
    if (IGNORE_COMMENT.test(lines[i])) continue
    if (i > 0 && IGNORE_COMMENT.test(lines[i - 1])) continue

    const block = collectChain(lines, i)

    // Is there an id-keyed eq? (literal "id" or 'id')
    if (!/\.eq\s*\(\s*["']id["']/.test(block)) continue

    // Is this a protected operation — update, delete, or single-row read?
    const isProtected =
      /\.update\s*\(/.test(block) ||
      /\.delete\s*\(/.test(block) ||
      /\.single\s*\(\s*\)/.test(block) ||
      /\.maybeSingle\s*\(\s*\)/.test(block)
    if (!isProtected) continue

    // Does the chain also scope by user_id?
    if (/\.eq\s*\(\s*["']user_id["']/.test(block)) continue

    findings.push({ line: i + 1, table, block })
  }
  return findings
}

// ---------------------------------------------------------------------------
// Baseline handling
// ---------------------------------------------------------------------------

/**
 * Hash the chain block content so baseline entries survive line-number
 * shifts (new imports, reformatting) but invalidate when the actual chain
 * changes — which is exactly when we want the lint to re-evaluate.
 */
function blockHash(block) {
  // Normalize whitespace so trivial reformatting doesn't break the hash.
  const normalized = block.replace(/\s+/g, " ").trim()
  return createHash("sha256").update(normalized).digest("hex").slice(0, 12)
}

function loadBaseline() {
  if (!existsSync(BASELINE_PATH)) return { entries: {}, raw: null }
  const raw = JSON.parse(readFileSync(BASELINE_PATH, "utf8"))
  const entries = {}
  for (const e of raw.entries ?? []) {
    entries[`${e.file}|${e.table}|${e.hash}`] = e
  }
  return { entries, raw }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const updateBaseline = process.argv.includes("--update-baseline")
const files = walkTs(ROUTES_DIR).sort()
const { entries: baselineEntries } = loadBaseline()
const consumed = new Set()

let newFailures = 0
const newFailureFiles = new Set()
const currentEntries = []

for (const file of files) {
  const rel = relative(BACKEND_ROOT, file)
  if (isAllowed(rel)) continue
  const findings = scan(file)
  for (const f of findings) {
    const hash = blockHash(f.block)
    const key = `${rel}|${f.table}|${hash}`
    currentEntries.push({ file: rel, table: f.table, hash, line: f.line })

    if (baselineEntries[key]) {
      consumed.add(key)
      continue
    }

    const preview = f.block.split("\n").slice(0, 8).join("\n").replace(/^/gm, "    ")
    process.stderr.write(
      `\n${rel}:${f.line}  tenant-scope: unscoped .eq("id", ...) on ${f.table}\n${preview}\n`,
    )
    newFailures++
    newFailureFiles.add(rel)
  }
}

const stale = Object.keys(baselineEntries).filter((k) => !consumed.has(k))

if (updateBaseline) {
  const sorted = currentEntries.sort((a, b) =>
    a.file === b.file ? a.hash.localeCompare(b.hash) : a.file.localeCompare(b.file),
  )
  writeFileSync(
    BASELINE_PATH,
    JSON.stringify(
      {
        $comment:
          "Generated by backend/scripts/check-tenant-scope.mjs --update-baseline. " +
          "Each entry is an existing unscoped .eq(\"id\", ...) chain that's been " +
          "verified safe (prior ownership check, server-generated id, etc.). " +
          "When the underlying chain is fixed or annotated, re-run with " +
          "--update-baseline to remove the entry.",
        generatedAt: new Date().toISOString(),
        entries: sorted.map((e) => ({ file: e.file, table: e.table, hash: e.hash, line: e.line })),
      },
      null,
      2,
    ) + "\n",
  )
  process.stdout.write(
    `✓ baseline updated — ${sorted.length} entries written to ${relative(BACKEND_ROOT, BASELINE_PATH)}\n`,
  )
  process.exit(0)
}

if (newFailures > 0) {
  process.stderr.write(
    `\n✗ tenant-scope lint failed — ${newFailures} NEW unscoped id lookup(s) across ${newFailureFiles.size} file(s).\n` +
      `  Add .eq("user_id", userId) to the chain, or suffix the .from() line with\n` +
      `  // tenant-scope-ignore: <reason>  when ownership is verified post-fetch.\n` +
      `  New routes needing cross-user access: add to ALLOWED_PATHS in\n` +
      `  backend/scripts/check-tenant-scope.mjs with a justification.\n\n` +
      `Accepted legacy entries (in baseline): ${Object.keys(baselineEntries).length}.\n` +
      `Scanned: ${files.length} route files. Tenant tables: ${TENANT_TABLES.size}.\n\n`,
  )
  process.exit(1)
}

if (stale.length > 0) {
  process.stderr.write(
    `\n⚠  baseline has ${stale.length} stale entries (the chains they described are no longer\n` +
      `   present — either fixed or refactored). Re-run with --update-baseline to clean up:\n\n`,
  )
  for (const k of stale) {
    const e = baselineEntries[k]
    process.stderr.write(`   ${e.file}:${e.line} ${e.table} (hash ${e.hash})\n`)
  }
  process.stderr.write("\n")
  process.exit(1)
}

process.stdout.write(
  `✓ tenant-scope lint passed (${files.length} files scanned, ${TENANT_TABLES.size} tenant tables guarded, ${Object.keys(baselineEntries).length} baselined).\n`,
)
