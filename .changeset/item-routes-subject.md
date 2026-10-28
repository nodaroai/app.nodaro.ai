---
"@nodaro/sdk": minor
---

`client.characters.generate()` and `client.creatures.generate()` take an optional `subject` — who the picture shows as picker-catalog ids (a person's age, hair and styling, a held prop, a material, an animal), the same `Subject` type and bounds as `nodes.generateImage`'s. The platform writes the wording and folds it into the prompt it sends (after `seedPrompt` / `description`), so a client sends ids instead of phrasing a pick itself; without it the prompt is unchanged.
