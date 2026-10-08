---
"@nodaro/shared": patch
---

`buildConditionVariables` trims the surrounding whitespace of a variable's output, so a Generate Text answer that ends with a line break still equals the field a Filter List or Router condition compares it with.
