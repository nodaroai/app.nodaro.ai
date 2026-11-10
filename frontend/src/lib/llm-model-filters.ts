/**
 * The predicates of the LLM model menus that offer only some models
 * (`LlmModelSelect`'s `filter`). They live in `@nodaro/render-rules`, which the
 * panels, the editor's new-node rule and the server's read alike, so a new node
 * starts on a model the panel's menu actually lists.
 */
export { describeToPickerModel, structuredOutputModel, structuredVisionModel } from "@nodaro/render-rules"
