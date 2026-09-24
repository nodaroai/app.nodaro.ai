---
"@nodaro/prompts": minor
---

Transition wording round 2.

- `aging` and `zoom-into-mouth` have new descriptions. Aging now reads `the subject visibly ages forward - fine lines deepen into wrinkles, hair greys to silver, posture settles - while the framing stays unchanged`; zoom into mouth no longer mentions the throat (`… and the camera passes through into the new scene …`).
- A cut (every picked transition `instant`) with position `full` no longer adds "the transition spans the entire clip" — a single-frame cut spans nothing. `start` / `middle` / `end` on a cut, and every position on a non-cut, are unchanged.
- `composeTransitionHintFromConnections` takes an optional sixth argument, `{ scope: "shot" }`, for a hint folded into one shot's time window of a multi-shot prompt: the position clause then says "of this shot" instead of "of the clip" (`the transition occurs in the middle of this shot`). Without it the wording is unchanged. New exported types `TransitionHintScope` and `TransitionHintOptions`.
