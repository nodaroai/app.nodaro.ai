import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

/**
 * Content-free contract guard for @nodaro/prompts (FSL-1.1-Apache-2.0).
 *
 * Every published version of this package is an IRREVOCABLE grant, so it must
 * carry no deployment-specific prompt content and no machinery that switches
 * prompt output on the deployment's environment. A fixed clause a deployment
 * folds into prompts (a "modesty" clause, a brand-safety negative, a forced
 * vocal gender) is the DEPLOYMENT's own content: it lives in that deployment's
 * registered `PromptPolicy` module (backend/src/lib/prompt-policy.ts — applied
 * server-side, after this package's pure assembly runs), never in this package
 * and never read from `process.env` inside this package.
 *
 * The concrete, generic signature of a violation is a `process.env` read in the
 * package source: it is how the earlier fork gated a clause
 * (`process.env.<FLAG> === "true"`), and a published package that branches on a
 * deployment env var is by construction carrying deployment behavior. This is a
 * capability/invariant guard, not a customer-symbol denylist — it names no
 * deployment and stays correct as new prompt content is added.
 *
 * __tests__ is excluded (never bundled at runtime; and a guard necessarily
 * mentions the pattern it forbids).
 */
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return name === "__tests__" ? [] : walk(p)
    return p.endsWith(".ts") ? [p] : []
  })
}

// packages/prompts/src/__tests__ -> packages/prompts/src
const SRC_DIR = join(__dirname, "..")

describe("content-free contract", () => {
  it("no prompts source file reads process.env (deployment content must live in a registered PromptPolicy, not this package)", () => {
    const offenders = walk(SRC_DIR).filter((f) =>
      /process\s*\.\s*env\b/.test(readFileSync(f, "utf8")),
    )
    expect(offenders).toEqual([])
  })
})
