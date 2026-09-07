import type { ConnectedReference } from "@nodaro/shared"

import type { VoiceDirection } from "./voice-direction"

/**
 * One stage's draft — the free-prose state the studio Composer owns in memory.
 *
 * The DRAFT itself (its localStorage home, its TTL, its pruning) stays in the
 * studio app, where a browser is what makes it possible. Only the shape travels,
 * because the plan exporter takes a draft as an argument: an export is allowed
 * to carry what the user has typed but not yet generated, and that is a fact
 * about the FORMAT, not about the editor.
 */
export interface StageDraft {
  readonly text: string
  readonly negative: string
  /** Bound `@`-entity chips — restored via the same setter path a seed uses,
   *  so the editor rebuilds them as chips. */
  readonly references: ReadonlyArray<ConnectedReference>
  /** Directing-only: the `/` voice-direction chips. */
  readonly directions?: ReadonlyArray<VoiceDirection>
  /** Framing-only: the manual reference-strip urls. */
  readonly extraRefs?: ReadonlyArray<string>
}
