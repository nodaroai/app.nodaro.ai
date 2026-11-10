/**
 * The predicates of the LLM model menus that offer only some models
 * (`LlmModelSelect`'s `filter`). The editor's panels and the new-node rule
 * (`node-model-levers.ts`, run by the editor and the server) read the same
 * function, so a new node starts on a model the panel's menu actually lists.
 */
import { DESCRIBE_TO_PICKER_MODELS, STRUCTURED_VISION_MODELS, type LlmModelDef } from "@nodaro/shared/llm-models"

/** A model that can return schema-shaped output (the content "steal the format" nodes, text only). */
export const structuredOutputModel = (m: Pick<LlmModelDef, "structuredOutputMode">): boolean => m.structuredOutputMode != null

const STRUCTURED_VISION_IDS: ReadonlySet<string> = new Set(STRUCTURED_VISION_MODELS.map((m) => m.id))

/** A vision model with guaranteed structured output (the scrapers' per-ad analysis). */
export const structuredVisionModel = (m: Pick<LlmModelDef, "id">): boolean => STRUCTURED_VISION_IDS.has(m.id)

/** A model Describe to Picker offers (`DESCRIBE_TO_PICKER_MODELS`, the list its route enforces). */
export const describeToPickerModel = (m: Pick<LlmModelDef, "id">): boolean => DESCRIBE_TO_PICKER_MODELS.some((v) => v.id === m.id)
