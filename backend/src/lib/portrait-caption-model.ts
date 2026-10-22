/**
 * The model the character portrait caption runs on (`routes/character-portrait-approval.ts`
 * — the approve-portrait and llm-caption routes), fixed in code so the helper's
 * metered price follows it. A leaf, so a surface that states the caption's
 * price (the MCP character tools) names the very model the route calls.
 */
export const PORTRAIT_CAPTION_MODEL = "claude-sonnet-4.6"
