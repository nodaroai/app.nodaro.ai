---
"@nodaro/shared": minor
---

Eight LLMs join the registry: Claude Sonnet 5.5, Claude Opus 5.5, GPT-6 Luna, GPT-6 Sol, GPT-6.1 Sol, Grok 4.7, Kimi K3 and DeepSeek V4.1 Flash. `LlmVendor` gains `deepseek` and `moonshot` (with their `LLM_VENDOR_ORDER` / `LLM_VENDOR_LABELS` entries), and `LlmModelDef` gains two optional capability flags: `supportsForcedToolChoice: false` (the model rejects a forced tool choice) and `conversationBoundThinking: true` (its thinking blocks are valid only in the unedited conversation that produced them). The `describe-to-picker` default moves from `claude-opus-5` to `claude-opus-5.5`, and the descriptions of Claude Opus 5, Claude Sonnet 5 and Grok 4.6 now read as previous-generation models.
