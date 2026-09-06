# Operating a Nodaro Studio production

A **production** is a film you build shot by shot: each shot is a framed
**still**, an animated **clip** made from that still, and the plan, look, cast
and audio around them. It lives on a Nodaro workflow, so a production you create
here opens in the studio app at `studio.nodaro.ai`, edits there, and comes back
here unchanged. There is one document and one implementation of it — the app and
these tools never disagree about a production.

## The loop

1. **`get_studio_production_skill`** — read the AUTHORING format before you write
   a plan. `part: "authoring"` is the guide, `part: "catalog"` is every picker,
   model and enum in full, `part: "schema"` is the JSON Schema, and
   `part: "operating"` is this document. Do not guess a picker id: they are
   catalog values and a wrong one is dropped silently.
2. **`validate_studio_plan`** — free, charges nothing, persists nothing. It
   returns `{ valid, errors, warnings, summary }`; each error names the field
   (`scenes[0].frame.prompt`) and usually says how to fix it. Loop until
   `valid: true` — validating five times costs nothing and importing a broken
   plan costs a round trip.
3. **`create_studio_production`** (a new film) or **`import_studio_production`**
   (a plan into a production that already exists, `mode: "append"`). Both land
   the plan into the user's own "Studio" project, bind every `@name` the plan
   declares to a row in their library, and return the production.
4. **`list_studio_productions`** / **`get_studio_production`** — find one, then
   read it. `detail: "summary"` is counts and the active image of each shot;
   `detail: "full"` adds every past result with the context that made it. Ask
   for one shot with `shot_id` rather than pulling a whole film to look at one
   frame.

## What the plan is

The plan format is `nodaro-studio-production` — plain JSON, no media. A film is
`scenes[]`; a scene has a `frame` (the still: prompt, model, references), a
`motion` (the clip: prompt, model, seconds), optional `shots[]` (timed beats
inside the scene), an optional `voice`, and picks from the look catalogs. The
document's `cast[]` names the people, places and things it uses; a `@Name` in
any prompt binds to the matching cast row, and a cast row binds to the caller's
own library.

Read the authoring skill for the field-by-field contract. Two rules are worth
saying twice, because they are the ones plans get wrong:

- **Cinematic direction is IDS, never prose.** Pick `lighting: "golden-hour"`,
  do not write "in golden hour light" into the prompt. The platform folds the id
  into the model call server-side, once, at the right moment — a baked phrase
  folds twice and fights itself.
- **A name binds or it does not.** `validate_studio_plan`'s summary says how
  many cast rows found a library row and lists the ones that did not. An unbound
  name still lands, as a described role with the plan's own words and no face.
  If the user wanted their character, create it first and re-import.

## What these tools will not do

- **Nothing here spends credits.** Validating, importing, listing and reading are
  free. Generating stills and clips, voicing a shot, scoring a film and exporting
  a cut are separate tools that quote first; they arrive with the generation
  routes.
- **Nothing here deletes a production.** `set_archived` soft-hides one, and it is
  an edit, not a delete. If a user asks you to remove a production, hide it and
  tell them where it went.
- **Nothing here publishes.** A production is private until its owner shares it.
  Never share on the user's behalf without them asking, in this conversation, for
  that specific production to be shared.

## Reading a production

`get_studio_production` returns the same shape everywhere:

- `shots[]` in timeline order, each with `index`, its `still` and its `clip`.
- A still or clip carries `activeUrl` (what the shot currently shows), `count`
  (how many results it has), and `active` — the **result key**, which is the
  job id when there is one and the url when there is not. Address a result by
  that key. Never by position: the user is editing the same production while you
  read it, and an index is stale the moment they generate.
- `pending` says what is running right now. A number above zero means a
  generation is in flight; read again in ten to twenty seconds rather than
  starting another.
- `trash` is the bin. Deletes in studio are recoverable, so a "lost" shot is
  usually there.

## Talking to the user about it

Say what the film IS, not what the JSON says. "Four scenes, about ninety
seconds, with Kira in three of them" beats a field dump. When something did not
bind, say which name and offer to create it. When a plan validated with
warnings, mention the ones that change what they will see and skip the rest.
