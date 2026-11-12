---
"@nodaro/shared": patch
---

`gpt-6.1-terra` no longer carries `effortPriced`: its price does not depend on the effort a call sends, so its price key is the bare `<feature>:gpt-6.1-terra` at every effort. The `effortPriced` flag, the `:effort-<level>` key suffix and `parseLlmPriceKeyModel` stay for any model whose price does.
