---
"@nodaro/shared": minor
---

A feature can declare the reasoning effort its default model runs at. New exports: `LLM_FEATURE_DEFAULT_EFFORTS` (`describe-to-picker` → `"high"`) and `defaultReasoningEffort(feature, modelId?)`, which returns that effort only when `modelId` is the feature's default model or omitted, and `undefined` otherwise, so a caller on another model keeps its Auto.
