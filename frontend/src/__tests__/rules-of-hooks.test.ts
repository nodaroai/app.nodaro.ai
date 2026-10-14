// @test-watches frontend/src/**/*.{ts,tsx}
import { describe, expect, it } from "vitest"
import { ESLint } from "eslint"
import reactHooks from "eslint-plugin-react-hooks"
import tseslint from "typescript-eslint"

/**
 * Every hook call obeys the rules of hooks — no hook after an early return,
 * none inside a condition or a loop. A hook placed after a component's
 * loading `return` exists only once the data has arrived, so the hook count
 * changes between renders and React throws #310: the Admin → Users page did
 * exactly that on staging on 2026-10-13, and nothing caught it because the
 * full lint is not a CI job and the rule was not configured.
 *
 * This runs ONE rule over the whole source through the ESLint API, so it is
 * independent of the rest of the lint's debt (the recommended set has
 * thousands of open findings) and of whether anyone runs `npm run lint`.
 * Test files are left out: a hook called inside a test helper is how
 * `renderHook` is used.
 *
 * KNOWN is the burn-down: the findings that predate the rule, by file, with
 * how many that file carries. It only shrinks. A file not on it, or more
 * findings than it lists, fails the build; a file that no longer has them
 * fails too, so the entry is removed and the debt stays honest. Most of
 * these hooks follow an edition gate (`if (!hasCredits()) return`) — a
 * build-time constant, so the count never changes at run time — but the
 * rule cannot know that, and each is a wait for a real one to hide behind.
 */

const KNOWN: Readonly<Record<string, number>> = {
  "src/app/pricing/page.tsx": 11,
  "src/components/editor/location-studio/environmental-asset-tab.tsx": 3,
  "src/components/editor/location-studio/motion-tab.tsx": 3,
  "src/components/editor/media-editor/crop-panel.tsx": 10,
  "src/components/presentation/restrict-popover.tsx": 2,
}

describe("rules of hooks", () => {
  it("no NEW hook is called conditionally or after a return; the known debt only shrinks", async () => {
    const eslint = new ESLint({
      cwd: process.cwd(),
      overrideConfigFile: true,
      overrideConfig: [
        {
          files: ["src/**/*.{ts,tsx}"],
          ignores: ["src/**/__tests__/**", "src/**/*.test.{ts,tsx}", "src/test/**"],
          languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
          // The plugin ships its own rule types, which ESLint's `Plugin` type does not name; the cast is the usual bridge.
          plugins: { "react-hooks": reactHooks as unknown as ESLint.Plugin },
          rules: { "react-hooks/rules-of-hooks": "error" },
        },
      ],
    })
    const results = await eslint.lintFiles(["src/**/*.{ts,tsx}"])
    const counts = new Map<string, number>()
    const where: string[] = []
    for (const r of results) {
      const findings = r.messages.filter((m) => m.ruleId === "react-hooks/rules-of-hooks")
      if (!findings.length) continue
      const rel = r.filePath.replaceAll("\\", "/").split("/frontend/")[1] ?? r.filePath
      counts.set(rel, findings.length)
      for (const m of findings) where.push(`${rel}:${m.line}  ${m.message.replace(/ React Hooks must.*$/, "")}`)
    }

    const unexpected = [...counts].filter(([file, n]) => n > (KNOWN[file] ?? 0)).map(([file, n]) => `${file}: ${n} (allowed ${KNOWN[file] ?? 0})`)
    expect(unexpected, `New rules-of-hooks findings — move the hook above every return:\n${where.join("\n")}`).toEqual([])

    const paidDown = Object.keys(KNOWN).filter((file) => (counts.get(file) ?? 0) < KNOWN[file]!)
    expect(paidDown, "These files now carry fewer findings than KNOWN lists — lower or remove their entries").toEqual([])
  }, 300_000)
})
