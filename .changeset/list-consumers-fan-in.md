---
"@nodaro/shared": minor
---

`FAN_IN_TARGETS` now lists the list operators — Filter List, Deduplicate, Merge Lists, Sort List and Selector — on every handle (`"*"`). They read the whole list wired into them and are never run once per item: an "each" wire (a Split Text, a List, a node that ran per item) into one of them used to fan it out, and every iteration answered with the same first match.
