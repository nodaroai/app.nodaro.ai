---
"@nodaro/sdk": minor
---

`workflows.viewLink` — a workflow's read-only view link: a page of its canvas (its nodes, their results, prompts and notes) that anyone holding the link opens without signing in, at `/view/<token>`, and an embed of the same canvas for an iframe on another site, at `/embed/view/<token>`. `get`, `enable({ locale? })`, `update({ indexable })` (whether search engines may index it, on by default), `saveExport({ includeAssets })` / `removeExport` (a frozen copy of the workflow viewers can download and import into their own account) and `disable` are for the workflow's creator; `read(token)` and `readExport(token)` take no credential. Separate from the presentation link, which lets a viewer run the workflow. New types `WorkflowViewLink`, `WorkflowViewExportState`, `PublicWorkflowView`, `EnableWorkflowViewLinkInput`.
