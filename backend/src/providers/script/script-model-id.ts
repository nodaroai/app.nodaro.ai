/**
 * The model a Generate Script call runs on — the one shared rule
 * (`@nodaro/shared/llm-models` `resolveScriptModelId`), re-exported here for the
 * backend's callers: the route, the worker's request builder, the DAG step and
 * the billing estimator.
 */
export { resolveScriptModelId } from "@nodaro/shared/llm-models"
export type { ScriptProvider } from "@nodaro/shared/models"
