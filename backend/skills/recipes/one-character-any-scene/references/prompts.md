# Prompt lines — one-character-any-scene

Every line below is a COMPLETE prompt for one `generate-image` combination node
with two wired references (Source A = `{image:1}`, Source B = `{image:2}`).
Copy the line, do not decorate it with extra description.

## The five core patterns

```
{image:1:person} with {image:2:face}
```
Body, outfit, pose, and scene from image 1; the face identity from image 2.

```
{image:2:person} with {image:1:face}
```
The same two references, transplant reversed.

```
{image:1:background} with {image:2:person}
```
Image 1 contributes ONLY the stage; the whole person comes from image 2.

```
{image:1:person} in {image:2:settings}
```
Relocation: the person from image 1 placed inside image 2's environment.

```
{image:1:person} Wearing {image:2:jacket} on top, at {image:2:settings}
```
Two different labels pull the garment AND the location from the same image 2.

## Variations that keep working

- Swap `jacket` for any concrete garment/prop word visible in the reference:
  `dress`, `sunglasses`, `helmet`, `handbag`.
- Add ONE new-information clause when nothing referenced covers it:
  `{image:1:person} in {image:2:settings}, golden hour backlight`.
- Three references compose the same way — `{image:1:person} with {image:2:face},
  in {image:3:settings}` — wire them in that order.

## Anti-patterns (observed failures)

- `A beautiful woman with long hair {image:1:person} …` — re-describing the
  person fights the reference; identity drifts.
- Glamor/body-emphasis glue words around a person+face merge — raises the odds
  of a provider content-policy rejection. Keep glue words neutral.
- Reusing one combination node for a second goal by rewriting its prompt after a
  good result — add a new node instead; the old result documents what worked.
