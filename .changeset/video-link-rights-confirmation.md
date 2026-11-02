---
"@nodaro/shared": patch
---

A Video URL node's `rightsConfirmationId` — the content rights confirmation a run fetches the node's link under — is a run-only field: it joins `RUN_ONLY_NODE_FIELDS` (`withRunOverrides` drops a saved one before it merges the run's overrides, as the server's engine does), `TRANSIENT_RUNTIME_KEYS` (never saved) and `VIDEO_LINK_DERIVED_FIELDS` (a run request that points the node at another link drops it with the rest). One confirmation opens one download of one link within an hour, so only the run's own override can supply it.
