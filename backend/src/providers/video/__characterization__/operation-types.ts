// The shapes of the characterization harness's operations (operations.ts), in a
// module of their own so a node unit's characterize.char.ts can type its
// operation without importing the harness that composes it.
import type { FixtureSet } from "./fixtures.js"
import type { Tolerances } from "./compare.js"

export interface RenderedOutput {
  readonly label: string
  readonly path: string
  readonly kind: "audio" | "video" | "image"
}

export interface OperationResult {
  readonly outputs: readonly RenderedOutput[]
  readonly cleanupDirs: readonly string[]
}

export interface CharacterizedOperation {
  readonly name: string
  readonly tier: 1 | 2 | 3
  /** Per-op tolerance overrides — each MUST carry a comment saying why. */
  readonly tolerances?: Partial<Tolerances>
  readonly run: (f: FixtureSet) => Promise<OperationResult>
}

/**
 * A node unit's characterization operation (backend/src/nodes/<type>/characterize.char.ts,
 * exported as `characterization`; tools/units/README.md). The harness names it by the
 * unit's type — its golden key — and places it right after the operation `after`
 * names (null = first; a name that is no operation throws — placeAfter).
 */
export type UnitCharacterization = Omit<CharacterizedOperation, "name"> & { readonly after: string | null }
