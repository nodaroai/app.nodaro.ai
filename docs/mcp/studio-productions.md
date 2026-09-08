# Studio productions over MCP — direct a film from a conversation

The MCP lane onto a **studio production** (Cloud edition): a Nodaro workflow
whose `settings.studio` holds an ordered list of shots — each one a framed
still, an optional animated clip, and the plan, looks, cast bindings and voice
that made them. The same production opens in the editor at
[studio.nodaro.ai](https://studio.nodaro.ai), so an assistant can draft the film,
hand it over, and pick it up again after the user has moved three shots around.

Prefer this lane for "make me a film / a scene / a sequence, and let me keep
editing it". [Recast authoring](./recast-authoring.md) is the lane for a movie
authored as one JSON document; the [Video Director](./video-director.md) and the
workflow tools remain the right choice for a canvas build.

## The loop

1. **`get_studio_production_skill`** — read the guide first. Four parts:
   `authoring` (how a plan is written), `catalog` (every picker, model and enum,
   in full), `schema` (the strict JSON Schema a plan is validated against) and
   `operating` (the tool map, the loops, the operation vocabulary, and what
   these tools will not do). All four are rendered server-side from the version
   that is live, so they describe the deployment you are actually talking to
   rather than what was true when this page was written. Free.
2. **`validate_studio_plan`** — free, persists nothing, and resolves cast names
   against the caller's own library. Loop on `errors[].path` until
   `valid: true`. Do this before spending anything.
3. **`create_studio_production`** (a new film, optionally landing the plan in
   the same call) or **`import_studio_production`** (add a plan's scenes to a
   production that already exists). Both are free — no media is generated.
   For a brief rather than a plan, **`describe_studio_production`** runs the
   Director: it starts a job and records it on the production, and the drafted
   scenes arrive when that run is landed, like any other finished job.
4. **`get_studio_production`** — the production as it now stands: its shots,
   what has landed on them, and a `pending` block naming what is still in
   flight. **With `workflows:write`, reading also lands what has finished** —
   the view you get back is the one taken after that landing, so a re-read is
   how a finished generation reaches its shot. **With read-only scope it is a
   pure read:** nothing lands, and a job that has finished stays in `pending`
   until someone who may write brings the production up to date.
   `detail: "full"` adds every result with the context that regenerates it;
   `shot_id` reads one shot, the cheap re-read after a generation.
5. **`edit_studio_production`** — every change to a production is an
   **operation**, and this is the one tool that applies them. See below.
6. **Generate:** `generate_studio_still` frames a shot, `generate_studio_clip`
   animates it, `new_studio_shot_from_frame` grabs a frame out of a clip,
   `voice_studio_shot` speaks a line, `revoice_studio_clip` recasts the voices
   of a clip, `score_studio_production` writes the soundtrack.
7. **`plan_studio_export`** — the ordered steps that assemble the film, each
   with its price. Run them with the ordinary generation verbs and record the
   finished file back on the production.
8. **`share_studio_production`** / **`clone_studio_production`** — open the
   share-by-link read, or take a copy.

An abandoned conversation strands nothing: the production is a real row the user
can open in the editor, and a generation that was still running is landed onto
it the next time the production is brought up to date — by you, by the editor,
or by the next assistant the user asks.

## Editing: operations, not patches

`edit_studio_production` takes a batch of operations and applies it **atomically
against the newest document**:

- An operation addresses by **stable key** — a shot by its id, a cast row by its
  role slug, a result by its job id or url — never by position, because the user
  may be editing the same production in the browser while you work.
- A batch composed against a slightly older version is still applied to the
  newest one and the reply says it was rebased; `strict` refuses instead.
- One bad operation refuses the **whole batch** and writes nothing. The error
  names the offending operation by its zero-based index, so fix that one and
  send the same batch again.
- `receipts` is one past-tense line per operation — the thing to show a user who
  asks what you just did.
- Deletes are recoverable: removals go to the production's bin and can be
  restored. Only an explicit purge destroys anything.
- Sharing is **not** an operation. It has its own tool, so a batch that was
  editing something else can never change who can see the work.

The operation vocabulary itself is served, not printed here: read it from
`get_studio_production_skill { part: "operating" }`, which is generated from
what the deployment accepts.

## Tools and scopes

| Tool | Scope | What it does |
|------|-------|--------------|
| `get_studio_production_skill` | none | The four-part guide. Free. |
| `validate_studio_plan` | `workflows:read` | Check a plan against the caller's library. Free, and it persists nothing — but it resolves every `cast` name against the caller's own entities, so it is gated exactly where its route is. |
| `list_studio_productions` | `workflows:read` | The caller's productions, newest first. |
| `get_studio_production` | `workflows:read` | One production — what has landed and what is pending. With `workflows:write` it also lands what has finished before it reads; read-only, it lands nothing. |
| `plan_studio_export` | `workflows:read` | The ordered export steps and their prices. |
| `create_studio_production` | `workflows:write` | A new production, optionally from a plan. |
| `import_studio_production` | `workflows:write` | Append a plan's scenes to one that exists. |
| `edit_studio_production` | `workflows:write` | Apply a batch of operations. |
| `share_studio_production` | `workflows:write` | Open or close the share-by-link read. |
| `clone_studio_production` | `workflows:write` | Copy one into the caller's own Studio project. |
| `describe_studio_production` | `workflows:write` + `workflows:execute` | Turn a brief into scenes (a Director run). |
| `generate_studio_still` | `workflows:write` + `workflows:execute` | Frame a shot — `count` candidates. |
| `generate_studio_clip` | `workflows:write` + `workflows:execute` | Animate a shot. |
| `new_studio_shot_from_frame` | `workflows:write` + `workflows:execute` | A still out of a clip, placed where you say. |
| `voice_studio_shot` | `workflows:write` + `workflows:execute` | Speak a shot's line. |
| `revoice_studio_clip` | `workflows:write` + `workflows:execute` | Recast the voices of a shot's clip. |
| `score_studio_production` | `workflows:write` + `workflows:execute` | Write the film's soundtrack. |

The seven that spend need **both** grants, not either one: their routes
authorize on `workflows:write`, and starting the run is `workflows:execute`. A
tool whose scopes have not all been granted is omitted from `tools/list`
entirely — it is not there to call and fail — so a session holding only one
half of the pair sees none of them and gets no explanation. Grant both for the
generating lane.

Deleting a production is deliberately not exposed. The soft hide (archive) is an
operation on `edit_studio_production`, and it is reversible.

## Confirmation classes

A tool that spends credits, or that changes who can see the work, says so on its
own definition — in `_meta.nodaro.confirm`. There are two values. Read the mark
rather than hard-coding a list of tool names: the mark is what a client should
put a confirmation prompt in front of, and it stays right as the family grows.

| `_meta.nodaro.confirm` | Ask first because… | Tools |
|------------------------|--------------------|-------|
| `"$"` | It costs credits. | `describe_studio_production`, `generate_studio_still`, `generate_studio_clip`, `new_studio_shot_from_frame`, `voice_studio_shot`, `revoice_studio_clip`, `score_studio_production` |
| `"P"` | It changes who can see the work. | `share_studio_production` |

A tool with neither mark reads, or changes only the caller's own document.
`edit_studio_production` is in that group and carries no mark on purpose: what a
batch does is decided by the operations inside it, and the tool layer does not
classify them — a second copy of the vocabulary there would drift from the one
the route validates against. So a client that wants to confirm before something
is removed has to look at the batch it is about to send. What is at stake is
small either way: removals go to the production's bin and can be restored, and
the only irreversible act is an explicit purge.

## Spending discipline

Two levers, and both matter more here than in a one-shot generation, because an
agent driving a film makes dozens of calls:

- **`dry_run: true`** on `generate_studio_still` and `generate_studio_clip`
  returns the quote — the model and what the run would cost — and writes
  nothing. `credits: null` means the model is unpriced, which is "unknown", not
  "free". Present the price and let the user accept before you spend. The
  remaining spending tools — `describe_studio_production` included — have no
  dry run: quote them from the model's own price, or ask first.
- **`client_request_id`** makes a retry safe: the same token answers with the
  jobs the first call started, having submitted nothing and charged nothing.
  Mint it yourself (8–128 characters of `A-Za-z0-9_.:-`) and never derive it
  from the request body. **Never retry a spend without it.**

Generation is **run-then-poll**, and a finished job becomes a result on the
shot only when it is **landed**. Nothing here blocks a request for minutes:

1. a still or clip run returns its job ids immediately;
2. wait on those jobs — `get_job`, or the production's own `pending` block;
3. re-read with `get_studio_production`. Holding `workflows:write`, that read
   lands everything that has finished before it answers, so the view already
   carries the new results — `shot_id` is the cheap one. Holding only
   `workflows:read` it lands nothing and what finished stays in `pending`, for
   a writer to pick up;
4. show the user what arrived.

Three things make that landing step fall through to the plain read instead of
failing it: a deployment that does not serve the landing sweep, a caller who
may not write, and a production busy under another writer at that instant
(the sweep gives way; what finished lands on the next read). Any other
failure of that step is reported rather than hidden. Landing one named job is also part of the
operation vocabulary the operating guide serves, applied with
`edit_studio_production`, for when you want that instead of a sweep. Over REST
the two halves are separate — `POST /v1/studio/productions/:id/reconcile` and
then the `GET`, which never writes on its own — and `get_studio_production` is
that pair in one call.

## Availability

Studio productions are a Nodaro Cloud feature. On a deployment that does not
serve them every tool in the family answers `not_available` — a plain refusal,
not an error to retry. Feature-detect with `list_studio_productions` if you need
to know before offering the lane.

## Where the format is documented

The plan format (`nodaro-studio-production`) has one published home: the studio
app serves the same rendered authoring guide, catalog and JSON Schema at
[studio.nodaro.ai/skills/studio-production/](https://studio.nodaro.ai/skills/studio-production/).
`get_studio_production_skill` renders it from the platform side, so an assistant
that reads the tool and a person who reads the page are reading one document.

## REST and SDK equivalents

The same lane over raw REST is [`/v1/studio/productions`](../api/studio-productions.md);
over the SDK it is `client.studio.productions.*` — see
[SDK Reference](../sdk-reference.md#clientstudio).

### Retake a linked take

On a server advertising `operations.retakeLinkedClips`, call
`generate_studio_clip` with `production_id`, `shot_id`, `retake_result_key`, and
`dry_run: true`. Review the returned price and `inputHash`. Submit the same take
with `expected_input_hash` and a fresh `client_request_id`; omit `dry_run`,
`mode`, and `overrides`. The server uses the take's original settings and retained
endpoint images, independently of later plan changes. Missing or unverifiable
original inputs refuse the request. Existing takes remain in history. This
requires an explicit generation request and spends credits only on submission.
