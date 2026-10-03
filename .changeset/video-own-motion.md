---
"@nodaro/prompts": minor
---

`ownMotionHint(nodeType, data)` and `DEFAULT_OWN_MOTION`: the clause a video node's own Motion setting adds to its prompt ("dynamic motion"). Legacy Image to Video and Generate Video carry the setting, and Generate Video carries it in both modes; legacy Text to Video has none. An enabled setting with no step stored runs as `moderate`, the step the panel shows. The editor run, the prompt preview and the orchestrator all read this one rule. The editor used to skip it on Generate Video without a start frame, while workflow runs always applied it.
