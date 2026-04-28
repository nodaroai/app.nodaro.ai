/**
 * Shim that re-exports prompt-template helpers from the shared package so
 * backend routes and the DAG orchestrator share a single source of truth.
 *
 * Historically this file had its own copy of the templates which drifted from
 * `packages/shared/src/prompt-templates.ts` and caused DAG parity bugs (e.g.
 * orchestrator producing empty face prompts because `"face-generation"` was
 * only defined here).
 */

import {
  DEFAULT_TEMPLATES,
  resolveTemplate,
  applyTemplate,
} from "@nodaro/shared"

export const SYSTEM_PROMPT_TEMPLATES = DEFAULT_TEMPLATES
export { resolveTemplate, applyTemplate }
