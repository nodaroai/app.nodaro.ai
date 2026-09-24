---
"@nodaro/prompts": patch
---

Transition timing wording.

- Intensity `natural` on a transition now reads `with natural timing` (was `with natural unhurried timing`). Character FX keeps its own `with natural unhurried timing`. A cut still drops the intensity clause.
- With `{ scope: "shot" }`, position `full` on a transition that is not a cut reads `the transition spans this entire shot` instead of `the transition spans the entire clip`. Without the option the wording is unchanged, and a cut with `full` still adds no position clause.
