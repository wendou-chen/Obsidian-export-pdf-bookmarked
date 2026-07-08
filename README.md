# Bookmarked PDF Export

Export Obsidian notes to PDFs with native bookmarks generated from Markdown headings.

This plugin turns a note's heading structure into a real PDF outline tree, so PDF readers can show the document outline/bookmarks panel immediately after export. It also keeps the original outline workflow: you can copy or export a note outline as Markdown.

## Features

- Export the current note as `*.bookmarked.pdf`.
- Add bookmarks to a PDF exported by Obsidian's native PDF workflow.
- Generate bookmarks from Markdown headings.
- Open exported PDFs with `/Outlines` and `/PageMode /UseOutlines`.
- Copy or export the current note outline as Markdown.

## Commands

| Command | What it does |
| --- | --- |
| Copy current file outline as Markdown | Copies the note heading tree to the clipboard. |
| Export current file outline as Markdown | Writes a `*.outline.md` file beside the source note. |
| Export bookmarked PDF | Prints the current note to `*.bookmarked.pdf` and injects native PDF bookmarks. |
| Add bookmarks to native PDF | Finds a matching PDF and adds bookmarks based on the source Markdown headings. |

PDF commands are available in the Obsidian desktop app because they depend on Electron PDF export APIs.

## Why This Exists

Obsidian can export notes to PDF, and several community plugins can improve export styling or long-form publishing. The missing piece for study notes, manuals, and book-like documents is reliable native PDF bookmarks generated from the Markdown heading structure.

This plugin focuses on that narrow job: keep writing in Markdown, export to PDF, and preserve the outline as clickable PDF bookmarks.

## Plugin Survey

The current local investigation found one plugin in this vault that provides native PDF bookmarks:

| Plugin | PDF export | Native PDF bookmarks | Notes |
| --- | --- | --- | --- |
| Bookmarked PDF Export (`outline-markdown-export`) | Yes | Yes | Writes `/Outlines` and sets `/PageMode /UseOutlines` with `pdf-lib`. |
| Obsidian core PDF export | Yes | Not reliably from Markdown headings | Useful as a source PDF for the "add bookmarks" command. |
| General outline/TOC plugins | Usually no | Usually no | They often create Markdown outlines or note navigation, not PDF outline objects. |

## Installation From Source

```bash
npm install
npm run build
```

Then copy or keep these files in your vault plugin folder:

```text
.obsidian/plugins/outline-markdown-export/
  main.js
  manifest.json
```

Enable the plugin in Obsidian community plugin settings.

## Development

```bash
npm install
npm run dev
npm test
```

The test suite checks outline parsing, export paths, heading filtering, page mapping, and PDF outline injection.

## Limitations

- PDF export commands require Obsidian desktop.
- Bookmarks are generated from Markdown headings.
- Adding bookmarks to an already exported PDF depends on matching heading text to PDF page text, so scanned/image-only PDFs may not map well.
- The default PDF bookmark filter targets the top heading levels to keep exported outlines readable.

## GitHub Repository Metadata

Suggested GitHub description:

> Export Obsidian notes to PDFs with native bookmarks generated from Markdown headings.

Suggested topics:

```text
obsidian-plugin, obsidian, markdown, pdf, bookmarks, outline, typescript
```

## License

MIT
