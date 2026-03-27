# foyerizer

## Scripts

| Script | Usage | Description |
|---|---|---|
| `generateEverything.js` | `node generateEverything.js [--summarise] <export_dir>` | Run all generators in order, saving outputs to `output-corpi/YYYY-MM-DD_HH-MM_Root-Page-Name/`. |
| `generateCorpus.js` | `node generateCorpus.js [--summarise] <export_dir>` | Crawl a Notion export and produce a single XML corpus file. Automatically transcribes embedded Canva links. |
| `transcribeCanva.js` | `node transcribeCanva.js [--no-transcribe] <canva_url>` | Capture slides from a Canva presentation as screenshots and transcribe each via Gemini. |
| `generateFunFacts.js` | `node generateFunFacts.js <corpus.xml>` | Generate funny haikus from a corpus using GPT-5.4, one per content chunk. Outputs `funFacts.json` alongside the corpus. |
| `generateExampleQuestions.js` | `node generateExampleQuestions.js <corpus.xml>` | Generate example questions from a corpus using GPT-5.4. Tries whole corpus first, falls back to page-by-page. Outputs `exampleQuestions.json` alongside the corpus. |
| `markdownifyUrl.js` | `node markdownifyUrl.js <url>` | Fetch a URL via Playwright and convert the rendered HTML to markdown. *(not currently used in the pipeline)* |
