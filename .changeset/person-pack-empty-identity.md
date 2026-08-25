---
"@nodaro/prompts": patch
---

getRegisteredPeople() returns the base PEOPLE reference itself when no person packs are registered (mainline identity on the empty path, matching the sibling getters), instead of an unconditional copy.
