/**
 * `@nodaro/sdk/developer-apps` — the `developer-apps` resource and its types.
 *
 * One of the package's subpath entries (see `src/index.ts`). The root
 * re-exports every entry, so each name here is also importable from
 * `@nodaro/sdk`.
 */
export { DeveloperAppsResource } from "../resources/developer-apps.js"

export type {
  DeveloperApp,
  DeveloperAppScope,
  DeveloperAppStatus,
  DeveloperAppKind,
  CreateDeveloperAppInput,
  UpdateDeveloperAppInput,
  CreateDeveloperAppResult,
  RotateSecretResult,
} from "../resources/developer-apps.js"
