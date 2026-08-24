# A five-reference prompt, read clause by clause

Wiring order into `references`: 1 = the person · 2 = source of a hat ·
3 = source of a face-paint design · 4 = source of a jacket · 5 = the place
(and a shirt color).

The complete working prompt:

```
{image:1} is standing in the same spot where {image:5} is standing, but not in
her pose. He is wearing a shirt in the same color as {image:5} shirt and he is
wearing the exact jacket worn by {image:4}. On {image:1} right cheek only, apply
the same face-paint design seen on {image:3} cheeks. His left cheek must remain
completely free of face paint. He is wearing {image:2} hat, and his face is
turned toward the camera.
```

What each clause does:

- `{image:1} is standing in the same spot where {image:5} is standing, but not
  in her pose.` — Person from 1, place from 5, plus an explicit DON'T. Saying
  what NOT to take is as load-bearing as saying what to take: without it the
  pose rides in with the location.
- `a shirt in the same color as {image:5} shirt` — ONE attribute (color) from a
  reference, not the whole garment.
- `the exact jacket worn by {image:4}` — the whole garment, matched.
- `On {image:1} right cheek only … his left cheek must remain completely free of
  face paint.` — a detail from 3, constrained to one side of the face; the
  negative half of the constraint is what keeps it one-sided.
- `He is wearing {image:2} hat, and his face is turned toward the camera.` — an
  object from 2, plus a direction that NO source supplies — new information is
  stated in plain words, everything sourced is stated through a token.

Settings that made it work: a model that accepts several reference images at
once (gpt-image-2), resolution 2K, aspect ratio 16:9.
