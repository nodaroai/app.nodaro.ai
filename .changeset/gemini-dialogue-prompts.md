---
"@nodaro/prompts": minor
---

`sentDialogueLines(lines, sheet)` and `sentDialogueChars(lines, sheet)` (from `@nodaro/prompts/prompt-fields`): a dialogue script as it is sent and billed — each line by `sentSpeechText` (on an angle-tag model its tags rewritten first), within what the lines before it left of the model's total cap; the line the cap falls in is cut and every line after it is sent empty. On a model that sends its tags as written the count is the lines' sum, at most the cap, as before. `dialogueTextBeforeCap(lines, sheet)` is the length a lane that refuses an over-cap script measures. A cut that leaves a lone `<` at the end of a text now drops it, as it drops any other broken tag.
