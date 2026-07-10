---
"@nodaro/shared": minor
"@nodaro/prompts": minor
---

Migrate to zod 4 (4.4.x). No API changes — schema exports and their parse
behavior are unchanged. `@nodaro/shared` now declares `zod: ^4.4.0`;
`@nodaro/prompts`'s bundled zod moves 3.25 → 4.4 and its schema-builder
types use zod-4 generics (`z.ZodType<Output, Input>`).
