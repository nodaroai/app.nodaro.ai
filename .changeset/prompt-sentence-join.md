---
"@nodaro/prompts": minor
---

Prompt joins no longer double a closing period. A prompt typed with a final period used to come out as "no watermark.. butterfly portrait lighting" once a picker hint was appended.

- New `joinSentences(pieces)`: joins with ". ", or a single space when the piece before already ends a sentence (Latin or CJK full stop, question or exclamation mark, ellipsis). Blank pieces are dropped.
- New `appendPromptHints(prompt, hints)`: appends wired picker hints the way both engines fold them. The hints join as clauses, then follow the prompt as a new sentence.
- `joinPromptHints`, the style-section lines, `composeNegative` and `resolvePrompt`'s `appendWired` join now go through `joinSentences`. Output only changes where a piece already ended a sentence.
