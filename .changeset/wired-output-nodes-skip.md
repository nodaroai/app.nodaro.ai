---
"@nodaro/prompts": minor
---

`WIRED_OUTPUT_NODE_TYPES`: the output nodes that send exactly what is wired into them (Webhook Output and the social post nodes). The orchestrator skips one with `skipReason: "empty_input"` when every wire into it carried nothing in this run, instead of posting an empty payload or failing the run.
