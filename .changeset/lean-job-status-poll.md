---
"@nodaro/client": patch
---

Add `jobs.getStatus(id)` — a lean job-status fetch hitting `GET /v1/jobs/:id/status`. Returns only `id`, `status`, `progress`, `output_data`, and `error_message` (no `input_data`, cost columns, or timestamps), making it cheaper for poll loops than `jobs.get(id)`. Additive and non-breaking; `jobs.get(id)` is unchanged.
