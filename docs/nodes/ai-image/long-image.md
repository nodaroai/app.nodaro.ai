# Long Image

> Make one very tall picture from a prompt: a whole webpage design, or a product detail page from one to three product pictures.

## Overview

Long Image designs a whole page in one picture, top to bottom. It has two modes:

- **Webpage design** — a landing page, a portfolio, a menu, any page you describe. Add a **style picture** to borrow its look and layout, and a **subject picture** whose subject is kept in the page.
- **Product page** — the detail page of a shop listing, section by section, built around one to three pictures of your product. Pick how long the page is.

The result is one image, far taller than it is wide. The node shows its top; open it to see the whole page.

## How it works

1. Pick the mode in the settings.
2. Write a prompt (or wire one into **Prompt**).
3. For a product page, wire one to three product pictures into **Product image 1**, **2** and **3**. For a webpage design, optionally wire a **Style image** and a **Subject image**.
4. Run the node.

### Naming the pictures in the prompt

The prompt can point at each picture by name:

- Product page: `@image_1`, `@image_2` and `@image_3` are the pictures wired into **Product image 1**, **2** and **3**. A gap is closed for you: with pictures in **Product image 1** and **3** only, `@image_3` still names the picture in **Product image 3**. A picture wired into two inputs is sent once.
- Webpage design: `@style` is the style picture and `@subject` the subject picture.

Any other `@` before a letter, a digit or `_` — an e-mail address like `hello@shop.com`, a handle like `@shop`, or a name for a picture the run does not send — is sent as the full-width `＠` (`hello＠shop.com`, `＠shop`): the model reads every plain `@` before such a character as a picture's name and refuses a name it was not sent, and the full-width sign is its own way to write an `@` it does not read, so the page still shows the sign.

Pictures wired into the other mode's inputs are not sent (the settings say so), and the run is not charged for them.

## Inputs

| Handle | Type | Required | Description |
|--------|------|----------|-------------|
| Prompt | text | **Yes** (or typed in the settings) | What to make, up to 20,000 characters. Wired text replaces the prompt typed in the settings. |
| Product image 1, 2, 3 | image | Product page: at least one | The product pictures. JPEG or PNG, at least 300 pixels a side, between 2:5 and 5:2 (a smaller picture is enlarged; another file type is converted first). A picture of another shape fails the run once it has started, naming the picture, and the run is refunded. |
| Style image | image | No | Webpage design: a picture whose look and layout the page borrows. JPEG or PNG (another file type is converted first). |
| Subject image | image | No | Webpage design: a picture whose subject is kept in the page. JPEG or PNG (another file type is converted first). |

A picture input that is wired but whose node made no picture (it has not run yet in a workflow, or it failed) stops the run before anything is charged, naming the input.

## Outputs

| Handle | Type | Description |
|--------|------|-------------|
| Image | image | The long picture. Its size and file type are what the model returns (PNG or JPEG); a picture over the stored-image size limit is re-encoded to fit it. |

## Configuration

| Field | Default | Description |
|-------|---------|-------------|
| **Mode** (`mode`) | `webpage` | `webpage` (Webpage design) or `ecommerce` (Product page). |
| **Page length** (`length`) | `medium` | Product page only: `short` (about 2–5 sections), `medium` (about 6–10) or `long` (about 11–18). The sections are parts of the one picture. |
| **Size** (`resolution`) | `2K` | `1K` or `2K`. |
| **Prompt** (`prompt`) | empty | Up to 20,000 characters. |

### In a published app

An app built on a workflow with this node can let its users pick the **Size** (`1K` or `2K`) and, for a product page, the **Page length** (`short`, `medium` or `long`). Any other value is refused before the run starts.

## Credit Cost

A run is charged by its mode, its page length (a product page), its size and how many pictures it sends. The Run button and the settings show the price for the pictures wired now. Without pictures:

| Mode | 1K | 2K |
|------|----|----|
| Webpage design | 273 credits<!-- credits: long-image:webpage:1K --> | 296 credits<!-- credits: long-image:webpage:2K --> |

Product page, with one product picture:

| Page length | 1K | 2K |
|-------------|----|----|
| Short | 119 credits<!-- credits: long-image:ecommerce:short:1K:1ref --> | 142 credits<!-- credits: long-image:ecommerce:short:2K:1ref --> |
| Medium | 235 credits<!-- credits: long-image:ecommerce:medium:1K:1ref --> | 274 credits<!-- credits: long-image:ecommerce:medium:2K:1ref --> |
| Long | 390 credits<!-- credits: long-image:ecommerce:long:1K:1ref --> | 428 credits<!-- credits: long-image:ecommerce:long:2K:1ref --> |

Each picture sent adds a little:

| Example | Charged |
|---------|---------|
| Webpage design at 2K with a style picture | 297 credits<!-- credits: long-image:webpage:2K:1ref --> |
| Webpage design at 2K with a style and a subject picture | 300 credits<!-- credits: long-image:webpage:2K:2ref --> |
| Product page, medium, 2K, with three product pictures | 278 credits<!-- credits: long-image:ecommerce:medium:2K:3ref --> |
| Product page, long, 1K, with two product pictures | 391 credits<!-- credits: long-image:ecommerce:long:1K:2ref --> |

A run makes one picture and is charged its price when it starts; a run that fails, including one whose picture cannot be saved, is refunded. A run estimate (the editor's, `POST /v1/credits/estimate-workflow`, a published app's price) counts each picture input of the mode that carries a wire, as the run is charged; an estimate made without the workflow's wires counts the most pictures the mode can send (two for a webpage design, three for a product page), so it is never below the run. Community and Business editions have no credits.

## API

`POST /v1/long-image` with `{ mode?, prompt, resolution?, length?, productImageUrls?, styleImageUrl?, subjectImageUrl?, sessionId?, origin? }` queues a job and answers `{ jobId }`.

- `mode`: `webpage` (default) or `ecommerce`.
- `productImageUrls` (`ecommerce` only): one to three picture links. The first is `@image_1`; an entry may be `null` to keep the numbering of the ones after it.
- `styleImageUrl`, `subjectImageUrl` (`webpage` only).
- `length` (`ecommerce` only): `short`, `medium` (default) or `long`. `resolution`: `1K` or `2K` (default).

A request that mixes the two modes' fields, has an empty prompt, or is a product page with no product picture answers `400 validation_error` before any credits are held. An `Idempotency-Key` header makes a retry answer the job the first request started (`{ jobId, deduped: true }`) instead of starting a second one, however long after the first request it comes. `POST /v1/quote` with `{ "type": "long-image", "params": { … } }` prices a request without running it.

The finished job's `output_data.imageUrl` is the picture and `output_data.imageMimeType` its file type. See [API Integration](../../api-integration.md).
