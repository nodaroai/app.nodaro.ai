/**
 * `@nodaro/sdk/projects` — the `projects` resource and its types.
 *
 * One of the package's subpath entries (see `src/index.ts`). The root
 * re-exports every entry, so each name here is also importable from
 * `@nodaro/sdk`.
 */
export { ProjectsResource } from "../resources/projects.js"

export type {
  Project,
  CreateProjectInput,
  UpdateProjectInput,
} from "../resources/projects.js"
