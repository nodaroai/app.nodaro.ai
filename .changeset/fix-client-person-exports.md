---
"@nodaro/client": patch
---

Fix: surface re-exports that tsup was tree-shaking out of `@nodaro/client`'s built bundle. `buildPersonSeedPrompt`, `buildPersonHints`, `PEOPLE`, `PERSON_DIMENSION_ORDER`, `PERSON_DIMENSION_LABELS`, and the `PersonValue` type — plus the pre-existing `CHARACTER_STYLES` value and `EntityStyle` type — were declared/re-exported in the characters resource but never re-exported from `src/index.ts` (which re-exports characters symbols selectively, not `export *`). As a result they were absent from the bundle and `import { buildPersonSeedPrompt } from "@nodaro/client"` did not resolve. All are now re-exported from the package entry point.
