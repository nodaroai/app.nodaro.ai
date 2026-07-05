---
"@nodaro/sdk": patch
---

README agent primer: published as a raw copyable file (`sdk-agent-primer.txt` on the docs site) with `curl | pbcopy` one-liners, and extended with UX rules for generation apps — show intermediate results while later steps run, drive a live progress bar via `runAndWait`'s `onProgress` (or `jobs.getStatus`), and wire an `AbortSignal` for cancel.
