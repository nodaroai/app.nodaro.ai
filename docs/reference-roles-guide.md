# Reference Roles — Tell the Model What to Take from Each Reference

When you wire a **reference** into a **Generate Image** or **Generate Video** node — a plain image, or
a **Character / Location / Object / Animal** asset via the **Assets** handle — you can tell the model
*which aspect* of that reference to use: its **identity**, its **outfit**, its **background**, its
**style**, and so on. That aspect is the reference's **role label**.

A **labeled** reference resolves to one uniform phrase in the final prompt:

> `… the {label} from reference image A …`  *(image — references are lettered A, B, C…)*
>
> `… the {label} from @image_1 …`  *(video — references are numbered @image_1, @image_2…)*

The vocabulary is **identical for image and video** — only the binding (`reference image A` vs.
`@image_1`) differs. The same mechanism powers plain image references and every asset type, so they
share one numbering and never collide.

## Type-aware defaults

A freshly-wired reference starts with the most useful label for its type, so it does the right thing
with zero configuration:

| Wired source | Default label |
|--------------|---------------|
| Character | `person` |
| Location | `location` |
| Object | `object` — nameable, see [Mentioning a creature or an object](#mentioning-a-creature-or-an-object) |
| Animal / Creature | `creature` — nameable, see [Mentioning a creature or an object](#mentioning-a-creature-or-an-object) |
| Face | `face` |
| Plain image / upload | **`ref-only`** (bare reference) — nameable, see [Naming a plain image](#naming-a-plain-image-so-you-can-mention-it) |
| Video / audio | **`ref-only`** (bare reference) |

Plain images, video, and audio default to **ref-only** — see [Ref only](#ref-only) below.

## Preset roles

Click a reference pill to pick its role from a curated, type-aware menu (most-useful first; the
default is **bold**). **Custom…** is always available for anything not listed.

| Source | Preset roles |
|--------|--------------|
| **Character / Person** | ref-only · **person** · face · clothes · hair · pose · expression · style |
| **Location** | ref-only · **location** · background · atmosphere · as-is · empty background · layout · lighting · style |
| **Object** | **object** · shape · material · color · texture · style |
| **Animal / Creature** | **creature** · anatomy · markings · pose · color · style |
| **Plain image** (wired / uploaded) | **ref-only** · object · person · face · clothes · background · style · pose · texture |

A few roles read as a fuller phrase so the prompt stays natural:

| Role | Resolves to |
|------|-------------|
| `as-is` | `reference image A, used as-is` |
| `empty background` | `the background from reference image A (without its foreground objects)` |

### Ref only

**Ref only** injects the bare reference — `reference image A` on image nodes, or `@image_1` /
`@video_1` / `@audio_1` on video nodes — with *no* `the {label} from …` phrase, so the model sees the
reference without being told what to take from it. It's the top entry of every reference pill's menu
and the **default** for plain image, video, and audio references.

For **Character / Location / Object / Animal** assets, ref-only is an explicit choice (their described
defaults — person / location / object / creature — are unchanged). A Character or Location pill set
to ref-only serializes as a plain role (`@kira:1:ref-only`) and shows a compact **ref** badge to set
it apart from its described default.

### Combining a variant with a role

A character or location mention can pick **which image** (the variant) and **what to take from it**
(the role) independently: `@abi:1:walking:clothes` attaches Abi's *walking* image and injects
`the clothes from reference image A`. Any role works — curated, custom, or `ref-only`
(`@abi:1:walking:ref-only` → bare `reference image A` with the walking image attached). Locations
mirror it: `@library:1:weather/rain:lighting`.

In the editor the two axes map to the chip's two controls: click the **thumbnail** to swap which
image (canonical or a variant — swapping within the same character keeps your role), click the
**label** to pick the role (picking a role keeps the variant; **Default** resets the role but keeps
the image).

### Naming a plain image so you can mention it

Characters and locations are mentionable because they have names. A **plain image** gets one the same
way: give the wired **Upload Image** node a **Label**, and the slug of that label becomes its mention
name — so a node labelled `Town` is `@town:1`.

The grammar is the short one — `@<name>:<index>[:<role>]`, two or three segments, no variants and no
usage modes, because a picture has no variant array to choose from (creatures and objects speak the
same short grammar — see below):

| Token | Result |
|-------|--------|
| `@town:1` | the picture's bare binding (`reference image A`) placed exactly where you typed it |
| `@town:1:background` | `the background from reference image A` |
| `@town:1:signage` | any custom single word works, verbatim |
| `@town:1~lock` / `@town:1~nolock` | force the identity-lock on / off for this mention |

Roles are the usual media set (`object`, `person`, `face`, `clothes`, `background`, `style`, `pose`,
`texture`) or a custom one, exactly as on the pill menu. The index is a correlation number the editor
assigns; the letter you see in the prompt comes from the reference's position, not from it.

Mentioning is **optional** — an unnamed upload still attaches exactly as before, it just has no name
to address. Two notes: a label starting with a digit (`3D Render`) can't form a mention, so rename it
if you want to address it inline; and when a name is shared with a character or location, the
**character or location wins** — those resolve first.

### Mentioning a creature or an object

**Object** and **Animal / Creature** assets are mentionable by name too, with the **same grammar** as
a plain image — `@<name>:<index>[:<role>]`, plus the `~lock` / `~nolock` sentinels. The name is the
entity's own name (a creature named `Nessie` is `@nessie:1`), and the roles are that asset's sets:
`creature` · `anatomy` · `markings` · `pose` · `color` · `style`, and `object` · `shape` · `material`
· `color` · `texture` · `style` — or a custom one.

**Type these by hand.** Unlike character, location and plain-image mentions, creatures and objects
have no `@` autocomplete row and no pill in the editor yet — the token stays plain text while you
write, and is resolved when the prompt is generated.

| Token | Result |
|-------|--------|
| `@nessie:1` | `the creature from reference image A`, placed where you typed it |
| `@nessie:1:markings` | `the markings from reference image A` |
| `@dock:2:material` | `the material from reference image B` |
| `@nessie:1~lock` / `@nessie:1~nolock` | force the identity-lock on / off for this mention |

This is the one place mentioning changes more than *where* the phrase lands. A wired creature or
object you **don't** mention still contributes a phrase, appended at the end of the prompt — so
writing the creature's name in your sentence leaves the name as plain prose while its binding dangles
in a trailing line, and the model has no reason to connect the two. **Mentioning binds them:** the
phrase renders once, inline, and the trailing line for that reference goes away.

> Before: *"a wide shot of Nessie rising from the lake"* … `the creature from reference image A`
>
> After (`@nessie:1`): *"a wide shot of **the creature from reference image A** rising from the lake"*

Full precedence when a name is shared across kinds: **character → location → image → creature →
object**. The earlier kind wins and the later mention never fires.

### Custom labels

Pick **Custom…** and type anything (e.g. `dragon`, `Danny`, `hoodie`). Custom labels are sanitized
(≤32 chars, spaces become dashes) and slot into the default phrase: `the hoodie from reference image A`.
Proper nouns are used verbatim (`Danny from reference image A`).

## Identity-lock (optional, off by default)

By default **nothing identity-locking is auto-injected** — references behave like images, and the
role label alone drives the result. When you want to pin a subject's exact identity, switch the
**identity-lock** on for that reference and it prepends a short fidelity line:

> `Lock the exact identity of the person in reference image A — face, bone structure, skin tone, all unique features.`
>
> `… the person from reference image A …`

The lock is **opt-in and editable** per reference: turn it on when you need it, and either keep the
built-in wording (tuned per type — person / face / creature / location) or replace it with your own.
Left off, your prompt stays terse and you remain in full control of any fidelity language.

**In the editor** you can also flip the lock **per `@`-mention**: open a character or location pill's
menu and toggle **Identity lock** (a named plain image, creature or object takes the same trailing
sentinel, typed directly — `@town:1~lock`, `@nessie:1~lock`). That mention then serializes a trailing `~lock`
(`@kira:1:face~lock`, `@old-library:1:background~lock`) and its reference gets the lock line — even
when the source's default lock is off. Locations use their own built-in wording:

> `Lock the exact look of reference image A — match the location's architecture, layout, and lighting.`

The reverse is also available: a trailing **`~nolock`** (`@kira:1:face~nolock`) forces the lock
**off** for that one mention — even when the reference's own default lock is on. So `~lock` and
`~nolock` are a symmetric pair: force-on and force-off; a mention with neither simply inherits the
reference's default. `~nolock` is typed directly into the prompt (the pill menu's toggle only sets
force-on or inherit).

The per-mention toggles apply to the default (hybrid) reference format only.

## Combining references

Wire several references and label each one — the model composes them:

> *"A portrait of **the person from reference image A** wearing **the clothes from reference image B**,
> standing in **the background from reference image C**, lit by **the lighting from reference image D**."*

References are numbered **image-refs first, then assets**, in the order they appear, and the same
numbering drives both the prompt phrasing and the images sent to the model — so what you see in the
final-prompt preview is exactly what runs.

## API / SDK / MCP / CLI

The role label and identity-lock travel on the structured `connectedReferences` shape, so server-side
callers control them too. See [API Integration](./api-integration.md) and the
[SDK Reference](./sdk-reference.md) for the `connected_references` fields, and [CLI](./cli.md) for the
passthrough flags.

## See also

- [Reference Boards Guide](./reference-boards-guide.md) — building identity-consistent boards and cast grids
- [Character Platform](./character-platform.md) — scripting Character Studio
- Asset nodes: [Character](./nodes/assets/character.md) · [Location](./nodes/assets/location.md) · [Object](./nodes/assets/object.md) · [Creature](./nodes/assets/creature.md)
