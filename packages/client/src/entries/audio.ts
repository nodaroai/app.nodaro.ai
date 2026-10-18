/**
 * `@nodaro/sdk/audio` — the `audio` resource and its types.
 *
 * One of the package's subpath entries (see `src/index.ts`). The root
 * re-exports every entry, so each name here is also importable from
 * `@nodaro/sdk`.
 */
export { AudioResource } from "../resources/audio.js"

export type { TranscribeWord, TranscribeJobOutput, TranscribeProvider } from "../resources/audio.js"
