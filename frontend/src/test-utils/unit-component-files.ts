// @test-watches frontend/src/nodes/*/{node,config}.tsx
/**
 * Every node unit's canvas component (`node`) or config panel (`config`) —
 * frontend/src/nodes/<type>/{node,config}.tsx (tools/units/README.md) — as
 * paths relative to frontend/src (`nodes/<type>/config.tsx`), sorted.
 *
 * For the source-scanning guards that cover components/nodes/*-node.tsx or
 * components/editor/config-panels/*: a node that becomes a unit moves its
 * component and its panel out of those directories, and a guard that lists
 * only them silently stops seeing it. Discovered at test time, so a new unit
 * is covered the day it lands. Node built-ins only, no `@/` alias.
 */
import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"

/** frontend/src, absolute. */
export const FRONTEND_SRC = join(__dirname, "..")

export function unitComponentFiles(kind: "node" | "config"): string[] {
  const units = join(FRONTEND_SRC, "nodes")
  return readdirSync(units, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("_") && existsSync(join(units, d.name, `${kind}.tsx`)))
    .map((d) => `nodes/${d.name}/${kind}.tsx`)
    .sort()
}
