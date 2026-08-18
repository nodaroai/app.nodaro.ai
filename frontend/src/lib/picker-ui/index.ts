/**
 * Picker UI — animated previews, rich single/multi-dim pickers, the
 * @-mention prompt editor, and the parameter-picker registry.
 *
 * One implementation for every edition: the in-repo workspace package
 * `@nodaro/picker-ui` (packages/picker-ui/). The build-time two-lane seam
 * that used to live here (private registry package vs a functional stub)
 * was collapsed in #748 — the only closed surface is the backend's
 * `@nodaroai/cloud-plugins`. Wiring DATA still comes from `@nodaro/prompts`
 * (`picker-wiring.ts`) — single source of truth.
 *
 * App code imports from here (`@/lib/picker-ui`) so call sites stay stable.
 */
export * from "@nodaro/picker-ui"

import "@nodaro/picker-ui/styles.css"
