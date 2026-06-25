/**
 * Beeble provider — direct-call vendor (no registry/router).
 *
 * Files:
 * - client.ts  — auth header, base fetch, `BeebleError`, `isBeebleConfigured()`
 * - types.ts   — SwitchX request/response vendor shapes
 * - switchx.ts — `startSwitchXGeneration()` / `getSwitchXStatus()`
 */

export { beebleFetch, BeebleError, isBeebleConfigured } from "./client.js"
export { startSwitchXGeneration, getSwitchXStatus } from "./switchx.js"
export type {
  CreateSwitchXRequest,
  SwitchXStatus,
  SwitchXAlphaMode,
  SwitchXJobStatus,
  SwitchXOutput,
} from "./types.js"
