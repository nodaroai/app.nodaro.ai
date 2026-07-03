import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { resolveBrand, resolveBodyType } from "../../lib/brand"

const BLUEPRINT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..")

function blueprintFiles(): string[] {
  return readdirSync(BLUEPRINT_DIR)
    .filter((f) => f.endsWith(".tsx"))
    .filter((f) => !["types.tsx"].includes(f))
}

describe("blueprint brand-fill adoption (drift guard)", () => {
  it("no blueprint hardcodes FONT_MAP[\"Montserrat\"] — all use blueprintFontFamily(brand)", () => {
    const offenders: string[] = []
    for (const f of blueprintFiles()) {
      const src = readFileSync(join(BLUEPRINT_DIR, f), "utf8")
      if (src.includes('FONT_MAP["Montserrat"]')) offenders.push(f)
    }
    expect(offenders).toEqual([])
  })

  it("every blueprint that renders text resolves its font family via blueprintFontFamily(brand) or the typography resolvers", () => {
    const missing: string[] = []
    for (const f of blueprintFiles()) {
      const src = readFileSync(join(BLUEPRINT_DIR, f), "utf8")
      // Every current blueprint (all 13) renders text. Since Task 6 that font
      // family came from blueprintFontFamily(brand); since the typography-ramp
      // task (Task 7), migrated blueprints instead go through
      // resolveHeadingType(brand, ...)/resolveBodyType(brand, ...) — those
      // wrappers call blueprintFontFamily/resolveFontStack internally
      // (lib/brand.ts), so they carry the same guarantee and never spell out
      // a literal `fontFamily` property in the blueprint's own source. A
      // blueprint with none of these three markers has regressed to a raw
      // hardcoded font family.
      const resolvesFamily =
        src.includes("blueprintFontFamily(brand)") ||
        src.includes("resolveHeadingType(brand") ||
        src.includes("resolveBodyType(brand")
      if (!resolvesFamily) missing.push(f)
    }
    expect(missing).toEqual([])
  })

  it("every blueprint uses resolveBlueprintAccent(...) instead of inlining the accent fallback chain", () => {
    // All 13 current blueprints reference an accent color; verified by grep before
    // writing this test. A future blueprint that inlines `?? brand.palette?.accent`
    // instead of calling the shared helper would silently fork the precedence rule
    // (explicit param → brand accent → hardcoded default) — this scan catches it.
    const missing: string[] = []
    for (const f of blueprintFiles()) {
      const src = readFileSync(join(BLUEPRINT_DIR, f), "utf8")
      if (!src.includes("resolveBlueprintAccent")) missing.push(f)
    }
    expect(missing).toEqual([])
  })
})

describe("special blueprints (Task 8) — typography routing + KEEP allowlist (drift guard)", () => {
  // The 6 "special" blueprints classified in the Task 8 brief. Each has one or
  // more HEADING/BODY lines routed through resolveHeadingType/resolveBodyType,
  // and — for 3 of them — exactly one KEEP line that is deliberately left
  // hardcoded (never routed). This scan is read-only static source inspection,
  // matching the rest of this file's style (no render harness).
  const SPECIAL_BLUEPRINTS = [
    "cta-morph-press.tsx",
    "dataviz-countup.tsx",
    "logo-assemble-lockup.tsx",
    "overwhelm-surround.tsx",
    "spatial-pan-stations.tsx",
    "ticker-takeover.tsx",
  ]

  // Explicit allowlist of the ONLY lines permitted to keep a raw `fontWeight: <n>`
  // literal in these 6 files, each with the exact count expected in the file's
  // current source. Editing this file to remove an entry WITHOUT also routing
  // that line through a resolver leaves the raw literal in place, so the actual
  // count in the "no unrouted raw literals" test below no longer matches the
  // (now-lower) expected count for that file and the test fails. Conversely, if
  // a routed (non-KEEP) line regresses to a raw `fontWeight: <n>` literal, the
  // actual count exceeds this map's value and the test fails too.
  const KEEP_ALLOWLIST: Record<string, { count: number; lines: string[] }> = {
    "overwhelm-surround.tsx": { count: 1, lines: ["density marker (fontWeight: 500)"] },
    "spatial-pan-stations.tsx": { count: 1, lines: ["leg counter \"N / M\" (fontWeight: 500)"] },
    "ticker-takeover.tsx": { count: 1, lines: ["cycling options (fontWeight: 700)"] },
  }

  // Exact number of resolveHeadingType(brand.../resolveBodyType(brand... call
  // sites expected in each file's source — one per classified (non-KEEP) text
  // line (spatial-pan-stations' station label ternary is inlined into the
  // `weight` arg of a single resolveHeadingType call, so it contributes just
  // 1 occurrence for its 1 line).
  const EXPECTED_RESOLVER_CALLS: Record<string, number> = {
    "cta-morph-press.tsx": 2, // button label (H) + sublabel (B)
    "dataviz-countup.tsx": 3, // number (H) + label (B) + sublabel (B)
    "logo-assemble-lockup.tsx": 2, // brand letters (H) + tagline (B)
    "overwhelm-surround.tsx": 3, // subject (H) + surface card (B) + demand bubble (B)
    "spatial-pan-stations.tsx": 2, // timeline/web label, weight ternary inlined (H) + sublabel (B)
    "ticker-takeover.tsx": 2, // hero (H) + lead-in (B)
  }

  function resolverCallCount(src: string): number {
    const heading = src.match(/resolveHeadingType\(brand/g) ?? []
    const body = src.match(/resolveBodyType\(brand/g) ?? []
    return heading.length + body.length
  }

  it("every classified (non-KEEP) line resolves through resolveHeadingType(brand.../resolveBodyType(brand... — exact call-site count per file", () => {
    for (const f of SPECIAL_BLUEPRINTS) {
      const src = readFileSync(join(BLUEPRINT_DIR, f), "utf8")
      expect(resolverCallCount(src), `${f}: unexpected resolver call-site count`).toBe(
        EXPECTED_RESOLVER_CALLS[f],
      )
    }
  })

  it("only KEEP_ALLOWLIST lines keep a raw fontWeight literal — everything else must route through a resolver", () => {
    for (const f of SPECIAL_BLUEPRINTS) {
      const src = readFileSync(join(BLUEPRINT_DIR, f), "utf8")
      const rawWeights = src.match(/fontWeight:\s*\d+/g) ?? []
      const expected = KEEP_ALLOWLIST[f]?.count ?? 0
      expect(
        rawWeights.length,
        `${f}: expected ${expected} raw fontWeight literal(s) (KEEP_ALLOWLIST only), found ${rawWeights.length}. ` +
          `If you just routed a KEEP line, remove it from KEEP_ALLOWLIST. If you just added a raw literal, route it instead.`,
      ).toBe(expected)
    }
  })

  it("none of the 6 special blueprints has a raw letterSpacing/textTransform literal (all routed via resolver fallbacks, KEEP lines included)", () => {
    // Distinct from the fontWeight check: none of the 3 KEEP lines in these
    // files ever had a hardcoded letterSpacing/textTransform, so — unlike
    // fontWeight — the expected count here is zero for every file.
    for (const f of SPECIAL_BLUEPRINTS) {
      const src = readFileSync(join(BLUEPRINT_DIR, f), "utf8")
      const rawLetterSpacing = src.match(/letterSpacing:\s*["']/g) ?? []
      const rawTextTransform = src.match(/textTransform:\s*["']/g) ?? []
      expect(rawLetterSpacing.length, `${f}: raw letterSpacing literal found`).toBe(0)
      expect(rawTextTransform.length, `${f}: raw textTransform literal found`).toBe(0)
    }
  })

  it("byte-identical: the two casing:\"uppercase\" fallback sites keep textTransform:\"uppercase\" with no brand", () => {
    // (a) Source-level guard: the exact fallback object for each of the two
    // known uppercase call sites (dataviz-countup's label, logo-assemble-lockup's
    // tagline) still spells out casing: "uppercase" tied to its weight/tracking.
    const datavizSrc = readFileSync(join(BLUEPRINT_DIR, "dataviz-countup.tsx"), "utf8")
    const labelCall = /resolveBodyType\(\s*brand,\s*label,\s*\{[^}]*\}\s*\)/s.exec(datavizSrc)
    expect(labelCall, "dataviz-countup.tsx: label's resolveBodyType(brand, label, {...}) call not found").not.toBeNull()
    expect(labelCall![0]).toContain('casing: "uppercase"')
    expect(labelCall![0]).toContain("weight: 400")

    const logoSrc = readFileSync(join(BLUEPRINT_DIR, "logo-assemble-lockup.tsx"), "utf8")
    const taglineCall = /resolveBodyType\(\s*brand,\s*tagline[^,]*,\s*\{[^}]*\}\s*\)/s.exec(logoSrc)
    expect(taglineCall, 'logo-assemble-lockup.tsx: tagline\'s resolveBodyType(brand, tagline ?? "", {...}) call not found').not.toBeNull()
    expect(taglineCall![0]).toContain('casing: "uppercase"')
    expect(taglineCall![0]).toContain("weight: 300")

    // (b) Computed guard: actually resolve both fallbacks with NO brand tokens
    // (the byte-identical path — resolveBrand(undefined, ...)) and confirm the
    // uppercase transform survives untouched.
    const noBrand = resolveBrand(undefined, "#000")
    const datavizLabel = resolveBodyType(noBrand, "some label", {
      weight: 400,
      tracking: "0.06em",
      casing: "uppercase",
    })
    expect(datavizLabel.textTransform).toBe("uppercase")
    const logoTagline = resolveBodyType(noBrand, "some tagline", {
      weight: 300,
      tracking: "0.12em",
      casing: "uppercase",
    })
    expect(logoTagline.textTransform).toBe("uppercase")
  })
})
