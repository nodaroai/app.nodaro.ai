---
"@nodaro/shared": minor
---

Every node with a JSON output now declares its JSON kind (`transcript`, `edl` or `other`) in the json-kinds table, so the EDL/Transcript connection check covers it. Text to Dialogue's `json` is declared a Transcript. Adds `declaredJsonOutput`, `declaredJsonOutputRows` and the `JsonOutputDeclaration` type.
