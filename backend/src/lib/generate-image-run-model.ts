/**
 * The model one `POST /v1/generate-image` request runs on, read from its body
 * before validation. Kept apart from the route's modules so both readers
 * judge the same model without importing each other: the credit guard's
 * surface deny (`resolveImageRunModel`) and the body schema's choice
 * (`parseGenerateImageRequest`, which bounds the reference lists by it).
 */
import { FLUX_LORA_CHARACTER_MODEL_ID } from "@nodaro/shared/models"
import { config } from "./config.js"
import { textField } from "./run-model.js"
import { generateImageModelOf } from "../workers/handlers/default-models.js"

/**
 * A Character LoRA run (the `_internalLora` hint with routing on) runs the
 * trained-character model, as the credit check prices it; any other runs the
 * model it names, else the general default at its aspect ratio (a ratio the
 * role's model cannot draw moves to another model). Judged before the
 * image-to-image swap, as a named `provider` is. A fan-out runs the models in
 * its `models`, which its callers read themselves.
 */
export function generateImageRunModelOfBody(body: Record<string, unknown>): string {
  if ("_internalLora" in body && config.CHARACTER_LORA_ROUTING_ENABLED) return FLUX_LORA_CHARACTER_MODEL_ID
  return generateImageModelOf({ provider: textField(body.provider), aspectRatio: textField(body.aspectRatio) }).resolvedModel
}
