import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

const SRC = join(__dirname, "..", "..")

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      if (name === "node_modules" || name === "__tests__") continue
      walk(p, out)
    } else if (/\.(ts|tsx)$/.test(name)) {
      out.push(p)
    }
  }
  return out
}

describe("RTL direction guards", () => {
  it("globals.css pins every React Flow canvas LTR", () => {
    const css = readFileSync(join(SRC, "globals.css"), "utf8")
    // The canvas is shared content, not chrome: it must not flip with the
    // locale. One class-scoped rule covers every <ReactFlow> mount, current
    // and future, with no per-site wiring.
    expect(css).toMatch(/\.react-flow\s*\{[^}]*direction:\s*ltr/)
  })

  it("no rtl:/ltr: Tailwind variants anywhere in frontend/src", () => {
    // Tailwind v4 compiles `rtl:` to `&:where(:dir(rtl), [dir="rtl"],
    // [dir="rtl"] *)`. The `[dir="rtl"] *` alternative matches every
    // descendant of <html dir="rtl"> — it pierces the canvas pin (which is
    // CSS `direction`, not a dir attribute) and any dir="ltr" island. Icon
    // flips must read useAppDir() conditionally instead.
    const offenders: string[] = []
    for (const file of walk(SRC)) {
      const text = readFileSync(file, "utf8")
      if (!text.includes("rtl:") && !text.includes("ltr:")) continue // cheap pre-filter
      for (const m of text.matchAll(/["'`\s{(](rtl|ltr):[a-z0-9[-]/g)) {
        offenders.push(`${file}: ${m[0].trim()}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
