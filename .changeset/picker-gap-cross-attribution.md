---
"@nodaro/prompts": patch
---

`buildMultiPickerAnalyzerSpec` now returns `otherPickersLegend` — a compact, id-free list of the pickers NOT wired into the spec (names + dimension labels). The image analyzer (`describe-to-picker`) feeds it to the LLM so a gap can be attributed to the picker it truly belongs to (e.g. an era or setting attribute) instead of being forced into a wired picker's catalog, which was polluting the person/styling gap feedback.
