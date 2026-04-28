#!/usr/bin/env node
/**
 * Admin-client import lint — paired with tenant-scope lint as part of the
 * cross-tenant IDOR prevention strategy (see backend/scripts/check-tenant-
 * scope.mjs, CLAUDE.md roadmap #2).
 *
 * The backend's `../lib/supabase.ts` exports a Supabase client initialized
 * with the service-role key. It BYPASSES RLS. Any route that imports it
 * therefore has no tenant-isolation backstop — every ownership check must
 * be in-handler. A missed `.eq("user_id", userId)` is an IDOR.
 *
 * This check bans new imports of the admin client from `backend/src/routes/`
 * unless the file is on an explicit allow-list of routes where service-role
 * is genuinely required (admin routes, webhooks, OAuth callbacks, public
 * share-token / gallery paths, app runtime, API token handler).
 *
 * Every current import site is captured in the baseline. Adding a new
 * route that imports the admin client without joining the allow-list or
 * refactoring to a user-scoped client will fail CI. This creates review
 * pressure for the forthcoming request-scoped-client migration (roadmap #4)
 * without requiring it upfront.
 *
 * To add a new allow-listed route: add its path pattern to ALLOWED_PATHS
 * with a justification comment.
 * When refactoring an existing baseline entry off the admin client:
 * re-run with --update-baseline to remove the entry.
 */
import { readFileSync, writeFileSync, existsSync, statSync, readdirSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createHash } from "node:crypto"

const __dirname = fileURLToPath(new URL(".", import.meta.url))
const BACKEND_ROOT = resolve(__dirname, "..")
const ROUTES_DIR = join(BACKEND_ROOT, "src", "routes")
const BASELINE_PATH = join(__dirname, "admin-client-import-baseline.json")

// Matches any import statement pulling from `…/lib/supabase` (with or
// without a `.js` suffix). Named, default, and renamed imports all qualify.
const ADMIN_IMPORT_RE = /^\s*import\b[\s\S]*?from\s+["']([^"']*\/lib\/supabase)(?:\.js)?["']/

// ---------------------------------------------------------------------------
// Allow-list — routes where service-role is genuinely required. Justification
// REQUIRED for every entry. Superset of tenant-scope allow-list: additional
// entries cover routes that DO scope per-query by user_id but are currently
// written against the admin client (legacy — will migrate under roadmap #4).
// ---------------------------------------------------------------------------

const ALLOWED_PATHS = [
  // Admin routes: authorize on req.userRole, legitimately operate across
  // users.
  /^src\/routes\/admin.*\.ts$/,

  // Webhooks: signature- or token-verified, not user-session-authed.
  /^src\/routes\/stripe-webhook\.ts$/,
  /^src\/routes\/social-auth\.ts$/,
  /^src\/routes\/webhook-triggers\.ts$/,
  /^src\/routes\/webhook-output\.ts$/,
  /^src\/routes\/telegram-webhook\.ts$/,

  // Public / share-token / app runtime — cross-user access by design.
  /^src\/routes\/presentation\.ts$/,
  /^src\/routes\/gallery\.ts$/,
  /^src\/routes\/download\.ts$/,
  /^src\/routes\/app-runner\.ts$/,
  /^src\/routes\/component-execute\.ts$/,
  /^src\/routes\/app-analytics\.ts$/,
  /^src\/routes\/published-apps\.ts$/,

  // API tokens: resolved.userId drives scoping internally, distinct from
  // req.userId flow.
  /^src\/routes\/api-tokens\.ts$/,

  // Developer apps CRUD: every read/write scopes by `.eq("owner_user_id",
  // req.userId)` in-handler (audited 2026-04-28). Service-role required
  // for atomic count+insert under the 5-app per-user cap.
  /^src\/routes\/developer-apps\.ts$/,

  // OAuth: /v1/oauth/token is authenticated by client_id+client_secret,
  // not a user JWT — no user context to drive RLS. Token revocation is
  // RFC 7009 (no info leak about whether token existed). Per-call ownership
  // is enforced via bcrypt-verify of the client secret.
  /^src\/routes\/oauth\.ts$/,

  // Embeds / og-tags: fetch public-facing metadata by id, not user-scoped.
  /^src\/routes\/embed\.ts$/,
  /^src\/routes\/og-tags\.ts$/,

  // Tutorials: admin-curated public content.
  /^src\/routes\/tutorials\.ts$/,

  // Test fixtures mock the supabase module.
  /^src\/routes\/__tests__\//,
]

function isAllowed(relPath) {
  return ALLOWED_PATHS.some((re) => re.test(relPath))
}

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

function scan(filePath) {
  const src = readFileSync(filePath, "utf8")
  const lines = src.split("\n")
  const findings = []
  // Multi-line import statements: collect until a closing `"` on the `from` line.
  let buffer = ""
  let bufferStartLine = 0
  let inImport = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!inImport && /^\s*import\b/.test(line)) {
      inImport = true
      buffer = line
      bufferStartLine = i + 1
    } else if (inImport) {
      buffer += "\n" + line
    }
    if (inImport && /from\s+["'][^"']+["']/.test(line)) {
      const m = buffer.match(ADMIN_IMPORT_RE)
      if (m) {
        findings.push({ line: bufferStartLine, importPath: m[1] })
      }
      inImport = false
      buffer = ""
    }
  }
  return findings
}

function hashImport(importPath) {
  return createHash("sha256").update(importPath).digest("hex").slice(0, 12)
}

function loadBaseline() {
  if (!existsSync(BASELINE_PATH)) return { entries: {}, raw: null }
  const raw = JSON.parse(readFileSync(BASELINE_PATH, "utf8"))
  const entries = {}
  for (const e of raw.entries ?? []) {
    entries[`${e.file}|${e.hash}`] = e
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
    const hash = hashImport(f.importPath)
    const key = `${rel}|${hash}`
    currentEntries.push({ file: rel, importPath: f.importPath, hash, line: f.line })
    if (baselineEntries[key]) {
      consumed.add(key)
      continue
    }
    process.stderr.write(
      `\n${rel}:${f.line}  admin-client-import: imports the service-role client from ${f.importPath}\n` +
        `  Routes must either (a) be on ALLOWED_PATHS with a justification, or (b) use a\n` +
        `  request-scoped user client (pending migration under roadmap #4).\n`,
    )
    newFailures++
    newFailureFiles.add(rel)
  }
}

const stale = Object.keys(baselineEntries).filter((k) => !consumed.has(k))

if (updateBaseline) {
  const sorted = currentEntries.sort((a, b) => a.file.localeCompare(b.file))
  writeFileSync(
    BASELINE_PATH,
    JSON.stringify(
      {
        $comment:
          "Generated by backend/scripts/check-admin-client-import.mjs --update-baseline. " +
          "Each entry is an existing route that imports the service-role Supabase client. " +
          "New imports in non-allow-listed routes fail CI; baselined entries are accepted " +
          "legacy and will migrate to a user-scoped client under roadmap #4. Re-run with " +
          "--update-baseline after refactoring a route to remove its entry.",
        generatedAt: new Date().toISOString(),
        entries: sorted.map((e) => ({ file: e.file, hash: e.hash, line: e.line })),
      },
      null,
      2,
    ) + "\n",
  )
  process.stdout.write(
    `✓ admin-client-import baseline updated — ${sorted.length} entries written to ${relative(BACKEND_ROOT, BASELINE_PATH)}\n`,
  )
  process.exit(0)
}

if (newFailures > 0) {
  process.stderr.write(
    `\n✗ admin-client-import lint failed — ${newFailures} NEW import(s) across ${newFailureFiles.size} file(s).\n` +
      `  If the route genuinely requires service-role access, add its path to ALLOWED_PATHS in\n` +
      `  backend/scripts/check-admin-client-import.mjs with a justification. Otherwise, refactor\n` +
      `  to avoid importing the admin client (user-scoped client landing under roadmap #4).\n\n` +
      `Accepted legacy entries (in baseline): ${Object.keys(baselineEntries).length}.\n` +
      `Scanned: ${files.length} route files.\n\n`,
  )
  process.exit(1)
}

if (stale.length > 0) {
  process.stderr.write(
    `\n⚠  baseline has ${stale.length} stale entries (the import they described is no longer\n` +
      `   present — route was refactored). Re-run with --update-baseline to clean up:\n\n`,
  )
  for (const k of stale) {
    const e = baselineEntries[k]
    process.stderr.write(`   ${e.file}:${e.line} (hash ${e.hash})\n`)
  }
  process.stderr.write("\n")
  process.exit(1)
}

process.stdout.write(
  `✓ admin-client-import lint passed (${files.length} route files scanned, ${Object.keys(baselineEntries).length} baselined).\n`,
)
