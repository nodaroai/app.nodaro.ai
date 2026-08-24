---
"@nodaro/shared": minor
---

Organizations: a ninth preset setting, `policy_survives_suspension`.

It answers whether an organization's content rules still bind its members
while the organization is SUSPENDED. Default `false` in both kind presets,
which is the existing behaviour — a stopped organization stops binding, and
its members work independently until it resumes.

An organization whose reason for restricting its members is contractual —
work made here belongs to the institution — turns it on, because an unpaid
invoice does not void a contract. Today it governs exactly one rule
(`personal_space_enabled`); every other preset key governs behaviour inside a
workspace, which a suspended organization grants no context for anyway.
