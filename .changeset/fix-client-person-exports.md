---
"@nodaro/client": patch
---

Fix: surface the Person composer from `@nodaro/client`'s package entry. `buildPersonSeedPrompt`, `buildPersonHints`, `PEOPLE`, `PERSON_DIMENSION_ORDER`, `PERSON_DIMENSION_LABELS`, and the `PersonValue` type were declared in the characters resource but never re-exported from `src/index.ts`, so tsup tree-shook them out of the built bundle — `import { buildPersonSeedPrompt } from "@nodaro/client"` did not resolve. They are now re-exported from the entry point.
