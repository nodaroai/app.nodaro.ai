/**
 * `@nodaro/sdk/tutorials` — the `tutorials` resource and its types.
 *
 * One of the package's subpath entries (see `src/index.ts`). The root
 * re-exports every entry, so each name here is also importable from
 * `@nodaro/sdk`.
 */
export { TutorialsResource } from "../resources/tutorials.js"

export type {
  TutorialVideoItem,
  TutorialFlowItem,
  TutorialCategory,
} from "../resources/tutorials.js"
