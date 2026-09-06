---
"@nodaro/shared": minor
---

**@nodaro/shared**

- LLM catalog gains `gemini-3.8-flash` (KIE `gemini-3-8-flash-openai` chat-completions + direct `gemini-3.8-flash`; economy tier; reasoning low|high on KIE, full minimal→high ladder in Advanced mode; enforced `response_format` json_schema; 16384 output cap — measured on the KIE lane rather than inherited from its 8192-capped 3.6/3.7 siblings). Image-only modality caps by decision: it stays out of the video-analysis picker until the 3.8-vs-3.7 analysis A/B concludes.
- LLM catalog gains `gpt-6-astra` (KIE responses dialect on the OpenAI family path; premium tier; reasoning low|medium|high|xhigh, on by default with no reasoning param sent; enforced `text.format` json_schema; `temperature` silently ignored, so the registry does not offer it). Image-only inputs.
- `gemini-3.7-flash` and `gpt-5.6-sol` descriptions lose their superlatives — those belong to the current top model of each family, and a stale one steers quality-critical work backwards in every picker.
