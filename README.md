# Styrdokument-RAG

A chatbot that answers questions about a Swedish student union's governing documents (stadga, reglemente, policies, guidelines, annual plans), with every answer grounded in the documents and citing the source PDF and section. If the archive does not contain the answer, the bot says so rather than guessing.

This is the template version of [LinTek's governing documents bot](https://github.com/Bjorne212/linus). Everything specific to one union lives in one folder, `kar/`; the rest of the code is shared. The whole system runs inside the free tiers of GitHub and Cloudflare.

**Documentation (Swedish): <https://bjorne212.github.io/styrdokument-rag/>**

## Keeping it up to date

The bot reads the union's public document archive and nothing else, so updating it means updating the archive: publish the new PDF under the same filename, remove superseded versions, and the scheduled job picks up the change within six hours. See [Hålla dokumenten korrekta](https://bjorne212.github.io/styrdokument-rag/uppdatera/) and [Drift](https://bjorne212.github.io/styrdokument-rag/drift/) for routines, monitoring and handover between boards.

## Document sources

Unions publish their documents in different ways. `source.type` in `kar/kar.config.json` selects how the archive is read:

| Type | For |
|---|---|
| `html-links` | A web page per section with ordinary links to PDFs. The common case. |
| `pdf-list` | A hand-maintained list of PDF URLs, for archives that cannot be read automatically. |
| `gitlab-appender` | LinTek's GitLab Pages archive, where a JavaScript file fills in the document table. |

Adding a new type is about fifty lines in `ingestion/src/sources/`. See `examples/` for complete configurations.

## How it works

```
GitHub Actions (every 6 hours)                     Browser
   │  1. Cheap fingerprint per section                │  POST /api/chat
   │  2. Download changed PDFs, compare sha256        ▼
   │  3. Extract, chunk, embed (bge-m3)            Cloudflare Worker
   │  4. Upsert, delete removed documents             │  1. Password check, rate limit
   ▼                                                  │  2. Embed question, top 8 from Vectorize,
Cloudflare Vectorize  ◄───────────────────────────────┤     and ask the guard at the same time (add-on)
                                                      │  3. No hits, or REJECT: a fixed answer, no model call
                                                      │  4. Prompt with the documents as delimited data,
                                                      │     stricter if FILTERED
                                                      │  5. Stream the answer, sources first
```

## Guardrails add-on

Optional, and off unless the worker has a `GUARD_KEY` secret and `guardrails.url` is set in `kar/kar.config.json`; both come with the add-on. With them, each question and the earlier questions in the conversation (never the answers) go to a separate guard service, asked while the documents are searched. It answers with one of three routes:

| Route | What the worker does |
|---|---|
| `ALLOW` | Answers as usual |
| `FILTERED` | Answers with a stricter prompt, without the earlier conversation, in at most 400 tokens |
| `REJECT` | Sends a fixed text from `guardrails` in `kar/kar.config.json`, without calling the model |

If the guard is down, slow or rejects the key, the question is treated as `FILTERED`, so the bot keeps answering. The client is `worker/src/guard-client.ts`; the guard service itself is not part of this repository.

## Repository layout

```
kar/             Everything specific to the union: configuration, logo,
                 colors, evaluation questions and generated data
shared/          Typed loader for the configuration
ingestion/       Scraping, extraction, chunking, embedding (GitHub Actions)
worker/          Chat API and site                        (Cloudflare Workers)
frontend/        Interface source                         (React, built to pages/)
local/           Development and evaluation tools         (Ollama)
scripts/         configure.mjs: validates the configuration and writes worker/wrangler.toml
examples/        Example configurations for other source types
```

The repository ships with LinTek, the reference instance, in `kar/`:

| File | Contents |
|---|---|
| `kar.config.json` | Name, description, document source, Cloudflare names |
| `logo.png`, `favicon.png` | Shown in the interface |
| `theme.css` | The union's colors, applied on top of the neutral defaults |
| `eval/questions.json` | Evaluation questions with known answers |
| `glossary.json`, `duplicates.json` | Generated from the documents by the tools in `local/` |
| `manifest.json` | Written by the ingestion job, created on the first run |

For another union, replace the contents of `kar/` and nothing else. `worker/wrangler.toml` is not checked in: `scripts/configure.mjs` writes it from `worker/wrangler.template.toml`, and the worker's `dev` and `deploy` scripts run it first.

## Your own copy

Clone this repository rather than copying it, and keep it as a remote, so fixes reach your instance:

```bash
git remote add upstream https://github.com/Bjorne212/styrdokument-rag.git
git config merge.ours.driver true
git pull upstream main
```

The template never changes `kar/` once you have your own copy. `.gitattributes` keeps your version of `kar/` if it ever does, which is what the `merge.ours.driver` setting enables.

## Documentation

The documentation site is kept on the separate `gh-pages` branch, so it is not part of the code you get when you fork or copy `main`. It is published at <https://bjorne212.github.io/styrdokument-rag/>.

## License

[CC BY 4.0](LICENSE). Use, modify and redistribute freely, including commercially, as long as you credit **Theodor Lindberg**.
