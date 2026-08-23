/**
 * The billing identifier for one copilot message.
 *
 * Must match `STATIC_CREDIT_COSTS["workflow-copilot"]` and the `model_pricing`
 * row on the backend — it is what `/v1/credits/model-cost` is asked for when
 * the composer shows the message's upper bound.
 */
export const COPILOT_FEATURE_ID = "workflow-copilot"
