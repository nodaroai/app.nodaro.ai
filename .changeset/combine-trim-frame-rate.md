---
"@nodaro/shared": minor
---

`estimateCombineVideosCredits` takes an optional `trimFramesPerSecond`: the frame rate a join's frame trims are cut at, when it is known. Without it the estimate keeps its 24 fps assumption.

`estimateCombineVideosCredits` now takes the frame trims off only where two clips meet, as the join cuts them: the start of every clip but the first and the end of every clip but the last, `(trimStartFrames + trimEndFrames)` for each of the n − 1 joins, instead of for every clip. An estimate with frame trims can therefore be a little higher than before.

`estimateCombineVideosCredits` takes an optional `transitions` list (per-join overrides, as Combine Videos takes them): each join takes off its own transition's overlap, the global one where none is set, at most 90% of the shortest clip, as the join renders it.
