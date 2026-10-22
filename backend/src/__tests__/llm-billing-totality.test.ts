// @test-watches backend/src/**
/**
 * LLM BILLING TOTALITY (B11; R3).
 *
 * Every LLM call a user can cause is billed by what it actually cost (D1), or
 * is deliberately not billed on its own, for a written reason. A new call site
 * that reaches the LLM client without metering is a free, uncapped LLM proxy:
 * this guard fails the build for it until it decides which it is.
 *
 * The scan is static, over every shipped .ts file in backend/src, parsed with
 * the TypeScript compiler (comments and types are not code, so a name in
 * either never counts):
 *
 *  1. Every value binding is RESOLVED to its final (module, name) — through
 *     `export { x } from`, `export *`, import-then-export — before anything is
 *     decided about it, in the identifier and the namespace (`ns.x`) branch
 *     alike. A call through a barrel is the call it re-exports.
 *  2. An LLM CALL SITE is a use of anything the client exports (lib/llm/**,
 *     lib/llm-client.ts, lib/gemini/**, lib/structured-llm.ts,
 *     lib/anthropic.ts) — FAIL CLOSED: every value is an entry point except
 *     the reasoned PURE_CLIENT_HELPERS (key checks, cost arithmetic, error
 *     classes, constants) — and any value use of a raw LLM SDK package
 *     (`@anthropic-ai/sdk`, `openai`, `@google/genai*`). Importing a package
 *     for its types only is not a use, and neither is reading one of its
 *     error classes (`Anthropic.APIError` in an instanceof check).
 *  3. REACH is followed symbol by symbol: a top-level function/const reaches
 *     the LLM when its body is a call site or uses a symbol that reaches. A
 *     CALLER of a file is a file that uses one of its reaching symbols — so a
 *     module that imports only a wrapper's model id is not its caller.
 *  4. FLAGGED: a file outside the client with a call site of its own, or that
 *     builds an LLM credit id (`buildLlmCreditIdentifier`,
 *     `resolveLlmCreditId`, `meterSyncLlm`).
 *  5. SATISFIED: a flagged file
 *       - METERS: it calls a reserve — `reserveLlmCall`,
 *         `meterSyncLlmMetered`, `meterOptionalSyncLlm`,
 *         `reserveFixedPlusLlmCalls` or `workerLlmBilling`. An `LlmSpend`
 *         alone is not metering: it records calls for a hold someone else
 *         must take, so a file that only carries one is judged by its callers;
 *       - or sits in EXEMPT with the reason it is not billed on its own, the
 *         call it covers (its own, or one named wrapper), how many such call
 *         sites it has, and which files may call it — so a second call in an
 *         exempt route, or a new caller of an exempt wrapper, fails;
 *       - or is a WRAPPER WHOSE CALLERS METER: it has at least one caller and
 *         EVERY caller is itself satisfied by these same rules — transitively,
 *         so a new unmetered caller of a wrapper, or of a wrapper's wrapper,
 *         fails with the path that names it.
 *     A credit-id builder that makes no call (a price table, a quote, a DAG
 *     reservation id) is satisfied when its tier id is only the ROLLBACK
 *     branch: it dispatches on `llmMeteredPricing()` (D6).
 *
 * EXEMPT never names a file the metering tasks own (8–11: the metered routes,
 * workers and their libs). A failure there is a bug to fix in that file.
 *
 * EXEMPT CHAINS: an exempt file's LLM call is unbilled for every file above
 * it, so the whole upward chain is pinned — each hop's callers (the entry's
 * own `callers`, then CHAIN_PINS for every file above it) up to an ENTRY
 * POINT (a top-level backend/src file, a script, lib/private-plugins/
 * worker-app.ts). A new caller anywhere on the chain fails. In the metering
 * walk an entry point may meter (or be exempt for) its OWN call, but it never
 * satisfies anything as a caller: a wrapper an unmetered, unexempted script
 * calls fails, even when every product caller meters.
 *
 * KNOWN ESCAPES (left open knowingly; a static name scan cannot follow them):
 *  - a function fetched from a runtime registry or object by a computed
 *    string key (`registry[name]()`); a value stored in a literal is a use
 *    (`{ f: wrapper }` names `wrapper`) and is caught;
 *  - a dynamic `import()` whose specifier is not a string literal, or
 *    `require` / `createRequire`;
 *  - a dynamic import of a NON-client module counts every export of it as
 *    used (an over-approximation, not an escape); a promise held in one
 *    declaration and awaited in another is followed only when both are
 *    top-level symbols of the same file;
 *  - `export * from "<package>"` is followed only for a raw SDK package — a
 *    name another package re-exports is not looked up in that package;
 *  - a function named like a reserve (`reserveLlmCall`) defined locally would
 *    count as metering; an unmetered branch next to a metered one in the same
 *    file passes (metering is checked per file, not per branch);
 *  - pins are per caller FILE: a pinned caller that adds a second call into
 *    the chain, or a file already on the chain that starts calling another
 *    file on it through a pinned edge, passes (an EXEMPT entry's own `sites`
 *    count is the per-call pin, for its own hop only);
 *  - an entry point itself may call anything (the walk stops there);
 *  - a raw HTTP request to a provider endpoint that bypasses both the client
 *    and the SDKs.
 *
 * Caught, for the record: `class X extends <SdkClass>` (the heritage clause's
 * expression is a value use of the SDK import), destructuring or indexing a
 * client namespace (a bare namespace uses every export), barrels of every
 * shape, and package-star precedence (a local star is tried before any
 * package star).
 */
import { readFileSync } from "node:fs"
import { dirname, join, normalize } from "node:path"
import ts from "typescript"
import { describe, expect, it } from "vitest"
import { SCAN_TIMEOUT_MS, SRC, lineOf, parseText, relPath } from "../lib/__tests__/source-ast.js"
import { sourceFiles } from "../lib/__tests__/source-scan.js"

/** Flipped by Task 19, when the tier ids are gone and only the price table builds a credit id. */
const TIERS_REMOVED = false

// ── the vocabulary ───────────────────────────────────────────────────────────

/** The LLM client itself: the lanes, the router, structured output, the raw SDK handles. */
function isClient(file: string): boolean {
  return (
    file === "lib/llm-client.ts" ||
    file.startsWith("lib/llm/") ||
    file.startsWith("lib/gemini/") ||
    file === "lib/structured-llm.ts" || // callStructuredLlm — a raw Anthropic SDK entry point
    file === "lib/anthropic.ts" // getAnthropicClient — the raw Anthropic SDK handle
  )
}

/** A raw LLM SDK package: a value use of one outside the client is an LLM call no lane or meter sees. */
const RAW_SDK_PACKAGE = /^pkg:(?:@anthropic-ai\/sdk|openai|@google\/genai)(?:\/|$)/
/** `Sdk.APIError` / `Sdk.APIConnectionError` — an SDK's error classes, read for instanceof checks, make no call. */
const SDK_ERROR_MEMBER = /^[A-Za-z]*Error$/

/**
 * Client exports that make no LLM call — every OTHER value the client exports
 * is an entry point (fail closed). Each was checked against its importers.
 */
const PURE_CLIENT_HELPERS: ReadonlyMap<string, string> = new Map([
  ["kieKeySet", "is a KIE key configured (copilot, pipelines)"],
  ["claudeLaneConfigured", "is a Claude lane configured (routes' availability pre-checks)"],
  ["pickClaudeLane", "which Claude lane would serve — a choice, not a call (copilot, pipelines)"],
  ["localLlmKeySet", "is any local LLM key configured (cloud proxy, entity worker)"],
  ["anthropicKeySet", "is the Anthropic key configured"],
  ["geminiKeySet", "is the Gemini key configured"],
  ["anthropicDirectUsable", "may the direct Anthropic lane be used (advanced-mode validation)"],
  ["claudeMustServeDirect", "must this Claude request go direct — a routing predicate (llm-cost)"],
  ["structuredJsonSchema", "Zod → JSON schema conversion"],
  ["StructuredLlmError", "the structured failure's error class (instanceof checks)"],
  ["isLlmProviderUnavailable", "an error classifier"],
  ["kieCostUsd", "KIE cost arithmetic"],
  ["kieFailureCostUsd", "KIE cost arithmetic"],
  ["kieInputTokens", "KIE usage arithmetic"],
  ["kieCreditsUsdOf", "KIE cost arithmetic"],
  ["kieInputUntrusted", "KIE usage trust predicate"],
  ["requestChars", "request size arithmetic (the D2 estimate)"],
  ["KIE_IMAGE_ESTIMATE_CHARS", "a constant"],
  ["anthropicStructuredTool", "builds the Anthropic tool block for a structured request — no call"],
  ["inlineImagesForClaudeKie", "rewrites a request's image blocks for the Claude KIE lane — no LLM call"],
])
/** `LLM_*` constants (lane counts, attempt counts) are pure too. */
const PURE_CLIENT_CONSTANT = /^LLM_[A-Z0-9_]+$/
const isPureClientHelper = (name: string) => PURE_CLIENT_HELPERS.has(name) || PURE_CLIENT_CONSTANT.test(name)

const CREDIT_ID_NAMES = new Set(["buildLlmCreditIdentifier", "resolveLlmCreditId", "meterSyncLlm"])
const METER_CALLS = new Set(["reserveLlmCall", "meterSyncLlmMetered", "meterOptionalSyncLlm", "reserveFixedPlusLlmCalls", "workerLlmBilling"])
const METERED_PRICE_DISPATCH = "llmMeteredPricing"

/** The meter itself — it holds the reserve/settle the calls above reach. */
const METER: ReadonlyMap<string, string> = new Map([
  ["lib/llm-billing.ts", "the metered reserve/settle (reserveLlmCall, meterSyncLlmMetered); under the rollback it hands off to meterSyncLlm, the tier meter, byte-identical (D6)"],
])

const DIRECT = "<its own call>"

/** Entry points: a top-level backend/src file (server, worker, app, the other process entries), a script, the plugin worker app. */
function isEntryPoint(file: string): boolean {
  return !file.includes("/") || file.startsWith("scripts/") || file.startsWith("ee/scripts/") || file === "lib/private-plugins/worker-app.ts"
}
const FIXED_MEDIA_PRICE =
  "D3: an LLM step inside a FIXED media price (a prompt rewrite / translation / facet extraction before a media generation) — the media price covers it; it is never metered on its own"
const ROUTE_REGISTRATION = ["app.ts"]

interface Exemption {
  why: string
  /** The call it covers: the file's own (`DIRECT`) or its calls into this one wrapper. */
  via: string
  /** How many such call sites the file has — a second one fails until it is reasoned. */
  sites: number
  /** Every file allowed to call it (a trailing `/` admits a subtree). A new caller fails. */
  callers: readonly string[]
}

/** Not billed on their own — each with WHY, what it covers, how many sites, and who may call it. */
const EXEMPT: ReadonlyMap<string, Exemption> = new Map<string, Exemption>([
  // D3 — LLM steps embedded in fixed media prices.
  ["routes/image-to-image.ts", { why: `${FIXED_MEDIA_PRICE} (:193)`, via: DIRECT, sites: 1, callers: ROUTE_REGISTRATION }],
  ["routes/generate-character-asset.ts", { why: `${FIXED_MEDIA_PRICE} (:388)`, via: DIRECT, sites: 1, callers: ROUTE_REGISTRATION }],
  ["routes/generate-creature-asset.ts", { why: `${FIXED_MEDIA_PRICE} (:208)`, via: DIRECT, sites: 1, callers: ROUTE_REGISTRATION }],
  ["routes/generate-object-asset.ts", { why: `${FIXED_MEDIA_PRICE} (:183)`, via: DIRECT, sites: 1, callers: ROUTE_REGISTRATION }],
  ["routes/generate-character-motion.ts", { why: `${FIXED_MEDIA_PRICE} (:205)`, via: DIRECT, sites: 1, callers: ROUTE_REGISTRATION }],
  ["routes/generate-character.ts", { why: `${FIXED_MEDIA_PRICE} (resolveFacetInjections)`, via: "lib/character-facet-extract.ts", sites: 1, callers: ROUTE_REGISTRATION }],
  ["providers/replicate/image.ts", { why: `${FIXED_MEDIA_PRICE} (translateToEnglish, :205)`, via: "lib/translate.ts", sites: 1, callers: ["providers/replicate/index.ts"] }],
  ["workers/handlers/video-ai.ts", { why: `${FIXED_MEDIA_PRICE} (rewriteForContentPolicy, :683)`, via: "lib/content-policy-rewrite.ts", sites: 1, callers: ["workers/video-worker.ts"] }],
  // A fixed-price product (controller ruling, Task 16 fix round 1).
  ["ee/video-director/author.ts", { why: "its LLM step is inside the fixed video-director product price (routes/video-director.ts) — same posture as D3 fixed media prices / D9 pipelines", via: DIRECT, sites: 1, callers: ["ee/video-director/orchestrate.ts"] }],
  // Admin-only, platform-paid.
  ["ee/lib/gallery-word-suggestions.ts", { why: "admin gallery moderation — a platform cost; no user is charged", via: DIRECT, sites: 1, callers: ["ee/lib/gallery-word-import.ts", "ee/routes/admin-gallery-moderation.ts"] }],
  // D9 (owner decision): pipeline products are priced as a whole.
  ["ee/pipelines/llms/call-llm.ts", { why: "D9: pipeline products are priced as a whole — their LLM calls are inside the product price", via: DIRECT, sites: 2, callers: ["ee/pipelines/"] }],
  // Plugins.
  ["lib/private-plugins/toolkit.ts", { why: "plugins are handed llmCompleteStructured by toolkit and bill through toolkit.llmBilling by convention — not enforced here", via: DIRECT, sites: 2, callers: ["lib/private-plugins/load.ts", "plugin-daemons.ts"] }],
  ["lib/private-plugins/llm-metered.ts", { why: "plugins are handed llmCompleteStructured by toolkit and bill through toolkit.llmBilling by convention — not enforced here", via: DIRECT, sites: 1, callers: ["lib/private-plugins/toolkit.ts"] }],
])

/**
 * The rest of every exempt chain: who may call each file above an exempt one,
 * up to an entry point. A key ending in `/` covers a subtree, whose files may
 * also call each other. A file on a chain with no pin fails.
 */
const CHAIN_PINS: ReadonlyMap<string, readonly string[]> = new Map<string, readonly string[]>([
  // video-director: author → orchestrate → the worker → its process entries
  ["ee/video-director/orchestrate.ts", ["workers/video-director-worker.ts"]],
  ["workers/video-director-worker.ts", ["server.ts", "video-director.ts"]],
  // gallery moderation (admin)
  ["ee/lib/gallery-word-import.ts", ["ee/routes/admin-gallery-moderation.ts"]],
  ["ee/routes/admin-gallery-moderation.ts", ["app.ts"]],
  // D3: the Replicate image provider and the video worker
  ["providers/replicate/index.ts", ["providers/index.ts"]],
  ["providers/index.ts", ["server.ts", "workers/video-worker.ts"]],
  ["workers/video-worker.ts", ["worker.ts"]],
  // D9 pipelines: the product's own surfaces
  ["ee/pipelines/", ["ee/workers/pipeline-worker.ts", "routes/pipelines.ts", "routes/scene-helpers.ts", "lib/mcp/tools/pipelines.ts", "scripts/probe-script-critic.ts"]],
  ["ee/workers/pipeline-worker.ts", ["pipeline-worker.ts", "server.ts"]],
  ["routes/pipelines.ts", ["app.ts"]],
  ["routes/scene-helpers.ts", ["app.ts"]],
  ["lib/mcp/tools/pipelines.ts", ["lib/mcp/server.ts"]],
  ["lib/mcp/server.ts", ["routes/mcp.ts", "ee/copilot/turn-runner.ts"]],
  ["routes/mcp.ts", ["app.ts"]],
  // plugins: the loader and the daemons
  ["lib/private-plugins/load.ts", ["app.ts", "ee/workers/pipeline-worker.ts", "plugin-daemons.ts", "scripts/probe-script-critic.ts", "workers/video-worker.ts"]],
  // D4 copilot: only its route enters it
  ["ee/copilot/", ["ee/routes/copilot.ts"]],
  ["ee/routes/copilot.ts", ["app.ts"]],
])

/** Whole subtrees, each with WHY. Any call in them, direct or through a wrapper. */
const EXEMPT_DIRS: ReadonlyMap<string, string> = new Map([
  ["ee/copilot/", "D4: Workflow Copilot meters its own turns under its own ceilings"],
])

/**
 * Unmetered today, and NOT exempt: each is an open finding with an owner (empty:
 * every LLM call site is metered or exempt). The
 * guard is red without this list — it is here so the finding is named in code
 * rather than lost, and every entry FAILS as stale the moment its file is
 * fixed. Deleting an entry (or the list) makes the guard fail on that file.
 */
const PENDING: ReadonlyMap<string, string> = new Map([])

/** Files Tasks 8–11 own (phase-b-rules.md): the metered routes, workers and their libs. */
const METERING_TASK_FILES: ReadonlySet<string> = new Set([
  // Task 8 — text
  "routes/llm-chat.ts", "routes/ai-writer.ts", "routes/prompt-helper.ts",
  // Task 9 — structured
  "routes/llm-structured.ts", "routes/llm-structured-jobs.ts", "lib/llm-structured-request.ts",
  "routes/describe-to-picker.ts", "routes/text-to-picker.ts",
  // Task 10 — creative helpers
  ...[
    "scene-graph-ai", "after-effects-ai", "lottie-overlay-ai", "three-d-title-ai", "qa-check", "image-critic",
    "image-to-text", "image-overlay-placement", "reduce", "meta-ads-scrape", "instagram-scrape",
    "llm-suggest-description", "creature-llm-caption", "location-llm-caption", "object-llm-caption",
    "character-portrait-approval", "creature-main-image-approval", "location-main-image-approval",
    "object-main-image-approval",
  ].map((r) => `routes/${r}.ts`),
  "lib/creature-caption.ts", "lib/location-caption.ts", "lib/object-caption.ts", "lib/image-describe.ts",
  "lib/meter-sync-llm.ts", "services/reduce-strategies/pick-best-llm.ts",
  // Task 11 — DAG
  "services/workflow-engine/node-executor.ts", "services/workflow-engine/payload-builder.ts",
  "workers/orchestrator-worker.ts", "workers/shared.ts", "workers/handlers/llm-structured.ts",
  "workers/handlers/entity.ts", "workers/handlers/scene3d.ts", "workers/handlers/motion-graphics-lottie.ts",
  "routes/generate-script.ts", "routes/3d-scene.ts", "routes/motion-graphics-ai.ts",
  "services/scene3d/scene3d-authoring.ts", "providers/script/script-generator.ts", "ee/billing/credits.ts",
])

// ── the model: modules, top-level symbols, their uses ───────────────────────

/** An imported or re-exported value binding: the module (`pkg:<specifier>` for a package) and the name ("*" = the namespace). */
interface Binding { target: string; name: string }

/** One value use in a symbol's body, before resolution: a local/imported name, `ns.member`, or `import("…")`. */
type Use =
  | { kind: "name"; local: string; line: number }
  | { kind: "member"; ns: string; member: string; line: number }
  | { kind: "dynamic"; target: string; line: number }

interface Sym { name: string; uses: Use[] }

interface Mod {
  file: string
  imports: Map<string, Binding>
  syms: Map<string, Sym>
  exports: Map<string, { local?: string; from?: Binding }>
  stars: string[]
  /** Every callee name in the file (`f(` / `x.f(` / `new F(`). */
  called: Set<string>
}

function resolveSpec(fromFile: string, spec: string, known: ReadonlySet<string>): string {
  if (!spec.startsWith(".")) return `pkg:${spec}`
  const stem = normalize(join(dirname(fromFile), spec)).split("\\").join("/").replace(/\.(?:js|ts)$/, "")
  for (const cand of [`${stem}.ts`, `${stem}/index.ts`]) if (known.has(cand)) return cand
  return `missing:${stem}`
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === kind)
}

function bindingNames(name: ts.BindingName, out: string[] = []): string[] {
  if (ts.isIdentifier(name)) out.push(name.text)
  else for (const el of name.elements) if (!ts.isOmittedExpression(el)) bindingNames(el.name, out)
  return out
}

function parseModule(file: string, text: string, known: ReadonlySet<string>): Mod {
  const sf = parseText(file, text)
  const mod: Mod = { file, imports: new Map(), syms: new Map(), exports: new Map(), stars: [], called: new Set() }

  // Pass 1 — value imports (the walker needs to know which names are namespaces).
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue
    const clause = st.importClause
    if (!clause || clause.isTypeOnly) continue
    const target = resolveSpec(file, st.moduleSpecifier.text, known)
    if (clause.name) mod.imports.set(clause.name.text, { target, name: "default" })
    const nb = clause.namedBindings
    if (nb && ts.isNamespaceImport(nb)) mod.imports.set(nb.name.text, { target, name: "*" })
    else if (nb) {
      for (const el of nb.elements) {
        if (el.isTypeOnly) continue
        mod.imports.set(el.name.text, { target, name: (el.propertyName ?? el.name).text })
      }
    }
  }

  const symFor = (name: string): Sym => {
    let s = mod.syms.get(name)
    if (!s) mod.syms.set(name, (s = { name, uses: [] }))
    return s
  }

  /** Walk a declaration's value code into `sym`. Types, property keys and declared names are not uses. */
  const scan = (root: ts.Node, sym: Sym) => {
    const visit = (n: ts.Node): void => {
      // `class X extends Y` — Y is a value (the `implements` list is types only).
      if (ts.isHeritageClause(n)) {
        if (n.token === ts.SyntaxKind.ExtendsKeyword) for (const t of n.types) visit(t.expression)
        return
      }
      if (ts.isTypeNode(n) || ts.isInterfaceDeclaration(n) || ts.isTypeAliasDeclaration(n)) return
      if (ts.isCallExpression(n) || ts.isNewExpression(n)) {
        const callee = n.expression
        const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : undefined
        if (name) mod.called.add(name)
        if (ts.isCallExpression(n) && callee.kind === ts.SyntaxKind.ImportKeyword) {
          const arg = n.arguments[0]
          if (arg && ts.isStringLiteral(arg)) sym.uses.push({ kind: "dynamic", target: resolveSpec(file, arg.text, known), line: lineOf(sf, n) })
        }
      }
      if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && mod.imports.get(n.expression.text)?.name === "*") {
        sym.uses.push({ kind: "member", ns: n.expression.text, member: n.name.text, line: lineOf(sf, n) })
        return
      }
      // An SDK's error class (`Anthropic.APIError` in an instanceof check) is not a client.
      if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && SDK_ERROR_MEMBER.test(n.name.text) &&
          RAW_SDK_PACKAGE.test(mod.imports.get(n.expression.text)?.target ?? "")) return
      if (ts.isPropertyAccessExpression(n)) { visit(n.expression); return }
      if (ts.isIdentifier(n)) {
        // A bare namespace (destructured, indexed, passed on) uses every export of it.
        if (mod.imports.get(n.text)?.name === "*") sym.uses.push({ kind: "member", ns: n.text, member: "*", line: lineOf(sf, n) })
        else sym.uses.push({ kind: "name", local: n.text, line: lineOf(sf, n) })
        return
      }
      // Names that are not uses: a property's key, a declaration's own name.
      if (ts.isPropertyAssignment(n) || ts.isPropertyDeclaration(n) || ts.isMethodDeclaration(n) || ts.isGetAccessor(n) || ts.isSetAccessor(n)) {
        if (ts.isComputedPropertyName(n.name)) visit(n.name)
        n.forEachChild((c) => { if (c !== n.name) visit(c) })
        return
      }
      if ((ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isClassDeclaration(n) || ts.isClassExpression(n)) && n.name) {
        n.forEachChild((c) => { if (c !== n.name) visit(c) })
        return
      }
      if (ts.isVariableDeclaration(n) || ts.isParameter(n) || ts.isBindingElement(n)) {
        if (ts.isBindingElement(n) && n.propertyName && ts.isComputedPropertyName(n.propertyName)) visit(n.propertyName)
        n.forEachChild((c) => { if (c !== n.name || !ts.isIdentifier(c)) visit(c) })
        return
      }
      n.forEachChild(visit)
    }
    visit(root)
  }

  // Pass 2 — top-level declarations, exports, and everything else as "<top>".
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) || ts.isImportEqualsDeclaration(st)) continue
    if (ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st)) continue
    if (ts.isExportDeclaration(st)) {
      if (st.isTypeOnly) continue
      const target = st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier) ? resolveSpec(file, st.moduleSpecifier.text, known) : undefined
      const ec = st.exportClause
      if (!ec) { if (target) mod.stars.push(target); continue }
      if (ts.isNamespaceExport(ec)) { if (target) mod.exports.set(ec.name.text, { from: { target, name: "*" } }); continue }
      for (const el of ec.elements) {
        if (el.isTypeOnly) continue
        const orig = (el.propertyName ?? el.name).text
        mod.exports.set(el.name.text, target ? { from: { target, name: orig } } : { local: orig })
      }
      continue
    }
    if (ts.isExportAssignment(st)) {
      scan(st.expression, symFor("default"))
      mod.exports.set("default", { local: "default" })
      continue
    }
    const exported = hasModifier(st, ts.SyntaxKind.ExportKeyword)
    const isDefault = hasModifier(st, ts.SyntaxKind.DefaultKeyword)
    if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st) || ts.isEnumDeclaration(st)) && (st.name || isDefault)) {
      const name = st.name?.text ?? "default"
      scan(st, symFor(name))
      if (exported) mod.exports.set(isDefault ? "default" : name, { local: name })
      continue
    }
    if (ts.isVariableStatement(st)) {
      for (const decl of st.declarationList.declarations) {
        for (const name of bindingNames(decl.name)) {
          scan(decl, symFor(name))
          if (exported) mod.exports.set(name, { local: name })
        }
      }
      continue
    }
    scan(st, symFor("<top>"))
  }
  return mod
}

const parseCache = new Map<string, { text: string; knownSize: number; mod: Mod }>()

function loadModules(sources: ReadonlyMap<string, string>): Map<string, Mod> {
  const known = new Set(sources.keys())
  return new Map([...sources].map(([file, text]) => {
    const hit = parseCache.get(file)
    if (hit && hit.text === text && hit.knownSize === known.size) return [file, hit.mod] as const
    const mod = parseModule(file, text, known)
    parseCache.set(file, { text, knownSize: known.size, mod })
    return [file, mod] as const
  }))
}

/** Every shipped source file, by its backend/src-relative path. */
function realSources(): Map<string, string> {
  return new Map(
    sourceFiles()
      .filter((f) => !/\.(?:char|spec)\.ts$|\.d\.ts$/.test(f))
      .map((abs) => [relPath(abs), readFileSync(abs, "utf8")] as const),
  )
}

// ── resolution, reach, callers ───────────────────────────────────────────────

interface Site { what: string; line: number }

interface Analysis {
  mods: Map<string, Mod>
  flagged: Array<{ file: string; why: string; line: number }>
  metered: Set<string>
  /** file → its own LLM call sites. */
  direct: Map<string, Site[]>
  /** wrapper → caller → how many uses of the wrapper's reaching symbols. */
  callers: Map<string, Map<string, number>>
  /** file → credit-id builder → every line it is used on. */
  creditIds: Map<string, Map<string, number[]>>
  /** client export → the non-client files that import it as a pure helper. */
  pureHelperUses: Map<string, Set<string>>
  viaCallers: Map<string, string[]>
  failures: Array<{ file: string; why: string; line: number; chain: string }>
}

/** `extraExempt` lets a fixture add entries; the real tree uses EXEMPT alone. */
function analyse(sources: ReadonlyMap<string, string>, extraExempt: ReadonlyMap<string, Exemption> = new Map()): Analysis {
  const mods = loadModules(sources)

  /** An export's final (module, name): through re-exports, import-then-export and `export *`. */
  function resolveExport(file: string, name: string, seen = new Set<string>()): Binding | undefined {
    if (file.startsWith("pkg:")) return { target: file, name }
    const key = `${file}#${name}`
    if (seen.has(key)) return undefined
    seen.add(key)
    const mod = mods.get(file)
    if (!mod) return undefined
    if (name === "*") return { target: file, name: "*" }
    const e = mod.exports.get(name)
    if (e?.from) return resolveExport(e.from.target, e.from.name, seen)
    if (e?.local) {
      if (mod.syms.has(e.local)) return { target: file, name: e.local }
      const b = mod.imports.get(e.local)
      return b ? resolveExport(b.target, b.name, seen) : undefined
    }
    // Local stars first; a package star answers only for a raw SDK package (whose
    // exports are not parsed — any name is taken as the SDK's, fail closed).
    const stars = [...mod.stars.filter((t) => !t.startsWith("pkg:")), ...mod.stars.filter((t) => RAW_SDK_PACKAGE.test(t))]
    for (const t of stars) {
      const r = resolveExport(t, name, seen)
      if (r) return r
    }
    return undefined
  }

  /** A use's final (module, name), or undefined for a local value that is no top-level symbol. */
  function resolveUse(mod: Mod, use: Use): Binding | undefined {
    if (use.kind === "dynamic") return { target: use.target, name: "*" }
    if (use.kind === "member") {
      const b = mod.imports.get(use.ns)!
      return use.member === "*" ? { target: b.target, name: "*" } : resolveExport(b.target, use.member)
    }
    if (mod.syms.has(use.local)) return { target: mod.file, name: use.local }
    const b = mod.imports.get(use.local)
    return b ? resolveExport(b.target, b.name) : undefined
  }

  const direct = new Map<string, Site[]>()
  const creditIds = new Map<string, Map<string, number[]>>()
  const pureHelperUses = new Map<string, Set<string>>()
  /** `${file}#${sym}` → the (module, symbol) pairs outside the client it uses. */
  const usedDefs = new Map<string, Array<{ file: string; name: string }>>()
  const reach = new Set<string>()

  for (const mod of mods.values()) {
    if (isClient(mod.file)) continue
    for (const s of mod.syms.values()) {
      const defs: Array<{ file: string; name: string }> = []
      for (const use of s.uses) {
        const r = resolveUse(mod, use)
        if (!r) continue
        if (CREDIT_ID_NAMES.has(r.name) && !(r.target === mod.file && use.kind === "name" && use.local === s.name)) {
          const byName = creditIds.get(mod.file) ?? new Map<string, number[]>()
          byName.set(r.name, [...(byName.get(r.name) ?? []), use.line])
          creditIds.set(mod.file, byName)
        }
        let site: Site | undefined
        if (isClient(r.target)) {
          if (r.name !== "*" && isPureClientHelper(r.name)) {
            pureHelperUses.set(r.name, (pureHelperUses.get(r.name) ?? new Set()).add(mod.file))
          } else site = { what: r.name === "*" ? `${r.target} (whole module)` : r.name, line: use.line }
        } else if (RAW_SDK_PACKAGE.test(r.target)) {
          site = { what: `${r.target.slice(4)} (raw SDK)`, line: use.line }
        } else if (!r.target.startsWith("pkg:") && !r.target.startsWith("missing:")) {
          if (r.name === "*") defs.push(...[...(mods.get(r.target)?.syms.keys() ?? [])].map((n) => ({ file: r.target, name: n })))
          else defs.push({ file: r.target, name: r.name })
        }
        if (site) {
          direct.set(mod.file, [...(direct.get(mod.file) ?? []), site])
          reach.add(`${mod.file}#${s.name}`)
        }
      }
      usedDefs.set(`${mod.file}#${s.name}`, defs.filter((d) => !(d.file === mod.file && d.name === s.name)))
    }
  }
  for (let changed = true; changed;) {
    changed = false
    for (const [key, defs] of usedDefs) {
      if (reach.has(key)) continue
      if (defs.some((d) => reach.has(`${d.file}#${d.name}`))) { reach.add(key); changed = true }
    }
  }

  const callers = new Map<string, Map<string, number>>()
  for (const mod of mods.values()) {
    if (isClient(mod.file)) continue
    for (const s of mod.syms.values()) {
      for (const d of usedDefs.get(`${mod.file}#${s.name}`) ?? []) {
        if (d.file === mod.file || !reach.has(`${d.file}#${d.name}`)) continue
        const byCaller = callers.get(d.file) ?? new Map<string, number>()
        byCaller.set(mod.file, (byCaller.get(mod.file) ?? 0) + 1)
        callers.set(d.file, byCaller)
      }
    }
  }

  const flagged: Analysis["flagged"] = []
  const pricers = new Set<string>()
  for (const mod of mods.values()) {
    if (isClient(mod.file)) continue
    const own = direct.get(mod.file)
    const ids = creditIds.get(mod.file)
    if (own) flagged.push({ file: mod.file, why: `calls the LLM client (${own[0].what})`, line: own[0].line })
    else if (ids) {
      const [name, lines] = [...ids][0]
      flagged.push({ file: mod.file, why: `builds an LLM credit id (${name})`, line: lines[0] })
      pricers.add(mod.file)
    }
  }

  const metered = new Set([...mods.values()].filter((m) => [...METER_CALLS].some((c) => m.called.has(c))).map((m) => m.file))

  const exemptFor = (file: string, callee: string): boolean => {
    for (const dir of EXEMPT_DIRS.keys()) if (file.startsWith(dir)) return true
    return (EXEMPT.get(file) ?? extraExempt.get(file))?.via === callee
  }

  const viaCallers = new Map<string, string[]>()
  const memo = new Map<string, { ok: boolean; chain: string }>()
  /** Is `file` satisfied when reached from `callee` (DIRECT = its own call)? Cycles are not. */
  function satisfied(file: string, callee: string, stack: readonly string[]): { ok: boolean; chain: string } {
    if (exemptFor(file, callee)) return { ok: true, chain: file }
    if (isEntryPoint(file)) {
      // An entry point may meter its OWN call; it never satisfies anything as a caller.
      return callee === DIRECT && (metered.has(file) || METER.has(file))
        ? { ok: true, chain: file }
        : { ok: false, chain: `${file} (an entry point — it meters only its own calls, never a caller's)` }
    }
    if (metered.has(file) || METER.has(file)) return { ok: true, chain: file }
    if (callee === DIRECT && pricers.has(file)) {
      // Not a call site, so its importers are not callers: is the tier id only the rollback branch?
      return mods.get(file)!.called.has(METERED_PRICE_DISPATCH)
        ? { ok: true, chain: file }
        : { ok: false, chain: `${file} (prices the TIER id unconditionally — no ${METERED_PRICE_DISPATCH}() dispatch)` }
    }
    const cached = memo.get(file)
    if (cached) return cached
    if (stack.includes(file)) return { ok: false, chain: `${file} (import cycle)` }
    const cs = [...(callers.get(file)?.keys() ?? [])].sort()
    let result: { ok: boolean; chain: string } = { ok: true, chain: file }
    if (cs.length === 0) result = { ok: false, chain: `${file} (nothing calls it — no file on this path meters or is exempt)` }
    for (const c of cs) {
      const r = satisfied(c, file, [...stack, file])
      if (!r.ok) { result = { ok: false, chain: `${file} ← ${r.chain}` }; break }
    }
    if (result.ok) viaCallers.set(file, cs)
    if (!stack.length || result.ok) memo.set(file, result)
    return result
  }

  const failures: Analysis["failures"] = []
  for (const f of flagged) {
    const r = satisfied(f.file, DIRECT, [])
    if (!r.ok) failures.push({ ...f, chain: r.chain })
  }
  return { mods, flagged, metered, direct, callers, creditIds, pureHelperUses, viaCallers, failures }
}

// ── the checks (shared by the real tree and the fixtures) ───────────────────

function unmetered(a: Analysis): string[] {
  return a.failures.filter((f) => !PENDING.has(f.file)).map((f) => `  • ${f.file}:${f.line} — ${f.why}\n      unmetered path: ${f.chain}`)
}

function allowed(file: string, pins: readonly string[]): boolean {
  return pins.some((p) => (p.endsWith("/") ? file.startsWith(p) : file === p))
}

/** Exempt files called by a file their entry does not admit. */
function callerPinViolations(a: Analysis): string[] {
  const out: string[] = []
  for (const [file, ex] of EXEMPT) {
    for (const c of a.callers.get(file)?.keys() ?? []) {
      if (!allowed(c, ex.callers)) out.push(`  • ${file} is called by ${c} — not in its allowed callers [${ex.callers.join(", ")}]`)
    }
  }
  return out
}

/** The pin a file on an exempt chain answers to: its EXEMPT entry, else the most specific CHAIN_PINS key. */
function pinOf(file: string): { key: string; allow: (caller: string) => boolean } | undefined {
  const ex = EXEMPT.get(file)
  if (ex) return { key: file, allow: (c) => allowed(c, ex.callers) }
  if (CHAIN_PINS.has(file)) return { key: file, allow: (c) => allowed(c, CHAIN_PINS.get(file)!) }
  const dir = [...CHAIN_PINS.keys()].filter((k) => k.endsWith("/") && file.startsWith(k)).sort((x, y) => y.length - x.length)[0]
  return dir ? { key: dir, allow: (c) => c.startsWith(dir) || allowed(c, CHAIN_PINS.get(dir)!) } : undefined
}

/** Walk every exempt chain upward to its entry points; every hop must be pinned. Returns violations and the pins used. */
function chainWalk(a: Analysis): { violations: string[]; usedPins: Map<string, Set<string>> } {
  const seeds = new Set<string>([...EXEMPT.keys()])
  for (const dir of EXEMPT_DIRS.keys()) {
    for (const f of [...a.direct.keys(), ...a.callers.keys()]) if (f.startsWith(dir)) seeds.add(f)
  }
  const violations: string[] = []
  const usedPins = new Map<string, Set<string>>()
  const seen = new Set<string>()
  const queue = [...seeds]
  while (queue.length) {
    const x = queue.shift()!
    if (seen.has(x) || isEntryPoint(x)) continue
    seen.add(x)
    const pin = pinOf(x)
    for (const c of a.callers.get(x)?.keys() ?? []) {
      if (!pin) violations.push(`  • ${x} is on an exempt chain and has no caller pin — called by ${c}`)
      else if (!pin.allow(c)) violations.push(`  • ${x} is on an exempt chain; ${c} is not among its pinned callers (${pin.key})`)
      else usedPins.set(pin.key, (usedPins.get(pin.key) ?? new Set()).add(c))
      queue.push(c)
    }
  }
  return { violations, usedPins }
}

/** Exempt files whose number of exempted call sites moved. */
function siteCountViolations(a: Analysis): string[] {
  const out: string[] = []
  for (const [file, ex] of EXEMPT) {
    const n = ex.via === DIRECT ? (a.direct.get(file)?.length ?? 0) : (a.callers.get(ex.via)?.get(file) ?? 0)
    if (n !== ex.sites) out.push(`  • ${file}: ${n} call site(s) ${ex.via === DIRECT ? "of its own" : `into ${ex.via}`}, EXEMPT reasons ${ex.sites}`)
  }
  return out
}

function buildIdOutsidePriceTable(a: Analysis): string[] {
  return [...a.creditIds]
    .filter(([file, ids]) => file !== "ee/billing/credits.ts" && (ids.has("buildLlmCreditIdentifier") || ids.has("resolveLlmCreditId")))
    .map(([file, ids]) => `  • ${file}: ${[...ids].map(([n, l]) => `${n} @ ${l.join(",")}`).join("; ")}`)
}

const analysis = analyse(realSources())

describe("every LLM call site is metered or exempt with a reason", () => {
  it("scans the real call-site population", () => {
    expect(analysis.flagged.length).toBeGreaterThan(40)
    expect(analysis.direct.size).toBeGreaterThan(25)
  })

  it("no LLM call site is unmetered", { timeout: SCAN_TIMEOUT_MS }, () => {
    const lines = unmetered(analysis)
    expect(
      lines,
      `These files reach the LLM client (or build an LLM credit id) without metering the call — ` +
        `a free, uncapped LLM proxy.\n\n` +
        `Meter it: meterSyncLlmMetered (lib/llm-billing.ts) for a sync route, or reserveLlmCall → ` +
        `markProviderCallStart → call → settleLlmJob for a job, recording each call in an LlmSpend; a ` +
        `worker opens workerLlmBilling. A wrapper passes when EVERY caller of it is metered or exempt — ` +
        `the path names the first caller that is not. Only a call that is genuinely not billed on its ` +
        `own (an LLM step inside a fixed media price, an admin-only platform cost) goes in EXEMPT, ` +
        `*with the reason*.\n\n${lines.join("\n")}`,
    ).toEqual([])
  })

  it("every PENDING entry still fails — a fixed file leaves the list", () => {
    const failing = new Set(analysis.failures.map((f) => f.file))
    const stale = [...PENDING.entries()].filter(([f]) => !failing.has(f)).map(([f, why]) => `  • ${f} — ${why}`)
    expect(stale, `Fixed — delete from PENDING:\n${stale.join("\n")}`).toEqual([])
  })

  it("an exempt file is called only by the files its entry admits", () => {
    const v = callerPinViolations(analysis)
    expect(v, `A new caller of an exempt file gets its LLM call unbilled — meter it, or extend the entry *with the reason*:\n${v.join("\n")}`).toEqual([])
  })

  it("every file above an exempt one, up to an entry point, is called only by its pinned callers", () => {
    const { violations } = chainWalk(analysis)
    expect(violations, `A new caller anywhere on an exempt chain gets the chain's LLM call unbilled — meter it, or pin it in CHAIN_PINS *with the reason*:\n${violations.join("\n")}`).toEqual([])
  })

  it("has no stale CHAIN_PINS entry or pin", () => {
    const { usedPins } = chainWalk(analysis)
    const stale: string[] = []
    for (const [key, pins] of CHAIN_PINS) {
      const used = usedPins.get(key)
      if (!used) { stale.push(`  • ${key} (no file on any exempt chain)`); continue }
      for (const p of pins) if (![...used].some((c) => allowed(c, [p]))) stale.push(`  • ${key}: pin ${p} matches no caller`)
    }
    expect(stale, `CHAIN_PINS entries that no longer match a chain:\n${stale.join("\n")}`).toEqual([])
  })

  it("an exempt file has exactly the call sites its entry reasons", () => {
    const v = siteCountViolations(analysis)
    expect(v, `An exemption covers the call sites it was written for, not a new one:\n${v.join("\n")}`).toEqual([])
  })

  it("EXEMPT and PENDING name no file the metering tasks own (a metered route that fails is a bug, not an exemption)", () => {
    const owned = [...METERING_TASK_FILES].filter(
      (f) => EXEMPT.has(f) || PENDING.has(f) || [...EXEMPT_DIRS.keys()].some((d) => f.startsWith(d)),
    )
    expect(owned).toEqual([])
  })

  it("has no stale EXEMPT / METER entry or caller pin", () => {
    const stale: string[] = []
    for (const [file, ex] of EXEMPT) {
      const live = ex.via === DIRECT ? analysis.direct.has(file) : analysis.callers.get(ex.via)?.has(file) === true
      if (!live) stale.push(`  • ${file} (via ${ex.via})`)
      const actual = [...(analysis.callers.get(file)?.keys() ?? [])]
      for (const pin of ex.callers) if (!actual.some((c) => allowed(c, [pin]))) stale.push(`  • ${file}: caller pin ${pin} matches no caller`)
    }
    const touched = new Set([...analysis.flagged.map((f) => f.file), ...[...analysis.callers.values()].flatMap((m) => [...m.keys()])])
    for (const dir of EXEMPT_DIRS.keys()) if (![...touched].some((f) => f.startsWith(dir))) stale.push(`  • ${dir}`)
    for (const file of METER.keys()) if (!analysis.flagged.some((f) => f.file === file)) stale.push(`  • ${file} (METER)`)
    expect(stale, `Entries that no longer match the code they excuse:\n${stale.join("\n")}`).toEqual([])
  })

  it("every PURE_CLIENT_HELPERS entry is a live client export some non-client file imports", () => {
    const unused = [...PURE_CLIENT_HELPERS.keys()].filter((n) => !analysis.pureHelperUses.has(n))
    expect(unused, `Allowlisted client helpers nothing imports — remove them:\n${unused.join("\n")}`).toEqual([])
  })

  it.skipIf(!TIERS_REMOVED)("no non-test file outside ee/billing/credits.ts builds an LLM tier credit id", () => {
    expect(buildIdOutsidePriceTable(analysis)).toEqual([])
  })
})

describe("anti-vacuity — the guard cannot pass by losing its markers", () => {
  it("the metered routes and workers are recognised as metering", () => {
    for (const f of ["routes/llm-chat.ts", "routes/llm-structured.ts", "routes/llm-suggest-description.ts", "workers/handlers/llm-structured.ts"]) {
      expect(analysis.metered.has(f), f).toBe(true)
    }
  })

  it("wrappers pass only through their callers, and a constant-only importer is not a caller", () => {
    expect(analysis.viaCallers.get("lib/creature-caption.ts")).toBeDefined()
    expect(analysis.callers.get("lib/creature-caption.ts")?.has("lib/mcp/tools/creatures.ts")).not.toBe(true)
    expect(analysis.viaCallers.get("lib/llm-structured-request.ts")).toContain("workers/handlers/llm-structured.ts")
  })

  it("routes/describe-to-picker.ts default-imports the Anthropic SDK for its types and error classes only — not a raw SDK use", () => {
    expect(readFileSync(join(SRC, "routes", "describe-to-picker.ts"), "utf8")).toMatch(/^import Anthropic from "@anthropic-ai\/sdk"/m)
    expect((analysis.direct.get("routes/describe-to-picker.ts") ?? []).filter((s) => s.what.includes("raw SDK"))).toEqual([])
  })

  it("the credit-id census sees today's builders", () => {
    expect(analysis.creditIds.get("ee/billing/credits.ts")?.has("buildLlmCreditIdentifier")).toBe(true)
    expect(buildIdOutsidePriceTable(analysis).length).toBeGreaterThan(0) // what Task 19 must clear
  })

  it("the LLM client still exports its entry points and the meter its reserve", () => {
    const client = readFileSync(join(SRC, "lib", "llm-client.ts"), "utf8")
    for (const name of ["llmComplete", "llmStream", "llmCompleteStructured", "llmStreamStructured"]) expect(client).toContain(name)
    expect(readFileSync(join(SRC, "lib", "llm-billing.ts"), "utf8")).toMatch(/export async function reserveLlmCall\b/)
  })
})

// ── fixtures: the review's mutation probes, pinned ───────────────────────────

/** A minimal synthetic tree: the client, a lane, and the meter. */
const BASE: ReadonlyArray<readonly [string, string]> = [
  ["lib/llm/router.ts", "export async function llmComplete(r: unknown) { return r }"],
  ["lib/llm/kie-lane.ts", "export async function callKie(r: unknown) { return r }\nexport function kieKeySet() { return true }"],
  ["lib/llm-client.ts", 'export { llmComplete } from "./llm/router.js"'],
  ["lib/llm-billing.ts", "export async function reserveLlmCall() { return 1 }"],
  ["app.ts", 'import routes from "./routes/zz.js"\nroutes()'],
]
const tree = (...files: Array<readonly [string, string]>) => analyse(new Map([...BASE, ...files]))
const failingFiles = (a: Analysis) => a.failures.map((f) => f.file)

describe("fixtures — each review probe stays pinned", () => {
  it("control: a route calling llmComplete without a reserve fails; with one it passes", () => {
    const call = 'import { llmComplete } from "../lib/llm-client.js"\n'
    expect(failingFiles(tree(["routes/zz.ts", `${call}export default async function r() { return llmComplete({}) }`]))).toContain("routes/zz.ts")
    expect(failingFiles(tree(["routes/zz.ts",
      `${call}import { reserveLlmCall } from "../lib/llm-billing.js"\nexport default async function r() { await reserveLlmCall(); return llmComplete({}) }`]))).toEqual([])
  })

  it("control on the real tree: qa-check without its reserve fails", { timeout: SCAN_TIMEOUT_MS }, () => {
    const src = realSources()
    const qa = src.get("routes/qa-check.ts")!
    expect(qa).toContain("await reserveLlmCall(")
    src.set("routes/qa-check.ts", qa.replace("await reserveLlmCall(", "await (null as never as (...a: unknown[]) => unknown)("))
    expect(failingFiles(analyse(src))).toContain("routes/qa-check.ts")
  })

  it("1: a call through a barrel is the call — `export {x} from`, `export *`, import-then-export, namespace", () => {
    const barrels: Array<readonly [string, string]> = [
      ["lib/zz-named.ts", 'export { llmComplete as complete } from "./llm-client.js"'],
      ["lib/zz-star.ts", 'export * from "./llm-client.js"'],
      ["lib/zz-reexport.ts", 'import { llmComplete } from "./llm-client.js"\nexport { llmComplete }'],
    ]
    for (const [barrel, name] of [["zz-named", "complete"], ["zz-star", "llmComplete"], ["zz-reexport", "llmComplete"]] as const) {
      const named = tree(...barrels, ["routes/zz.ts", `import { ${name} } from "../lib/${barrel}.js"\nexport default async function r() { return ${name}({}) }`])
      expect(failingFiles(named), `${barrel} (named)`).toContain("routes/zz.ts")
      const ns = tree(...barrels, ["routes/zz.ts", `import * as b from "../lib/${barrel}.js"\nexport default async function r() { return b.${name}({}) }`])
      expect(failingFiles(ns), `${barrel} (namespace)`).toContain("routes/zz.ts")
    }
  })

  it("2: fail closed — any client export is an entry point unless allowlisted pure", () => {
    expect(failingFiles(tree(["routes/zz.ts",
      'import { callKie } from "../lib/llm/kie-lane.js"\nexport default async function r() { return callKie({}) }']))).toContain("routes/zz.ts")
    const pure = tree(["routes/zz.ts", 'import { kieKeySet } from "../lib/llm/kie-lane.js"\nexport default async function r() { return kieKeySet() }'])
    expect(pure.direct.has("routes/zz.ts")).toBe(false)
    const wholeNs = tree(["routes/zz.ts", 'import * as k from "../lib/llm/kie-lane.js"\nexport default async function r() { const { callKie } = k; return callKie({}) }'])
    expect(failingFiles(wholeNs)).toContain("routes/zz.ts")
  })

  it("3: a new caller of an exempt wrapper fails its caller pin", () => {
    const a = tree(
      ["ee/video-director/author.ts", 'import { llmComplete } from "../../lib/llm-client.js"\nexport async function authorShotSequence() { return llmComplete({}) }'],
      ["ee/video-director/orchestrate.ts", 'import { authorShotSequence } from "./author.js"\nexport const run = () => authorShotSequence()'],
      ["routes/zz.ts", 'import { authorShotSequence } from "../ee/video-director/author.js"\nexport default async function r() { return authorShotSequence() }'],
    )
    expect(callerPinViolations(a).join("\n")).toContain("ee/video-director/author.ts is called by routes/zz.ts")
  })

  it("4: a value use of a raw SDK package is a call site; a types-only default import is not", () => {
    const used = tree(["routes/zz.ts", 'import Anthropic from "@anthropic-ai/sdk"\nexport default async function r() { return new Anthropic() }'])
    expect(failingFiles(used)).toContain("routes/zz.ts")
    const subclass = tree(["lib/zz.ts", 'import OpenAI from "openai"\nexport class Mine extends OpenAI {}'])
    expect(subclass.direct.has("lib/zz.ts")).toBe(true)
    const typesOnly = tree(["routes/zz.ts",
      'import Anthropic from "@anthropic-ai/sdk"\nexport default async function r(m: Anthropic.MessageParam): Promise<Anthropic.Message | null> { return m ? null : null }'])
    expect(typesOnly.direct.has("routes/zz.ts")).toBe(false)
    const errorClass = tree(["routes/zz.ts",
      'import Anthropic from "@anthropic-ai/sdk"\nexport default async function r(e: unknown) { return e instanceof Anthropic.APIError }'])
    expect(errorClass.direct.has("routes/zz.ts")).toBe(false)
    const genai = tree(["lib/zz.ts", 'import { GoogleGenAI } from "@google/genai"\nexport const g = () => new GoogleGenAI({})'])
    expect(genai.direct.has("lib/zz.ts")).toBe(true)
  })

  it("5: a second call site in an exempt D3 route fails its site count", () => {
    const a = tree(["routes/image-to-image.ts",
      'import { llmComplete } from "../lib/llm-client.js"\nexport default async function r() { await llmComplete({}); return llmComplete({}) }'])
    expect(siteCountViolations(a).join("\n")).toContain("routes/image-to-image.ts: 2 call site(s) of its own, EXEMPT reasons 1")
  })

  it("7: credit-id uses are counted per name, every occurrence, namespace calls included", () => {
    const a = tree(["ee/lib/zz.ts",
      'import * as m from "@nodaro/shared/llm-models"\nimport { resolveLlmCreditId as r } from "@nodaro/shared/llm-models"\nexport const x = () => [m.buildLlmCreditIdentifier("a", "b"), m.buildLlmCreditIdentifier("c", "d"), r("e", {})]'])
    expect([...(a.creditIds.get("ee/lib/zz.ts") ?? [])]).toEqual([["buildLlmCreditIdentifier", [3, 3]], ["resolveLlmCreditId", [3]]])
    expect(buildIdOutsidePriceTable(a).join("\n")).toContain("ee/lib/zz.ts")
    expect(failingFiles(a)).toContain("ee/lib/zz.ts")
  })

  it("R3-1: a package star never shadows a local one; a raw SDK star still resolves", () => {
    const viaZod = tree(
      ["lib/zz-barrel.ts", 'export * from "zod"\nexport * from "./llm-client.js"'],
      ["routes/zz.ts", 'import { llmComplete } from "../lib/zz-barrel.js"\nexport default async function r() { return llmComplete({}) }'],
    )
    expect(failingFiles(viaZod)).toContain("routes/zz.ts")
    const viaSdk = tree(
      ["lib/zz-sdk.ts", 'export * from "@anthropic-ai/sdk"'],
      ["routes/zz.ts", 'import { Anthropic } from "../lib/zz-sdk.js"\nexport default async function r() { return new Anthropic() }'],
    )
    expect(viaSdk.direct.has("routes/zz.ts")).toBe(true)
  })

  it("R3-2: a new caller anywhere on an exempt chain fails — video-director, pipelines, copilot", () => {
    const vd = tree(
      ["ee/video-director/author.ts", 'import { llmComplete } from "../../lib/llm-client.js"\nexport async function authorShotSequence() { return llmComplete({}) }'],
      ["ee/video-director/orchestrate.ts", 'import { authorShotSequence } from "./author.js"\nexport const runVideoDirector = () => authorShotSequence()'],
      ["workers/video-director-worker.ts", 'import { runVideoDirector } from "../ee/video-director/orchestrate.js"\nexport const w = () => runVideoDirector()'],
      ["routes/zz.ts", 'import { runVideoDirector } from "../ee/video-director/orchestrate.js"\nexport default async function r() { return runVideoDirector() }'],
    )
    const vdv = chainWalk(vd).violations.join("\n")
    expect(vdv).toContain("ee/video-director/orchestrate.ts is on an exempt chain; routes/zz.ts is not among its pinned callers")
    expect(vdv).not.toContain("workers/video-director-worker.ts is not")
    const pipelines = tree(
      ["ee/pipelines/llms/call-llm.ts", 'import { llmComplete } from "../../../lib/llm-client.js"\nexport async function callLLM() { return llmComplete({}) }'],
      ["ee/pipelines/zz.ts", 'import { callLLM } from "./llms/call-llm.js"\nexport const zz = () => callLLM()'],
      ["routes/zz.ts", 'import { zz } from "../ee/pipelines/zz.js"\nexport default async function r() { return zz() }'],
    )
    expect(chainWalk(pipelines).violations.join("\n")).toContain("ee/pipelines/zz.ts is on an exempt chain; routes/zz.ts is not among its pinned callers (ee/pipelines/)")
    const copilot = tree(
      ["ee/copilot/kie-vision.ts", 'import { callKie } from "../../lib/llm/kie-lane.js"\nexport async function describeImageUrls() { return callKie({}) }'],
      ["routes/zz.ts", 'import { describeImageUrls } from "../ee/copilot/kie-vision.js"\nexport default async function r() { return describeImageUrls() }'],
    )
    expect(chainWalk(copilot).violations.join("\n")).toContain("ee/copilot/kie-vision.ts is on an exempt chain; routes/zz.ts is not among its pinned callers (ee/copilot/)")
    // A file above an exempt one with no pin at all fails closed.
    const unpinned = tree(
      ["routes/image-to-image.ts", 'import { llmComplete } from "../lib/llm-client.js"\nexport async function i2i() { return llmComplete({}) }'],
      ["lib/zz.ts", 'import { i2i } from "../routes/image-to-image.js"\nexport const zz = () => i2i()'],
      ["routes/zz.ts", 'import { zz } from "../lib/zz.js"\nexport default async function r() { return zz() }'],
    )
    const uv = chainWalk(unpinned).violations.join("\n")
    expect(uv).toContain("routes/image-to-image.ts is on an exempt chain; lib/zz.ts is not among its pinned callers")
    expect(uv).toContain("lib/zz.ts is on an exempt chain and has no caller pin — called by routes/zz.ts")
  })

  it("R3-3: an entry point never satisfies a caller, even one that meters", () => {
    const a = tree(
      ["app.ts", 'import routes from "./routes/zz.js"\nimport { reserveLlmCall } from "./lib/llm-billing.js"\nreserveLlmCall()\nroutes()'],
      ["routes/zz.ts", 'import { llmComplete } from "../lib/llm-client.js"\nexport default async function r() { return llmComplete({}) }'],
    )
    const f = a.failures.find((x) => x.file === "routes/zz.ts") // R4-b
    expect(f?.chain).toBe("routes/zz.ts ← app.ts (an entry point — it meters only its own calls, never a caller's)")
  })

  it("R4-a: a script that meters its own LLM call passes", () => {
    const a = tree(["scripts/zz.ts",
      'import { llmComplete } from "../lib/llm-client.js"\nimport { reserveLlmCall } from "../lib/llm-billing.js"\nexport async function main() { await reserveLlmCall(); return llmComplete({}) }\nmain()'])
    expect(failingFiles(a)).not.toContain("scripts/zz.ts")
    const unmeteredScript = tree(["scripts/zz.ts", 'import { llmComplete } from "../lib/llm-client.js"\nllmComplete({})'])
    expect(failingFiles(unmeteredScript)).toContain("scripts/zz.ts")
  })

  it("R4-c: a wrapper shared by a metered route and an EXEMPT script passes; an unexempted script caller fails", () => {
    const files: Array<readonly [string, string]> = [
      ["lib/zz-wrap.ts", 'import { llmComplete } from "./llm-client.js"\nexport async function wrap() { return llmComplete({}) }'],
      ["routes/zz.ts", 'import { wrap } from "../lib/zz-wrap.js"\nimport { reserveLlmCall } from "../lib/llm-billing.js"\nexport default async function r() { await reserveLlmCall(); return wrap() }'],
      ["scripts/zz-ops.ts", 'import { wrap } from "../lib/zz-wrap.js"\nwrap()'],
    ]
    const unexempt = analyse(new Map([...BASE, ...files]))
    expect(unexempt.failures.find((x) => x.file === "lib/zz-wrap.ts")?.chain)
      .toBe("lib/zz-wrap.ts ← scripts/zz-ops.ts (an entry point — it meters only its own calls, never a caller's)")
    const exempt = analyse(new Map([...BASE, ...files]), new Map([
      ["scripts/zz-ops.ts", { why: "an ops script run by hand — a platform cost", via: "lib/zz-wrap.ts", sites: 1, callers: [] }],
    ]))
    expect(failingFiles(exempt)).toEqual([])
  })
})
