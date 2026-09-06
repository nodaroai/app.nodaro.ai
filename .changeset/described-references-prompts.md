---
"@nodaro/prompts": minor
---

`described-references.ts` — the one place either lane phrases what a reference IS. `renderDescribedReferenceLines` renders a `DescribedReference` as `<Name> — <description>.`, `renderReferenceCaptionLines` renders video/audio rail captions as `@video_N: <caption>.`, and `appendReferenceLines` joins either onto an assembled prompt the way the active reference format joins its own trailing directives. Both lanes honour `ConnectedReference.descriptionOverride` as the reference's identity description for this run — filling the slot a legacy bullet (and the hybrid extras clause) already has, and adding one binding-subject line where a hybrid role phrase has none. `buildImagePrompt` and `resolveVideoReferenceCore` take described references on their own, so a prompt whose cast has no entities yet still assembles. Absent → byte-identical output.
