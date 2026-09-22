# Styrdokument-RAG

A chatbot that answers questions about a Swedish student union's governing documents (stadga, reglemente, policies, guidelines, annual plans), with every answer grounded in the documents and citing the source PDF and section. If the archive does not contain the answer, the bot says so rather than guessing.

This is the template version of [LinTek's governing documents bot](https://github.com/Bjorne212/linus). Everything specific to one union lives in a single file, `kar.config.json`; the rest of the code is shared. The whole system runs inside the free tiers of GitHub and Cloudflare.

**Documentation (Swedish): <https://bjorne212.github.io/styrdokument-rag/>**

## Setting it up for a new union

The full walkthrough is in the documentation under [Kom igång](https://bjorne212.github.io/styrdokument-rag/kom-igang/). In short:

1. Click **Use this template** to create your own repository.
2. Describe the union and its document archive in `kar.config.json`, then run `node scripts/configure.mjs`.
3. Replace the logo, favicon and accent colours.
4. Create a Vectorize index and an API token in Cloudflare.
5. Add `CLOUDFLARE_ACCOUNT_ID` (variable), `CLOUDFLARE_API_TOKEN` and `SHARED_PASSWORD` (secrets) to the repository.
6. Push. GitHub Actions deploys the chat and keeps the index in sync every six hours.

## Document sources

Unions publish their documents in different ways. `source.type` in `kar.config.json` selects how the archive is read:

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
   │  4. Upsert, delete removed documents             │  1. Password check
   ▼                                                  │  2. Embed question, top 8 from Vectorize
Cloudflare Vectorize  ◄───────────────────────────────┤  3. Prompt that forbids answering outside them
                                                      │  4. Stream the answer, sources first
```

## Repository layout

```
kar.config.json  The union's configuration                (read by every part)
shared/          Typed loader for the configuration
ingestion/       Scraping, extraction, chunking, embedding (GitHub Actions)
worker/          Chat API and site                        (Cloudflare Workers)
frontend/        Interface source                         (React, built to pages/)
local/           Development and evaluation tools         (Ollama)
eval/            Evaluation questions with known answers
scripts/         configure.mjs: validates the configuration
docs/            Documentation site                       (GitHub Pages)
examples/        Example configurations for other source types
```

The repository ships configured for LinTek, the reference instance. `ingestion/duplicates.json`, `eval/questions.json` and `worker/src/glossary.json` contain LinTek's data and should be reset for another union, as described in the setup guide.

## Publishing the documentation

The documentation is a Jekyll site in `docs/`. Enable it under **Settings → Pages → Deploy from a branch → `main` / `docs`**. GitHub builds it on every push.

## License

[CC BY 4.0](LICENSE). Use, modify and redistribute freely, including commercially, as long as you credit **Theodor Lindberg**.
