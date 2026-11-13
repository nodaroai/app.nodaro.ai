# Split into Layers

> Pull one picture apart into a base picture and separate layers — each element on its own transparent PNG — with each layer's name, description, position box and stacking order.

## Overview

Split into Layers takes one image and finds its elements: a person, an animal, a product, a line of text, a logo. Each element comes back as its own **layer**, a transparent PNG cut out to that element, together with a **base** picture (the scene behind them) and **layer data** that says what each layer is and where it sits. Edit, animate or replace the layers one by one, then put them back together.

Leave **What to separate** empty and the node finds the main elements itself, or describe the elements you want.

## How it works

1. Connect an image (Upload Image, Generate Image or any node that outputs an image), or upload one on the node.
2. Set **Max layers** and **Size**, and optionally describe what to separate.
3. Run the node. A run usually takes under a minute.
4. The node shows the base picture and a strip of the layers, each with its name.

## Inputs

| Handle | Type | Required | Description |
|--------|------|----------|-------------|
| Image | image | **Yes** | The picture to split: JPEG, PNG or WebP. A larger or other file (HEIC, AVIF, …) is converted first. A wired Character, Object or Location is used as the image. |

## Outputs

| Handle | Type | Description |
|--------|------|-------------|
| Base | image | The base picture (an opaque PNG). |
| Layers | image list | Every layer, bottom to top: transparent PNGs, each cut out to its element. |
| Layer data | json | One entry per layer, in the same order as **Layers** (below). |

**Layers** is a list. A wire from it runs the next node **once per layer** (Each, the default): wire it into Upscale Image to upscale every layer, or into Generate Video to animate each one. Set the wire to **Bundle** to hand every layer at once to a node that takes several images, such as Image Collage or Generate Image's references.

### Layer data

```json
[
  {
    "name": "Arctic fox",
    "description": "The full body of the standing white arctic fox, with no background.",
    "zIndex": 1,
    "width": 1108,
    "height": 946,
    "box": { "x1": 228, "y1": 482, "x2": 897, "y2": 1070 },
    "boxNormalized": { "x1": 223, "y1": 314, "x2": 875, "y2": 696 },
    "url": "https://…/layer.png",
    "baseUrl": "https://…/base.png"
  }
]
```

- `zIndex`: the stacking order. 1 sits on the base; a higher number is drawn above.
- `box`: where the layer sits on the base picture, **in the base's pixels** — `x1`, `y1` the top-left corner, `x2`, `y2` the bottom-right.
- `boxNormalized`: the same box on a 0–1000 scale of the base's width and height.
- `width`, `height`: **the layer file's own pixels**. A layer is not cut at the base's scale: it is cropped to its element and saved at about the Size's pixel budget (about one megapixel at 1K), at the element's own shape. To put a layer back in place, scale it to its `box`.
- `name`, `description`: what the element is. A layer may come without them.
- `url`: the layer's file (the same as its entry in **Layers**).
- `baseUrl`: the base picture the layer was cut from (the same as **Base**).

### Several pictures in one run

Wire a list of pictures into **Image** (a List of image links, or a node that makes several images on an Each wire) and the node runs once per picture. Each run's result is its own take, with that picture's base, layers and layer data. Then:

- **Base** lists one base picture per picture that produced a result, in the order the pictures came in. A picture whose run failed has no base, so it is left out of the list.
- **Layers** hands on every picture's layers, picture by picture: an Each wire runs the next node once per layer of every picture (the first picture's layers, then the second's, and so on), Bundle hands them all at once, and `item:N` picks from the whole list. A list node (Filter List, Sort List and the like) collects every picture's layers too.
- **Layer data** lines up with those layers one for one. Each entry also carries `row`: the number of the input picture it came from, counting from 0. A picture with no layers adds nothing to **Layers** or **Layer data**, and neither does a picture whose run failed, but each keeps its number, so `row` can skip a number.

To pair a layer with its base, use its `baseUrl`, not `row`. **Base** lists only the pictures that produced a result, so once a picture fails, a later picture's `row` no longer matches its place in **Base**. In the example below, the second picture failed: the owl's base is the second item of **Base**, while its `row` is 2.

```json
[
  { "name": "Fox", "zIndex": 1, "url": "https://…/fox.png", "baseUrl": "https://…/base-1.png", "row": 0 },
  { "name": "Owl", "zIndex": 1, "url": "https://…/owl.png", "baseUrl": "https://…/base-3.png", "row": 2 }
]
```

A run on one picture gives layer data without `row`, as above.

**The take you pick.** The node shows the layers of the take you are looking at; pick another take to see its picture's layers. A plain wire (one with no Each, Bundle or `item:N` set) follows that take, from every output: **Base** hands on its base picture, **Layers** its first layer (nothing when that picture made none) and **Layer data** its own entries, without `row` (`[]` when it made none). So does a node that reads one JSON value, such as Extract Field or JSON Process: wire it from **Layer data** and it reads the picked take's entries. An Each wire, a Bundle, `item:N` and a list node still hand on every picture's, whichever take you pick.

**A later run on one picture ends the batch.** Run the node again on a single picture and the batch is over: **Base** no longer lists the earlier pictures, and **Base**, **Layers** and **Layer data** all hand on the take you are looking at — the new one, or an older one you pick, each with its own layers and layer data. An Each wire from **Base** then fans out over nothing: the next node runs once, on that take. A run that fails, or that you discard or stop, keeps the batch as it was.

Before the first run, the run estimate counts an Each wire from **Layers** at Max layers for every picture, and an Each wire from **Base** at one run per picture; after a run, it counts what each wire will hand on.

## Configuration

| Field | Default | Description |
|-------|---------|-------------|
| **Max layers** (`maxLayers`) | 9 | The most layers a run makes, from 1 to 99. The base comes on top of them. A picture with more elements than this gets fewer, larger layers: elements are grouped, never dropped. |
| **Size** (`size`) | `1K` | The pixel budget of each image: `1K`, `1.5K` or `2K`, or `auto` — the picture's own size, between 1K and 2K. |
| **What to separate** (`prompt`) | empty | Optional, up to 2,000 characters: which elements to split out, in plain words. You can mark where an element is with `<bbox>x1 y1 x2 y2</bbox>`, the corners on a 0–1000 scale of the picture, e.g. `Separate the title <bbox>179 58 809 197</bbox> and the parrot <bbox>330 274 641 991</bbox>`. Empty, the node finds the main elements itself. |

### In a published app

An app built on a workflow with this node can let its users set **Max layers** (a slider from 1 to 20) and **Size** (`auto`, `1K`, `1.5K` or `2K`). The app's slider, and any workflow run's override, are held to those values: Max layers from 1 to 20, Size one of the four; anything else is refused before the run starts. An app sends only the values its user changed, so a run that leaves Max layers untouched keeps the value the creator saved on the node (up to 99 layers) and is held for that value — for example 50 layers saved on the node hold for 51 images. With the slider set to its top, 20 layers at `2K` hold 369 credits<!-- credits: split-into-layers:2k:21 -->.

## Credit Cost

A run is **held** for the most images it may return — its Max layers plus the base — and **charged only for the images it really returns**: the base and each layer. Sizes `1K` and `1.5K` cost the same; `2K` and `auto` cost more. The Run button shows the hold for the settings you chose.

| Example | Held | Charged |
|---------|------|---------|
| The default: 9 layers at 1K | 104 credits<!-- credits: split-into-layers:1k:10 --> | — |
| 3 layers returned at 1K (4 images) | | 44 credits<!-- credits: split-into-layers:1k:4 --> |
| 3 layers returned at 2K or `auto` (4 images) | | 74 credits<!-- credits: split-into-layers:2k:4 --> |
| Max layers 5 at 1K | 64 credits<!-- credits: split-into-layers:1k:6 --> | — |
| No element found: the base alone at 1K | | 15 credits<!-- credits: split-into-layers:1k:1 --> |

A run that finds no element completes with the base picture alone and is charged for that one image. If a layer cannot be saved after a few tries, the run completes without it and is charged only for the images it saved; the node says how many layers could not be saved (for example "2 of 9 layers could not be saved"). A run that fails, including one whose base picture cannot be saved, is refunded. Community and Business editions have no credits.

## Library

The base picture and every layer are filed in your Library; each layer is filed under its name.

## API

`POST /v1/split-into-layers` with `{ imageUrl, maxLayers?, size?, prompt?, sessionId?, origin? }` queues a job and answers `{ jobId }`; a malformed request answers `400 validation_error` before any credits are held. `sessionId` files the job in one of your sessions and `origin` tags it with your app's slug; an `Idempotency-Key` header makes a retry answer the job the first request started (`{ jobId, deduped: true }`) instead of starting a second one. That holds however long after the first request the retry comes, and the retry is answered before any credit check, so the credits the first run holds do not make its own retry fail with `402`. A request answered `500 internal_error` because its job could not be queued started nothing: that job is failed at once, its credits are returned, and a retry with the same key starts a new run. In the rare case that the failure cannot be confirmed, either it did not land, and a retry with the same key is answered with that job (if that job then fails, send the request again with a new key), or it landed with only its answer lost, and the key was freed with it, so a retry with the same key starts a new run.

The finished job's `output_data.imageUrl` is the base picture, `output_data.layers` the layer files in order, `output_data.layerData` the layer data above, `output_data.layerCount` the number of layers saved and `output_data.layersNotSaved` the number the model returned that could not be saved (0 when every layer was saved). See [API Integration](../../api-integration.md) and the [SDK Reference](../../sdk-reference.md) (`client.media.splitIntoLayers`). MCP: `split_into_layers`. CLI: `nodaro media split-layers`.

**The price before a run.** `POST /v1/quote` with `{ "type": "split-into-layers", "params": { … the same body … } }` answers the hold without starting anything: `identifier` is the row it holds (`split-into-layers:<1k|2k>:<images>`), `reserve` the credits, a `max_images` adjustment says how many images that is, and the warning `settles_to_actual` says it is the most the run can cost. Max layers 5 at 1K quotes 64 credits<!-- credits: split-into-layers:1k:6 -->; the default quotes 104 credits<!-- credits: split-into-layers:1k:10 -->. SDK: `client.nodes.quote("split-into-layers", body)`. A deployment that does not offer you the node refuses the quote as it refuses the run (`403 node_not_available`).

## Tips

- To recompose a picture, place each layer on the base at its `box`, in `zIndex` order.
- Fewer Max layers groups elements together (a whole headline in one layer); more keeps them apart.
- Describe the elements you need when the main ones are not the ones you want, e.g. "the logo and the price tag".
