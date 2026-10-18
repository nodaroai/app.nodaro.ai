/**
 * `@nodaro/sdk/apps` — the `apps` resource and its types.
 *
 * One of the package's subpath entries (see `src/index.ts`). The root
 * re-exports every entry, so each name here is also importable from
 * `@nodaro/sdk`.
 */
export { AppsResource } from "../resources/apps.js"

export type {
  PublishedApp,
  PublishedAppDetail,
  ListAppsParams,
  ListAppsResult,
  AppRunResult,
  RunAppOptions,
  AppRun,
  ListAppRunsParams,
  DeleteAppRunResult,
} from "../resources/apps.js"
