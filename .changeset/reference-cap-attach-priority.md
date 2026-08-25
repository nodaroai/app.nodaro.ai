---
"@nodaro/prompts": patch
---

The provider image-reference cap now slices connected references by attach priority (canonicals, manual and extra refs before unmentioned variants) instead of raw list order, so a variant-rich character can no longer evict a character wired after it.
