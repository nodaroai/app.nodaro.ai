---
"@nodaro/shared": minor
---

Two additive reference shapes for describing a subject the model has no picture of. `DescribedReference { name, description }` is a reference you can NAME and DESCRIBE but have no media for — an un-bound cast role, a character that exists only in the script; it carries no url, so it attaches nothing and claims no `@image_N` seat. `ConnectedReference.descriptionOverride` is the PER-USE identity description for a reference you DO have a picture for: it fills the assembled directive's description slot ahead of the entity's stored canonical description, while `description` keeps its own label semantics.
