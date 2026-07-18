---
"@nodaro/prompts": patch
"@nodaro/sdk": patch
---

Content-rejection hardening from the first app_reports batch: the `feature-midriff-visible` / `feature-navel-visible` prompt hints move to garment language (no "bare stomach" anatomy emphasis), `buildPersonHints` folds the pair into ONE neutral clause when both are picked, and `buildStylingHints` skips `makeup-bold-lips` when the shared value map already carries the person catalog's `lip-state-bold-red` (single-map consumers were doubling the lipstick clause). SDK: `GenerateCharacterInput` and `GenerateAssetInput` gain optional `origin` — client-app attribution for the platform's diagnostic reports.
