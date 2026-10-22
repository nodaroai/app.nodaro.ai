# Job submission context

Server integrations can attach immutable provenance when they create a job through
the internal request toolkit. The metadata is stored in `jobs.submission_context`
in the same insert as the job. It records the submitted inputs independently of
later changes to an editable workflow.

`internalRequest` accepts `jobSubmission: { jobType, metadata }` on hosts declaring
`supportsJobSubmissionContext`. The context applies only to the matching route,
job type and authenticated user. Nested internal calls require their own explicit
context. Public request bodies and headers cannot supply it. Existing job insert
helpers remove caller-provided values for the reserved column.
An identity mismatch fails before insertion; non-throwing job helpers return it
through their existing `error` field.

The database rejects client inserts carrying submission context and prevents
changing the field after insertion. The column is excluded from browser and
Realtime grants and public job responses. Plugins can read the records through
`readJobSubmissionsOwnedBy`, which scopes the query to the supplied user.

Metadata must be a JSON object no larger than 256 KiB. This transport does not
authorize generation or reserve credits; the destination route retains those
checks. An integration should check the capability before requesting this behavior.

## Client provenance on internal requests

An internal request ignores `origin` and `sessionId` in its body. A job it
creates carries a client origin or a generation session only when server code
attaches them to the same scope:

- MCP tools pass a session through `mcpInject`.
- The trend routes pass the caller's origin and surface.
- A plugin passes the `provenance: { origin?, sessionId? }` option of
  `internalRequest`. That option is opt-in per call. The host reads only those
  two keys, so a plugin should fill them from fields it validated. Payloads can
  carry records that the plugin's caller controls, which is why the body is
  never trusted. Hosts that support this declare `internalRequestProvenance`.

A session is checked exactly as on a public request. It must be the caller's
own session, on the same side of the workspace line. The caller's grant must
also allow a session write:

- An OAuth app or an MCP session needs `assets:write`.
- A first-party caller needs no grant.
- An internal hop whose grant no scope vouches for may not file a session.

No request option or body field states a grant. The host reads it from one of
three places:

- the request's own credential, as its auth hook recorded it;
- the grant that `mcpInject` or the trend routes carry in the scope;
- for a plugin, the route request it passes as `request`.

A plugin's `request` counts only if the host itself received that object and
the request belongs to the same user. A request whose credential the host does
not recognise names no grant. The host cannot tell which of that user's
received requests the plugin passed, so a plugin passes its handler's own
request. A worker-side child job carries no provenance.
