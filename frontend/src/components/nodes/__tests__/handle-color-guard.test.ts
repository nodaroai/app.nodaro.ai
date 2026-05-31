import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

/**
 * Drift guard: every `HandleWithPopover` must take its `color` from the
 * canonical `HANDLE_COLORS` map (or the `TEXT_HANDLE_COLOR` alias) — never a
 * hardcoded hex. This is what permanently prevents handle/edge colors from
 * drifting away from their data type (the bug class we kept hitting).
 */
const NODES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..")
const HEX_COLOR_ON_HANDLE = /color="#[0-9A-Fa-f]{3,8}"/

describe("handle color guard", () => {
  it("no HandleWithPopover hardcodes a hex color (must use HANDLE_COLORS)", () => {
    const offenders: string[] = []
    for (const file of readdirSync(NODES_DIR).filter((f) => f.endsWith(".tsx"))) {
      const src = readFileSync(join(NODES_DIR, file), "utf8")
      src.split("\n").forEach((line, i) => {
        if (line.includes("HandleWithPopover") && HEX_COLOR_ON_HANDLE.test(line)) {
          offenders.push(`${file}:${i + 1}  ${line.trim().slice(0, 90)}`)
        }
      })
    }
    expect(offenders, `Use HANDLE_COLORS.<type> instead of a hex on these handles:\n${offenders.join("\n")}`).toEqual([])
  })
})
