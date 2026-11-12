# Upscale Image

> Increase the resolution of an image with Recraft, Topaz or Nodaro Image Upscale.

## Overview

Upscale Image enhances an existing image to a higher resolution. It offers three providers: **Recraft Upscale** for fast, low-cost enhancement, **Topaz Upscale** for premium AI upscaling with an explicit 1x / 2x / 4x factor, and **Nodaro Image Upscale**, which goes up to 8x, keeps any lettering in the picture exactly as written and is priced by the size of the image it makes. Unlike [Modify Image](./modify-image.md), this node does not take a prompt — it is a pure enhancement utility. The default provider is Recraft Upscale.

## How it works

- Connect a source image to the input handle (from Upload Image, Generate Image, or any image-producing node).
- Pick a provider.
- For Topaz, choose an **Upscale Factor** (1x enhance-only, 2x, or 4x). For Nodaro Image Upscale, choose 1x (enhance only), 2x, 4x or 8x. Recraft has no extra options.
- Switching to a model that does not offer the chosen factor (Nodaro Image Upscale at 8x, then Topaz) sets the factor that model will run at: 2x.
- The node returns the upscaled image.

## Supported Providers

| Provider | Description |
|----------|-------------|
| Recraft Upscale | Fast, high-quality upscaling and enhancement. No additional configuration. |
| Topaz Upscale | Premium AI upscaling with a configurable factor (1x / 2x / 4x). Higher factors, and very large outputs, cost more credits. |
| Nodaro Image Upscale | Upscaling at 1x / 2x / 4x / 8x that restores detail and keeps lettering exactly as written. Priced by the size of the output. |

## Pricing

| Provider / Setting | Credits |
|--------------------|---------|
| Recraft Upscale | 3<!-- credits: recraft-upscale --> |
| Topaz Upscale (1x / 2x) | 28<!-- credits: topaz-image-upscale --> |
| Topaz Upscale (4x) | 55<!-- credits: topaz-image-upscale:4K --> |
| Nodaro Image Upscale, output up to 4,194,304 pixels (2048 × 2048) | 5<!-- credits: nodaro-image-upscale:2K --> |
| Nodaro Image Upscale, output up to 16,777,216 pixels (4096 × 4096) | 11<!-- credits: nodaro-image-upscale:4K --> |
| Nodaro Image Upscale, output up to 67,108,864 pixels (8192 × 8192) | 33<!-- credits: nodaro-image-upscale:8K --> |

**Very large Topaz outputs cost more.** Topaz is billed by the size of the image it produces. Up to 24 megapixels out (for example a 2× of anything up to about 2400 × 2400, or a 4× of up to about 1200 × 1200) costs the price above. A larger output costs the 1× / 2× price once per size step, whenever that is more than the price above:

| Output size | Steps |
|---|---:|
| up to 24 MP | 1 |
| up to 48 MP | 2 |
| up to 60 MP | 3 |
| up to 96 MP | 4 |
| up to 132 MP | 5 |
| up to 168 MP | 6 |
| up to 336 MP | 11 |
| up to 512 MP | 17 |

For example, a 4× upscale of a 2048 × 2048 image produces about 67 megapixels (4 steps) and costs **110**<!-- credits: topaz-image-upscale@4 --> credits instead of 55<!-- credits: topaz-image-upscale:4K -->. An upscale that would produce more than **512 megapixels** is refused before anything is charged. Choose a smaller factor or a smaller image. If the image's size cannot be read before the run, the price above is charged. A deployment that turned off links to other sites refuses a Topaz Upscale of such a link before anything is read or charged (`403 link_imports_disabled`), on every edition and in a workflow run alike: upload the picture instead.

The node's Run button shows the price for the selected provider and factor; the size step is applied when the run starts and the image is measured.

Topaz returns a lossless **PNG** for outputs up to 24 megapixels, and a **JPG** above that (a PNG that large can run to 100 MB or more).

## Nodaro Image Upscale

Nodaro Image Upscale multiplies the image's width and height by the factor exactly, and crops nothing: a 1024 × 768 picture at 4x comes back 4096 × 3072. **1x** keeps the size and only enhances the picture. Detail is restored, and any text in the picture — signs, labels, logos — is kept exactly as written, never redrawn.

- **Format.** A JPEG comes back as a JPEG and a WebP as a WebP; other pictures come back as PNG or WebP. A transparent background comes back filled with white.
- **Where it is offered.** Nodaro Image Upscale runs only on deployments that offer it. Elsewhere it is not listed, and a run that names it is refused with `403 model_not_available` before anything is charged.
- **Inputs** up to 20 MB. A picture from a link to another site is first copied to this deployment's storage, and the copy is what is measured, priced and upscaled; a picture already stored here is used as it is. The job keeps the link it was given as its `imageUrl`, so running it again starts from that link. A deployment that turned off links to other sites refuses such a link (`403 link_imports_disabled`): upload the picture instead.
- **Refusals of the picture**, before anything is charged: `input_too_large` (over 20 MB), `input_wrong_kind` (not an image), `input_unreadable` (the link could not be read), `input_refused` (its size could not be read). `input_busy`, `input_timed_out` and `input_failed` mean the picture could not be fetched just now: try again in a moment.
- **Largest output:** 67,108,864 pixels in total (8192 × 8192) and 16,384 pixels on a side. An upscale past either is refused before anything is charged — choose a smaller factor or a smaller image.
- **A run refused for its picture** fails, and its credits are refunded. A picture blocked by the content policy fails with "This picture was blocked by the content policy, so Nodaro Image Upscale could not upscale it. Topaz Upscale or Recraft Upscale may accept it." A picture it could not read fails with "Nodaro Image Upscale could not read this picture. Send a PNG, JPEG or WebP image, or try Topaz Upscale or Recraft Upscale."

### Price

The price follows the **output's** total pixels (width × height of the image it makes); a 1x run is priced by the picture's own size:

| Output (total pixels) | Credits |
|---|---:|
| up to 4,194,304 (2048 × 2048) | 5<!-- credits: nodaro-image-upscale:2K --> |
| up to 16,777,216 (4096 × 4096) | 11<!-- credits: nodaro-image-upscale:4K --> |
| up to 67,108,864 (8192 × 8192) | 33<!-- credits: nodaro-image-upscale:8K --> |

Worked examples, for a 1024 × 1024 picture:

| Factor | Output | Credits |
|---|---|---:|
| 1x | 1024 × 1024 (1,048,576 pixels) | 5<!-- credits: nodaro-image-upscale:2K --> |
| 2x | 2048 × 2048 (4,194,304 pixels) | 5<!-- credits: nodaro-image-upscale:2K --> |
| 4x | 4096 × 4096 (16,777,216 pixels) | 11<!-- credits: nodaro-image-upscale:4K --> |
| 8x | 8192 × 8192 (67,108,864 pixels) | 33<!-- credits: nodaro-image-upscale:8K --> |

A step starts one pixel past the one before it: a 1025 × 1025 picture at 2x makes 2050 × 2050 (4,202,500 pixels) and costs 11<!-- credits: nodaro-image-upscale:4K -->. A 1100 × 1100 picture at 8x (8800 × 8800, 77,440,000 pixels) is refused, and so is a 2100 × 400 picture at 8x: 16,800 × 3,200 is under the pixel limit, but its long side is over 16,384.

The Run button and the workflow estimate price the picture at the size its source node records (an upload, or a generated result); when the source records none, they show 33<!-- credits: nodaro-image-upscale -->. The run reads the picture's real size before anything is charged. **If that size can't be read**, the run holds 33<!-- credits: nodaro-image-upscale --> credits, reads the size again from the stored picture before it starts, and is charged the step of the image it actually delivers; the rest is refunded when it finishes (and if the delivered image's size can't be read, the 33<!-- credits: nodaro-image-upscale --> held is charged). If the size still can't be read when the run starts, nothing is upscaled and nothing is charged: the run fails with "Nodaro Image Upscale could not read this picture. Send a PNG, JPEG or WebP image, or try Topaz Upscale or Recraft Upscale." and the 33<!-- credits: nodaro-image-upscale --> held are refunded.

### The price before a run (API)

`POST /v1/quote` with `{ "type": "edit-image", "params": { "provider": "nodaro-image-upscale", "imageUrl": "…", "upscaleFactor": "4" } }` — exactly the body a run sends to `POST /v1/edit-image` — answers the exact price of that picture at that factor, without starting anything. The platform reads the picture the way a run does (the same 20 MB limit, the same refusals, this deployment's upload checks, a link to another site only where this deployment imports links) and measures it, but stores nothing. A quote gives a picture 15 seconds to arrive: a link that takes longer is answered `503 input_timed_out` (try again, or upload the picture), and a quote whose caller hangs up stops reading at once. `identifier` is the step it is priced at and `reserve` its credits; an `output_size` adjustment names the output it priced. A 1024 × 1024 picture at 4x quotes `nodaro-image-upscale:4K`, 11<!-- credits: nodaro-image-upscale:4K --> credits — what the run then holds and is charged. A picture whose size can't be read quotes the hold, 33<!-- credits: nodaro-image-upscale --> credits, with the warnings `image_size_unmeasured` and `settles_to_actual` (the most the run can cost). An upscale past the largest output gets the run's own `400`, and on a deployment that does not offer Nodaro Image Upscale the quote is refused with `403 model_not_available` before the picture is read. SDK: `client.nodes.quote("edit-image", body)`; see [Run quotes](../../api-integration.md#run-quotes).

Topaz and Recraft upscales are quoted the same way: Topaz at its factor's price, or by size steps for a very large output (an `output_size` adjustment; `image_size_unmeasured` when its size can't be read before the run), Recraft at its flat price.

## Tips

- On Recraft Upscale and Topaz Upscale, HEIC/HEIF and AVIF photos and other non-JPEG formats are converted before the run, so they work as inputs even where the model itself only takes JPEG, PNG or WebP. The conversion is lossless wherever the model accepts a lossless format, so transparency and fine detail survive it.
- Nodaro Image Upscale converts nothing: it upscales the picture as it was sent. Send it a PNG, JPEG or WebP picture.
- This matters most for images supplied by URL through the API, which can arrive in any format — the in-app uploader already restricts what it accepts.
