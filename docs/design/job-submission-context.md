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
