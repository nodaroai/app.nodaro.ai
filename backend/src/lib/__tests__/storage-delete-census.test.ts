import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import ts from "typescript"
import { parseText, relPath, SCAN_TIMEOUT_MS, sourceFiles } from "./source-scan.js"

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
 */
const RAW_DELETES_ALLOWED: Readonly<Record<string, { count: number; why: string }>> = {
  "lib/storage.ts": { count: 2, why: "the delete helpers themselves: the two storage commands they send (a definition is not a use)" },
  "lib/storage-delete.ts": { count: 2, why: "the funnel: it deletes, then records what failed" },
  "lib/storage-delete-retries.ts": { count: 1, why: "the retry pass: a failure counts an attempt on the existing record" },
  "lib/speaker-frames-cache-sweep.ts": {
    count: 1,
    why: "an age sweep that re-lists its prefix every day: a key it failed to delete is listed and deleted again next run",
  },
  "ee/billing/cleanup-service.ts": {
    count: 1,
    why: "the `*-tmp/` prefix sweeps re-list their prefix every day: a key they failed to delete is listed again next run",
  },
  "lib/retained-images.ts": {
    count: 1,
    why: "retained images have their own durable collection queue (`claim_retained_image_gc`): a task is completed only after its delete, so a failure is claimed again",
  },
  "lib/retained-videos.ts": {
    count: 1,
    why: "retained videos: the same durable collection queue as retained images",
  },
  "services/scene3d-artifacts/object-store.ts": {
    count: 1,
    why: "a separate bucket with its own artifact cleanup lane; the retry pass deletes from the media bucket only",
  },
}

/** The raw storage-delete primitives, by their exported names. */
const PRIMITIVES = new Set(["deleteFromR2", "batchDeleteFromR2", "DeleteObjectCommand", "DeleteObjectsCommand"])
/** The aggregated SDK client: it deletes without any of the primitives above. */
const AGGREGATED_CLIENT = "S3"

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
 * How many raw storage deletes `text` makes: every use of a primitive under
 * any local name it is bound to, every property or element read of a
 * primitive's name (a module namespace, a dynamic import), and every import
 * of the aggregated client.
 */
export function rawDeleteUses(file: string, text: string): number {
  // Parent pointers on: a use is told from a declaration by its parent. Only
  // the few files that name a primitive get here (`rawDeletes`' pre-filter).
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const local = new Set(PRIMITIVES)
  let count = 0
  const bind = (n: ts.Node): void => {
    // import { deleteFromR2 as drop } / const { deleteFromR2: drop } = await import(...)
    if (ts.isImportSpecifier(n) && PRIMITIVES.has((n.propertyName ?? n.name).text)) local.add(n.name.text)
    if (ts.isImportSpecifier(n) && (n.propertyName ?? n.name).text === AGGREGATED_CLIENT) count++
    if (
      ts.isBindingElement(n) &&
      n.propertyName &&
      ts.isIdentifier(n.propertyName) &&
      PRIMITIVES.has(n.propertyName.text) &&
      ts.isIdentifier(n.name)
    ) {
      local.add(n.name.text)
    }
    ts.forEachChild(n, bind)
  }
  bind(sf)
  const visit = (n: ts.Node): void => {
    if (ts.isIdentifier(n)) {
      const p = n.parent
      if (ts.isPropertyAccessExpression(p) && p.name === n) {
        if (PRIMITIVES.has(n.text)) count++
      } else if (local.has(n.text) && !isDeclarationName(n) && !ts.isTypeQueryNode(p)) {
        // (`typeof batchDeleteFromR2` in a type is not a call.)
        count++
      }
    } else if (
      ts.isElementAccessExpression(n) &&
      ts.isStringLiteralLike(n.argumentExpression) &&
      PRIMITIVES.has(n.argumentExpression.text)
    ) {
      count++
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return count
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
      "ee/services/community/clone.ts",
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
