/**
 * The billing identifier for one copilot message.
 *
 * Must match `STATIC_CREDIT_COSTS["workflow-copilot"]` and the `model_pricing`
 * row on the backend — it is what `/v1/credits/model-cost` is asked for when
 * the composer shows the message's upper bound.
 */
export const COPILOT_FEATURE_ID = "workflow-copilot"

/**
 * The longest one message may be, matching `THREAD_CAPS.messageMaxChars` on the
 * backend — the Zod cap on both `POST /threads` (`prompt`) and
 * `POST /threads/:id/messages` (`message`).
 *
 * It bounds the WIRE message, which is the prose plus the `[references]` line a
 * mention adds. A composer that caps only what the user typed sends a message
 * the server rejects the moment they mention something.
 */
export const COPILOT_MESSAGE_MAX_CHARS = 16_000
