import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

/**
 * A query that FILTERS by workspace must also be KEYED by it.
 *
 * This exists because the fourth review of this work found the defect the
 * whole design was written to prevent, in the file that carries the comment
 * warning about it: the editor search filtered by workspace and cached by the
 * search text alone, so the same word typed in a second class returned the
 * first one's results. Every mutation test passed — they checked that the key
 * and the filter EXISTED, not that they agreed.
 *
 * Two rules, both derived from the code rather than from a list:
 *
 *   A. A file that filters by `workspace_id` must take the value from the
 *      scope seam, not read it ad hoc. That call is also the subscription and
 *      the wait, so obtaining it any other way silently drops both.
 *   B. In such a file, every cache key must carry the workspace.
 *
 * `// scope-key-ok: <reason>` exempts one key — for a query in a scoped file
 * whose own answer genuinely does not vary by workspace. It is recognised on
 * the key line OR in the comment block directly above it, because that is
 * where anyone writing a reason naturally puts it. The first version of this
 * rule only looked FORWARD from the key line and rejected every exemption
 * written the normal way; the same off-by-a-direction mistake had already
 * shipped in the sibling guard on the server.
 */

const ROOT = join(__dirname, "..", "..")
// A CALL, not a mention. The first version matched the name anywhere in the
// file, so deleting the call and leaving the import behind satisfied it —
// which is exactly the shape the mistake takes.
const SEAM = [/\buseWorkspaceScope\s*\(/, /\bawaitWorkspaceScope\s*\(/]
const EXEMPTION = /\/\/\s*scope-key-ok:\s*\S/

/** Comments out, code only — a rule a comment can satisfy protects comments. */
function codeOnly(src: string): string {
  return src
    .replace(/\r/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => {
      const at = l.indexOf("//")
      return at === -1 ? l : l.slice(0, at)
    })
    .join("\n")
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "__tests__") continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.tsx?$/.test(name)) out.push(full)
  }
  return out
}

interface ScopedFile {
  readonly path: string
  readonly rel: string
  readonly src: string
  readonly code: string
}

function scopedFiles(): ScopedFile[] {
  const out: ScopedFile[] = []
  for (const path of walk(ROOT)) {
    const src = readFileSync(path, "utf8")
    const code = codeOnly(src)
    // A real filter, not the word appearing in a type or a comment.
    if (!/\.(eq|is)\(\s*"workspace_id"/.test(code)) continue
    out.push({ path, rel: path.replace(/\\/g, "/").split("/src/")[1] ?? path, src, code })
  }
  return out
}

describe("a query that filters by workspace is keyed by it", () => {
  const files = scopedFiles()

  it("finds the scoped files at all — a silent zero would pass vacuously", () => {
    expect(files.length).toBeGreaterThanOrEqual(5)
    expect(files.map((f) => f.rel)).toContain("components/editor/search-modal.tsx")
  })

  it("A: every one of them takes the scope from the seam", () => {
    // Reading the store directly skips the subscription AND the wait: the
    // component never re-renders on a switch, and it answers "personal" while
    // the remembered class is still being confirmed.
    const adHoc = files
      .filter((f) => !SEAM.some((re) => re.test(f.code)))
      .map((f) => f.rel)
    expect(adHoc, "filters by workspace without going through the scope seam").toEqual([])
  })

  it("B: every cache key in them carries the workspace", () => {
    const offenders: string[] = []
    for (const f of files) {
      const lines = f.src.replace(/\r/g, "").split("\n")
      lines.forEach((line, i) => {
        if (!/^\s*queryKey:/.test(line)) return
        // A key may span several lines; read to the balanced end.
        let depth = 0
        let text = ""
        for (let j = i; j < lines.length; j++) {
          text += lines[j] + "\n"
          depth += (lines[j].match(/[[(]/g) || []).length - (lines[j].match(/[\])]/g) || []).length
          if (depth <= 0 && j > i) break
          if (depth <= 0 && /,\s*$/.test(lines[j])) break
        }
        // The comment block directly above the key counts as well as the key
        // line itself — see the note at the top of this file.
        const above = lines.slice(Math.max(0, i - 6), i).join("\n")
        if (EXEMPTION.test(text) || EXEMPTION.test(above)) return
        if (/workspaceId|workspace_id/.test(text)) return
        offenders.push(`${f.rel}:${i + 1}`)
      })
    }
    expect(offenders, "keys that ignore a workspace their query filters by").toEqual([])
  })

  it("rule A wants a CALL, not an unused import", () => {
    // Pins what survived the first mutation run: an import left behind after
    // the call was deleted read as compliance.
    const importOnly = 'import { useWorkspaceScope } from "@/hooks/use-workspace-scope"'
    expect(SEAM.some((re) => re.test(importOnly))).toBe(false)
    expect(SEAM.some((re) => re.test("const x = useWorkspaceScope()"))).toBe(true)
  })

  it("recognises an exemption written above the key, not only beside it", () => {
    // Pins the direction. A rule that only reads forward silently rejects
    // every reason written the way a person writes one.
    const above = ["  // scope-key-ok: because", "  queryKey: someKey,"].join("\n")
    expect(EXEMPTION.test(above.split("\n")[0])).toBe(true)
  })

  it("the comment stripper works — this rule leans on it entirely", () => {
    expect(codeOnly('a // .eq("workspace_id")').trim()).toBe("a")
    expect(codeOnly('/*\n.eq("workspace_id")\n*/')).not.toContain("workspace_id")
    expect(codeOnly("keep\r\n// drop\r\nkeep2")).toBe("keep\n\nkeep2")
  })
})
