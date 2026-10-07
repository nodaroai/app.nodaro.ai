# Nodaro Site Capture

Captures one web page the way a phone shows it: a full-page screenshot, section screenshots and a section map. Hides cookie pop-ups without accepting them. Built for Nodaro; its source is public in the Nodaro app repository.

## What it does

- Opens one `http(s)` page in a headless Chromium configured as a Pixel 7 phone (Playwright's own device descriptor: viewport, device scale factor, touch, mobile).
- Runs the caller's page script (`pageScript` input) against that page. The script decides what is captured: it writes the full-page screenshot and the section screenshots to the run's key-value store and returns one dataset item with the section map.
- On a navigation or script failure, writes one error item (`"#error": true`, with the stage and the message) instead.

## How it identifies itself

Every request carries the phone's user agent with this token appended:

```
NodaroCapture/1.0 (+https://nodaro.ai/capture)
```

## Consent pop-ups

Cookie and consent banners are hidden from the screenshots. Nothing on them is clicked, so no consent is given on the visitor's behalf.

## Proxy

Off by default: the page is loaded over a direct connection. A proxy is used only when the input opts in explicitly. Residential proxy groups are refused.

## Input

| Field | Required | Meaning |
|-------|----------|---------|
| `url` | yes | The `http(s)` page to load. |
| `pageScript` | yes | Source of an `async function(context)` that receives `{ page, response, request, Actor }` and returns the dataset item. |
| `maxStills` | no | Informational; the page script carries its own limit. |
| `proxyConfiguration` | no | Off unless `useApifyProxy: true` or `proxyUrls` is set. |

## Versions

The Playwright version in `package.json` and the base image tag in `Dockerfile` are pinned to the same release, since the image ships the browser build that exact Playwright version expects. Bump them together.
