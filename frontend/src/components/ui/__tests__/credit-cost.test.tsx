import { describe, it, expect, vi, afterEach } from "vitest"
import { render, cleanup } from "@testing-library/react"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const editionMock = vi.hoisted(() => ({ hasCredits: vi.fn() }))
vi.mock("@/lib/edition", () => editionMock)

import { CreditCost, CreditGate } from "../credit-cost"

afterEach(() => {
  cleanup()
  editionMock.hasCredits.mockReset()
})

describe("CreditCost — the edition gate lives in the component (#645)", () => {
  it("renders the figure on editions with a credit system", () => {
    editionMock.hasCredits.mockReturnValue(true)
    const { container } = render(<CreditCost credits={12} />)
    expect(container.textContent).toBe("12 CR")
  })

  it("renders NOTHING on an edition without credits — community must never see a credit figure", () => {
    editionMock.hasCredits.mockReturnValue(false)
    const { container } = render(<CreditCost credits={12} suffix="CR/run" prefix=" · " icon="sm" />)
    expect(container.innerHTML).toBe("")
  })

  it("carries prefix/suffix inside the gate and defaults nullish credits to 0", () => {
    editionMock.hasCredits.mockReturnValue(true)
    const { container } = render(<CreditCost credits={undefined} prefix=" · " suffix="CR/run" />)
    expect(container.textContent).toBe(" · 0 CR/run")
  })

  it("CreditGate hides bespoke credit layouts the same way", () => {
    editionMock.hasCredits.mockReturnValue(false)
    const { container } = render(
      <CreditGate>
        <div>Credits used</div>
      </CreditGate>,
    )
    expect(container.innerHTML).toBe("")
    editionMock.hasCredits.mockReturnValue(true)
    const { container: on } = render(
      <CreditGate>
        <div>Credits used</div>
      </CreditGate>,
    )
    expect(on.textContent).toBe("Credits used")
  })
})

// ---------------------------------------------------------------------------
// The scan half of the invariant. Nine sites hand-rolled `{x.estimatedCredits}
// CR` and per-site hasCredits() guards kept being forgotten — two of the
// misses were in files that already gated OTHER lines. This walks the source
// tree and fails when a credits-named value is interpolated next to a "CR"
// label outside the shared component, so the ONLY way to render a credit
// figure is through <CreditCost>, which is gated by construction.
//
// ee/ is exempt: that tree is cloud-only by definition and never ships in a
// community bundle.
// ---------------------------------------------------------------------------

const FRONTEND_SRC = join(__dirname, "../../..")

/** JSX `{…credits…} CR` or template `` ${…credits…} CR `` on one line. */
const RAW_CREDIT_RENDER = /[${]\{[^{}\n]*credits[^{}\n]*\}\s*CR\b/i

/**
 * A flagged line is accepted when it is provably gated:
 *  - it carries its own `hasCredits()` check inline (the string-building
 *    pattern in select-item labels), or
 *  - it (or the line above) carries a `credit-gated:` annotation naming the
 *    boundary that gates it (a self-gated formatter, the Cost tab's mount
 *    gate). The annotation is the documented escape hatch — a reviewer sees
 *    the justification next to the interpolation.
 */
function isJustified(line: string, prevLine: string | undefined): boolean {
  return (
    line.includes("hasCredits()") ||
    line.includes("credit-gated:") ||
    (prevLine?.includes("credit-gated:") ?? false)
  )
}

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === "ee" || entry === "__tests__" || entry === "node_modules") continue
      yield* walk(full)
    } else if (/\.(tsx|ts)$/.test(entry)) {
      yield full
    }
  }
}

describe("no credit figure is rendered outside the shared component", () => {
  it("scans frontend/src for hand-rolled credit interpolations", () => {
    const offenders: string[] = []
    for (const file of walk(FRONTEND_SRC)) {
      if (file.endsWith("credit-cost.tsx")) continue
      const lines = readFileSync(file, "utf8").split("\n")
      lines.forEach((line, i) => {
        if (RAW_CREDIT_RENDER.test(line) && !isJustified(line, lines[i - 1])) {
          offenders.push(`${relative(FRONTEND_SRC, file)}:${i + 1}  ${line.trim()}`)
        }
      })
    }
    expect(
      offenders,
      `Render credit figures through <CreditCost> (components/ui/credit-cost.tsx) — it edition-gates itself. Hand-rolled interpolations found:\n${offenders.join("\n")}`,
    ).toEqual([])
  })
})
