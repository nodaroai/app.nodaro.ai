import { readdirSync, readFileSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import ts from "typescript"

const root = join(dirname(fileURLToPath(import.meta.url)), "../..")
function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "__tests__") return []
    const path = join(dir, entry.name)
    return entry.isDirectory() ? files(path) : path.endsWith(".ts") ? [path] : []
  })
}
describe("physical object deletion boundaries", () => {
  it("requires every new S3 delete site to account for retained image protection", () => {
    const counts: Record<string, number> = {}
    for (const path of files(root)) {
      const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true)
      const visit = (node: ts.Node) => {
        if (ts.isNewExpression(node) && /^(DeleteObjectCommand|DeleteObjectsCommand)$/.test(node.expression.getText(source))) {
          const file = relative(root, path)
          counts[file] = (counts[file] ?? 0) + 1
        }
        ts.forEachChild(node, visit)
      }
      visit(source)
    }
    expect(counts).toEqual({
      // Ordinary single/batch deletes reject the reserved namespace.
      "lib/storage.ts": 2,
      // Only claimed tombstones can enter this exceptional delete lane.
      "lib/retained-images.ts": 1,
      // Independently configured private bucket; cannot be the public bucket.
      "services/scene3d-artifacts/object-store.ts": 1,
    })
  })
})
