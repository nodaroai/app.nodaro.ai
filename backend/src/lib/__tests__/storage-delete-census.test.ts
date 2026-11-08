// @test-watches backend/src/**/*.ts
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import ts from "typescript"
import { lineOf, parseText, relPath, SCAN_TIMEOUT_MS, sourceFiles, SRC } from "./source-scan.js"

/**
 * Every storage delete records what it failed to delete (decided 2026-10-08,
 * round 12): no path drops a file silently.
 *
 * A storage delete in `backend/src` goes through the funnel in
 * `lib/storage-delete.ts` (`deleteKeysRecordingFailures` /
 * `deleteKeyRecordingFailure`), which records each key storage did not
 * confirm gone for the daily retry pass. A RAW delete — any use of
 * `deleteFromR2`, `batchDeleteFromR2`, `DeleteObjectCommand` or
 * `DeleteObjectsCommand`, under ANY local name (an aliased import, a renamed
 * destructure of a dynamic import, the helper passed as a value, a property
 * read off a module) — is allowed only in the files below, each with the
 * number of uses it makes and why. A new raw delete anywhere else, or one more
 * in a listed file, fails this test: route it through the funnel, or list it
 * with a reason. Importing the aggregated `S3` client (it has `deleteObject`
 * methods of its own) counts as a raw delete too.
 *
 * The scan parses each file with the TypeScript compiler (`source-scan.ts`):
 * comments are not code, and a string holding `/*` cannot hide a call.
 *
 * And every storage delete asks the STORAGE_DELETES setting first
 * (`storageDeletesSkipped()`, lib/storage-deletes-setting.ts): with `skip`, a
 * deployment that shares its media storage with another deployment but runs
 * on its own copy of the database deletes nothing. The last block below fails
 * the build on a storage command (`DeleteObjectCommand`, `DeleteObjectsCommand`,
 * the aggregated client's delete methods) sent from a function that never
 * asks it. `deleteFromR2` / `batchDeleteFromR2` ask it themselves — they are
 * held by that same rule in `lib/storage.ts` — so a delete through them, and
 * so through the funnel, needs nothing more. Each listed file below also says
 * how the setting reaches it (`setting`), and the test holds it to that.
 */
type SettingCoverage =
  /** Every delete it makes is `deleteFromR2` / `batchDeleteFromR2`, which skip every key under `skip`. */
  | "helpers"
  /** It asks `storageDeletesSkipped()` itself: it sends a storage command of its own, or its bookkeeping must not run on a skipped delete. */
  | "asks"

const RAW_DELETES_ALLOWED: Readonly<Record<string, { count: number; why: string; setting: SettingCoverage }>> = {
  "lib/storage.ts": {
    count: 3,
    why: "the delete helpers themselves: the two storage commands they send (a definition is not a use), and the second half of a restricted file's move to or from the evidence prefix, after a HEAD confirmed the copy (migration 583)",
    setting: "asks",
  },
  "lib/storage-delete.ts": { count: 2, why: "the funnel: it deletes, then records what failed", setting: "helpers" },
  "lib/storage-delete-retries.ts": {
    count: 1,
    why: "the retry pass: a failure counts an attempt on the existing record",
    // A skipped delete would read as a failed one here: the pass stands down.
    setting: "asks",
  },
  "lib/speaker-frames-cache-sweep.ts": {
    count: 1,
    why: "an age sweep that re-lists its prefix every day: a key it failed to delete is listed and deleted again next run",
    setting: "helpers",
  },
  "ee/billing/cleanup-service.ts": {
    count: 1,
    why: "the `*-tmp/` prefix sweeps re-list their prefix every day: a key they failed to delete is listed again next run",
    setting: "helpers",
  },
  "lib/retained-images.ts": {
    count: 1,
    why: "retained images have their own durable collection queue (`claim_retained_image_gc`): a task is completed only after its delete, so a failure is claimed again",
    setting: "asks",
  },
  "lib/retained-videos.ts": {
    count: 1,
    why: "retained videos: the same durable collection queue as retained images",
    setting: "asks",
  },
  "services/scene3d-artifacts/object-store.ts": {
    count: 1,
    why: "a separate bucket with its own artifact cleanup lane; the retry pass deletes from the media bucket only",
    setting: "asks",
  },
}

/** The storage helpers (lib/storage.ts): each asks the STORAGE_DELETES setting itself. */
const HELPERS = new Set(["deleteFromR2", "batchDeleteFromR2"])
/** The SDK's delete commands: a delete sent with one asks the setting in the function that sends it. */
const SDK_COMMANDS = new Set(["DeleteObjectCommand", "DeleteObjectsCommand"])
/** The raw storage-delete primitives, by their exported names. */
const PRIMITIVES = new Set([...HELPERS, ...SDK_COMMANDS])
/** The aggregated SDK client: it deletes without any of the primitives above. */
const AGGREGATED_CLIENT = "S3"
/** The aggregated client's own delete methods. */
const CLIENT_DELETES = new Set(["deleteObject", "deleteObjects"])
/** The question every storage delete asks first (lib/storage-deletes-setting.ts). */
const GATE = "storageDeletesSkipped"

function isDeclarationName(id: ts.Identifier): boolean {
  const p = id.parent
  if (ts.isImportSpecifier(p) || ts.isImportClause(p) || ts.isNamespaceImport(p) || ts.isBindingElement(p)) return true
  return (
    (ts.isFunctionDeclaration(p) ||
      ts.isVariableDeclaration(p) ||
      ts.isMethodDeclaration(p) ||
      ts.isPropertyAssignment(p) ||
      ts.isPropertySignature(p) ||
      ts.isMethodSignature(p) ||
      ts.isPropertyDeclaration(p) ||
      ts.isParameter(p)) &&
    p.name === id
  )
}

/**
 * One raw storage delete: the node that names it, and what it is — a use of a
 * storage helper, a use of a storage command, an import of the aggregated
 * client, or a call of that client's delete method (`client-call`: the census
 * counts the import, the setting's guard asks about the call).
 */
interface RawDelete {
  readonly node: ts.Node
  readonly kind: "helper" | "command" | "client-import" | "client-call"
}

/** `text` parsed with parent pointers: a use is told from a declaration by its parent. */
function parseWithParents(file: string, text: string): ts.SourceFile {
  // Only the few files that name a primitive get here (the pre-filters).
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
}

/**
 * Every raw storage delete in `sf`: every use of a primitive under any local
 * name it is bound to, every property or element read of a primitive's name
 * (a module namespace, a dynamic import), every import of the aggregated
 * client, and — in a file that imports it — every read of its delete methods.
 */
function rawDeleteNodes(sf: ts.SourceFile): RawDelete[] {
  // Each local name bound to a primitive, and the primitive it names.
  const local = new Map<string, string>([...PRIMITIVES].map((p) => [p, p]))
  const found: RawDelete[] = []
  let importsClient = false
  const kindOf = (primitive: string): RawDelete["kind"] => (HELPERS.has(primitive) ? "helper" : "command")
  const bind = (n: ts.Node): void => {
    // import { deleteFromR2 as drop } / const { deleteFromR2: drop } = await import(...)
    if (ts.isImportSpecifier(n)) {
      const imported = (n.propertyName ?? n.name).text
      if (PRIMITIVES.has(imported)) local.set(n.name.text, imported)
      if (imported === AGGREGATED_CLIENT) {
        found.push({ node: n, kind: "client-import" })
        importsClient = true
      }
    }
    if (
      ts.isBindingElement(n) &&
      n.propertyName &&
      ts.isIdentifier(n.propertyName) &&
      PRIMITIVES.has(n.propertyName.text) &&
      ts.isIdentifier(n.name)
    ) {
      local.set(n.name.text, n.propertyName.text)
    }
    ts.forEachChild(n, bind)
  }
  bind(sf)
  const visit = (n: ts.Node): void => {
    if (ts.isIdentifier(n)) {
      const p = n.parent
      if (ts.isPropertyAccessExpression(p) && p.name === n) {
        if (PRIMITIVES.has(n.text)) found.push({ node: n, kind: kindOf(n.text) })
        else if (importsClient && CLIENT_DELETES.has(n.text)) found.push({ node: n, kind: "client-call" })
      } else if (local.has(n.text) && !isDeclarationName(n) && !ts.isTypeQueryNode(p)) {
        // (`typeof batchDeleteFromR2` in a type is not a call.)
        found.push({ node: n, kind: kindOf(local.get(n.text)!) })
      }
    } else if (ts.isElementAccessExpression(n) && ts.isStringLiteralLike(n.argumentExpression)) {
      const name = n.argumentExpression.text
      if (PRIMITIVES.has(name)) found.push({ node: n, kind: kindOf(name) })
      else if (importsClient && CLIENT_DELETES.has(name)) found.push({ node: n, kind: "client-call" })
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return found
}

/**
 * How many raw storage deletes `text` makes: every use of a primitive under
 * any local name it is bound to, every property or element read of a
 * primitive's name (a module namespace, a dynamic import), and every import
 * of the aggregated client.
 */
export function rawDeleteUses(file: string, text: string): number {
  return rawDeleteNodes(parseWithParents(file, text)).filter((d) => d.kind !== "client-call").length
}

/** Whether `fn`'s body calls the STORAGE_DELETES question, under its own name, a local alias, or off its module. */
function callsGate(fn: ts.Node, gate: ReadonlySet<string>): boolean {
  let asks = false
  const look = (n: ts.Node): void => {
    if (asks) return
    if (ts.isCallExpression(n)) {
      const callee = n.expression
      if ((ts.isIdentifier(callee) && gate.has(callee.text)) || (ts.isPropertyAccessExpression(callee) && callee.name.text === GATE)) {
        asks = true
        return
      }
    }
    ts.forEachChild(n, look)
  }
  look(fn)
  return asks
}

/** The local names `sf` binds the STORAGE_DELETES question to. */
function gateNames(sf: ts.SourceFile): Set<string> {
  const names = new Set([GATE])
  const bind = (n: ts.Node): void => {
    if (ts.isImportSpecifier(n) && (n.propertyName ?? n.name).text === GATE) names.add(n.name.text)
    if (ts.isBindingElement(n) && n.propertyName && ts.isIdentifier(n.propertyName) && n.propertyName.text === GATE && ts.isIdentifier(n.name)) {
      names.add(n.name.text)
    }
    ts.forEachChild(n, bind)
  }
  bind(sf)
  return names
}

/**
 * The lines of `text` that send a storage delete without asking the
 * STORAGE_DELETES setting on the way: each use of a storage command (or of the
 * aggregated client's delete methods) with no enclosing function that calls
 * `storageDeletesSkipped()`. A call at module scope does not count — it would
 * be read once, at import — and neither does one in a sibling function. A use
 * of `deleteFromR2` / `batchDeleteFromR2` is not asked about: they ask
 * themselves, and their own storage commands are held by this rule.
 */
export function ungatedDeleteLines(file: string, text: string): number[] {
  const sf = parseWithParents(file, text)
  const gate = gateNames(sf)
  const asked = new Map<ts.Node, boolean>()
  const asks = (fn: ts.Node): boolean => {
    if (!asked.has(fn)) asked.set(fn, callsGate(fn, gate))
    return asked.get(fn)!
  }
  const lines: number[] = []
  for (const use of rawDeleteNodes(sf)) {
    if (use.kind !== "command" && use.kind !== "client-call") continue
    let covered = false
    for (let p: ts.Node | undefined = use.node.parent; p && !covered; p = p.parent) {
      if (ts.isFunctionLike(p) && asks(p)) covered = true
    }
    if (!covered) lines.push(lineOf(sf, use.node))
  }
  return lines
}

function rawDeletes(): Map<string, number> {
  const found = new Map<string, number>()
  for (const file of sourceFiles()) {
    if (file.endsWith(".d.ts")) continue
    const text = readFileSync(file, "utf8")
    // Cheap pre-filter: a primitive's or the client's name must appear at all.
    if (!/[dD]eleteFromR2|DeleteObjects?Command|\bS3\b/.test(text)) continue
    const n = rawDeleteUses(file, text)
    if (n > 0) found.set(relPath(file), n)
  }
  return found
}

/** A file's text with comments dropped, for the funnel-caller check. */
function code(file: string): string {
  const sf = parseText(file, readFileSync(file, "utf8"))
  const out: string[] = []
  const visit = (n: ts.Node): void => {
    if (ts.isIdentifier(n)) out.push(n.text)
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return out.join(" ")
}

describe("the raw-delete scan sees through every spelling (independent review round)", () => {
  const one = (text: string) => rawDeleteUses("x.ts", text)
  it.each([
    ["a plain call", `import { deleteFromR2 } from "../lib/storage.js"\nawait deleteFromR2(key)`],
    ["a renamed dynamic-import destructure", `const { deleteFromR2: drop } = await import("../lib/storage.js")\nawait drop(k)`],
    ["an aliased import", `import { batchDeleteFromR2 as removeAll } from "../lib/storage.js"\nawait removeAll(keys)`],
    ["the helper passed as a value", `import { deleteFromR2 } from "../lib/storage.js"\nawait Promise.allSettled(keys.map(deleteFromR2))`],
    ["an aliased SDK command", `import { DeleteObjectsCommand as Del } from "@aws-sdk/client-s3"\ns3.send(new Del({}))`],
    ["a property read off the module", `const storage = await import("../lib/storage.js")\nawait storage.deleteFromR2(k)`],
    ["an element read off the module", `const storage = await import("../lib/storage.js")\nawait storage["batchDeleteFromR2"](k)`],
    ["the aggregated client", `import { S3 } from "@aws-sdk/client-s3"\nnew S3({}).deleteObject({})`],
    ["a batch call", `import { batchDeleteFromR2 } from "../lib/storage.js"\nawait batchDeleteFromR2(keys)`],
    ["a call after a string holding a comment opener", `const ACCEPT = "image/*"\nawait deleteFromR2(key)\n/** doc */`],
  ])("%s", (_name, text) => {
    expect(one(text)).toBeGreaterThan(0)
  })

  it("comments and prose naming a helper are not uses", () => {
    expect(one(`// deleteFromR2(key)\n/* batchDeleteFromR2(keys) */\nconst note = "deleteFromR2(x)"`)).toBe(0)
  })

  it("an interface signature, a property that DEFINES a helper, or a type query is not a use", () => {
    expect(one(`interface T { deleteFromR2(key: string): Promise<void> }\nconst tk = { deleteFromR2: async (key: string) => funnel(key) }`)).toBe(0)
    expect(one(`import { batchDeleteFromR2 } from "./storage.js"\ntype R = ReturnType<typeof batchDeleteFromR2>`)).toBe(0)
  })
})

describe("storage-delete census: every delete records what it failed to delete", { timeout: SCAN_TIMEOUT_MS }, () => {
  const found = rawDeletes()

  it("finds the storage helpers (the scan works)", () => {
    expect(found.get("lib/storage.ts")).toBeGreaterThan(0)
  })

  it("has no raw storage delete outside the funnel unless it is listed with a reason", () => {
    const unlisted = [...found.keys()].filter((f) => !(f in RAW_DELETES_ALLOWED))
    expect(unlisted, "route these through lib/storage-delete.ts, or list them with a reason").toEqual([])
  })

  it("each listed file makes exactly its listed number of raw deletes", () => {
    const drift = Object.entries(RAW_DELETES_ALLOWED)
      .filter(([file, entry]) => (found.get(file) ?? 0) !== entry.count)
      .map(([file, entry]) => `${file}: listed ${entry.count}, found ${found.get(file) ?? 0}`)
    expect(drift).toEqual([])
  })

  it("every listed file says why", () => {
    for (const [file, entry] of Object.entries(RAW_DELETES_ALLOWED)) {
      expect(entry.why.length, file).toBeGreaterThan(20)
    }
  })

  it("the funnel is what the delete paths call", () => {
    const callers = sourceFiles()
      .filter((f) => /deleteKeysRecordingFailures|deleteKeyRecordingFailure/.test(readFileSync(f, "utf8")))
      .filter((f) => /\bdeleteKeysRecordingFailures\b|\bdeleteKeyRecordingFailure\b/.test(code(f)))
      .map(relPath)
    for (const path of [
      "ee/billing/cleanup-service.ts",
      "ee/routes/admin.ts",
      "ee/routes/admin-locations.ts",
      "ee/services/community/asset-lifecycle.ts",
      "ee/services/community/copy-entity-assets.ts",
      "lib/asset-delete.ts",
      "lib/job-policy-outputs.ts",
      "lib/media-delete.ts",
      "lib/private-plugins/toolkit.ts",
      "lib/workflow-delete.ts",
      "providers/video/edl-timeline.ts",
      "routes/character-training.ts",
      "routes/creatures.ts",
      "routes/locations.ts",
      "routes/media-process.ts",
      "routes/objects.ts",
    ]) {
      expect(callers, path).toContain(path)
    }
  })
})

describe("the STORAGE_DELETES scan: a storage command is sent only from a function that asks the setting", () => {
  const ungated = (text: string) => ungatedDeleteLines("x.ts", text).length
  const SEND = "await s3.send(new DeleteObjectCommand({ Key: k }))"
  const IMPORT_GATE = `import { storageDeletesSkipped } from "./storage-deletes-setting.js"`
  it.each([
    ["a command sent with no ask", `import { DeleteObjectCommand } from "@aws-sdk/client-s3"\nasync function drop(k: string) { ${SEND} }`],
    ["the ask only in a sibling function", `${IMPORT_GATE}\nfunction off() { return storageDeletesSkipped() }\nasync function drop(k: string) { ${SEND} }`],
    ["the ask only at module scope (read once, at import)", `${IMPORT_GATE}\nconst SKIP = storageDeletesSkipped()\nasync function drop(k: string) { if (SKIP) return\n${SEND} }`],
    ["a command sent at module scope", `const k = "a"\n${SEND}`],
    ["an aliased command", `import { DeleteObjectsCommand as Del } from "@aws-sdk/client-s3"\nasync function drop() { await s3.send(new Del({})) }`],
    ["a command read off the SDK module", `const sdk = await import("@aws-sdk/client-s3")\nasync function drop() { await s3.send(new sdk.DeleteObjectCommand({})) }`],
    ["the aggregated client's delete method", `import { S3 } from "@aws-sdk/client-s3"\nasync function drop() { await new S3({}).deleteObject({}) }`],
    ["a store's delete method that does not ask", `function make(client: C) { return { async delete(k: string) { await client.send(new DeleteObjectCommand({ Key: k })) } } }`],
    [
      "the question named in a comment, in a string, or read without a call",
      `// storageDeletesSkipped()\nconst note = "storageDeletesSkipped()"\nasync function drop(k: string) { const f = storageDeletesSkipped\n${SEND} }`,
    ],
  ])("flags %s", (_name, text) => {
    expect(ungated(text)).toBeGreaterThan(0)
  })

  it.each([
    ["the ask in the same function", `${IMPORT_GATE}\nasync function drop(k: string) { if (storageDeletesSkipped()) return\n${SEND} }`],
    [
      "the ask in an enclosing function, the command in a closure",
      `${IMPORT_GATE}\nasync function sweep(keys: string[]) { const skip = storageDeletesSkipped()\nawait Promise.all(keys.map(async (k) => { if (!skip) ${SEND} })) }`,
    ],
    ["an aliased ask", `import { storageDeletesSkipped as off } from "./storage-deletes-setting.js"\nasync function drop(k: string) { if (off()) return\n${SEND} }`],
    ["the ask read off its module", `const setting = await import("./storage-deletes-setting.js")\nasync function drop(k: string) { if (setting.storageDeletesSkipped()) return\n${SEND} }`],
    ["a store's delete method that asks", `${IMPORT_GATE}\nfunction make(client: C) { return { async delete(k: string) { if (storageDeletesSkipped()) return\nawait client.send(new DeleteObjectCommand({ Key: k })) } } }`],
    ["a storage helper (it asks itself)", `import { deleteFromR2, batchDeleteFromR2 } from "./storage.js"\nasync function drop(k: string) { await deleteFromR2(k)\nawait batchDeleteFromR2([k]) }`],
  ])("passes %s", (_name, text) => {
    expect(ungated(text)).toBe(0)
  })
})

describe("STORAGE_DELETES=skip: every storage delete asks the setting first", { timeout: SCAN_TIMEOUT_MS }, () => {
  it("no storage command is sent from a function that never asks storageDeletesSkipped()", () => {
    const ungated: string[] = []
    for (const file of sourceFiles()) {
      if (file.endsWith(".d.ts")) continue
      const text = readFileSync(file, "utf8")
      if (!/DeleteObjects?Command|\bS3\b/.test(text)) continue
      for (const line of ungatedDeleteLines(file, text)) ungated.push(`${relPath(file)}:${line}`)
    }
    expect(ungated, "ask storageDeletesSkipped() (lib/storage-deletes-setting.ts) in the function that sends the delete").toEqual([])
  })

  it("finds the storage helpers' own commands (the scan works)", () => {
    const text = readFileSync(join(SRC, "lib/storage.ts"), "utf8")
    const commands = rawDeleteNodes(parseWithParents("lib/storage.ts", text)).filter((d) => d.kind === "command")
    expect(commands.length).toBeGreaterThanOrEqual(3)
    expect(ungatedDeleteLines("lib/storage.ts", text)).toEqual([])
  })

  it("each listed file is reached by the setting the way it says", () => {
    const wrong: string[] = []
    for (const [file, entry] of Object.entries(RAW_DELETES_ALLOWED)) {
      const sf = parseWithParents(file, readFileSync(join(SRC, file), "utf8"))
      if (entry.setting === "asks") {
        if (!callsGate(sf, gateNames(sf))) wrong.push(`${file}: listed as asking storageDeletesSkipped(), and never does`)
      } else if (rawDeleteNodes(sf).some((d) => d.kind !== "helper")) {
        wrong.push(`${file}: listed as deleting through the storage helpers only, and sends a storage command of its own`)
      }
    }
    expect(wrong).toEqual([])
  })
})
