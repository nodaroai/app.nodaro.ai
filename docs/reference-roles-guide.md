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
| Location | `background` |
| Object | `object` |
| Animal / Creature | `creature` |
| Face | `face` |
| Plain image / upload | **`ref-only`** (bare reference) |
| Video / audio | **`ref-only`** (bare reference) |

Plain images, video, and audio default to **ref-only** — see [Ref only](#ref-only) below.

## Preset roles

Click a reference pill to pick its role from a curated, type-aware menu (most-useful first; the
default is **bold**). **Custom…** is always available for anything not listed.

| Source | Preset roles |
|--------|--------------|
| **Character / Person** | ref-only · **person** · face · clothes · hair · pose · expression · style |
| **Location** | ref-only · **background** · atmosphere · as-is · empty background · layout · lighting · style |
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
defaults — person / background / object / creature — are unchanged). A Character or Location pill set
to ref-only serializes as a plain role (`@kira:1:ref-only`) and shows a compact **ref** badge to set
it apart from its described default.

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
menu and toggle **Identity lock**. That mention then serializes a trailing `~lock`
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
