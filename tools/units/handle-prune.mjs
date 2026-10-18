// tools/units/handle-prune.mjs — gen:units removes the node units' rows from gen:skills'
// legacy handle table (decided 2026-10-18). Built-ins only: it runs in gen:units' own process.
//
// backend/src/lib/mcp/generated/node-handles.ts lists LEGACY nodes only (gen:skills'
// renderNodeHandlesModule drops units), and backend/src/lib/node-handles.ts throws when a
// type is both a table row and a unit. Converting a node into a unit therefore leaves a
// stale row that gen:skills itself cannot get past: its static imports reach
// lib/node-handles.ts (render-skill → credit-line → node-registry) and throw before it
// re-renders the table. gen:units runs first (`npm run gen`), so it deletes those rows.
//
// It only ever deletes rows of unit types — rows gen:skills never writes — so the two
// generators agree on the file and gen:skills then rewrites nothing. That is why the
// table is a prune target, not one of GEN_UNITS_OUTPUTS (gen:units never renders it).

/** The gen:skills table gen:units prunes (repo-relative). */
export const NODE_HANDLES_TABLE = "backend/src/lib/mcp/generated/node-handles.ts"

/** Every path gen:units may prune rows from (never render). */
export const GEN_UNITS_PRUNES = [NODE_HANDLES_TABLE]

// One table row as renderNodeHandlesModule writes it: `  "<type>": { inputs: […], outputs: […] },`
const ROW = /^ {2}"([^"]+)": \{ inputs: \[.*\], outputs: \[.*\] \},$/

/** `source` without the rows of the types in `unitTypes`; every other byte kept. */
export function pruneUnitRows(source, unitTypes) {
  return source
    .split("\n")
    .filter((line) => {
      const m = ROW.exec(line)
      return !(m && unitTypes.has(m[1]))
    })
    .join("\n")
}
