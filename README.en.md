# Bookmarked PDF Export

[简体中文](README.md) | English

Export complete Obsidian notes or selected sections from the core Outline pane to PDFs with native bookmarks generated from Markdown headings.

This plugin turns a note's heading structure into a real PDF outline tree, so PDF readers can show the document outline/bookmarks panel immediately after export. It also keeps the original outline workflow: you can copy or export a note outline as Markdown.

## Primary Workflows

This plugin was built for two main workflows:

- Organizing postgraduate entrance exam syllabi and study materials. Long Markdown notes can be exported as book-like PDFs whose headings become clickable PDF bookmarks, which makes review documents easier to navigate. You can also copy or export only the section you need from the right-side Outline pane.
- Working together with my note repository, [MBA Study Notes](https://github.com/wendou-chen/MBA-Study-Notes). The notes live and evolve in Obsidian, while this plugin turns selected notes, outlines, and study packs into shareable bookmarked PDFs.

Used together, the note repository provides the structured knowledge base, and this plugin provides a clean export path from Markdown structure to readable PDF documents.

## Features

- Export the current note as `*.bookmarked.pdf`.
- Add bookmarks to a PDF exported by Obsidian's native PDF workflow.
- Generate bookmarks from Markdown headings.
- Open exported PDFs with `/Outlines` and `/PageMode /UseOutlines`.
- Copy or export the current note outline as Markdown.
- Precisely copy or export the complete Markdown section for a heading in Obsidian's core right-side Outline pane.
- Export a selected section as a bookmarked PDF on desktop.

## Export a Section From the Right-Side Outline

Right-click a heading in Obsidian's core right-side **Outline** pane to use:

1. **复制此节 Markdown** (Copy this section as Markdown)
2. **导出此节 Markdown** (Export this section as Markdown)
3. **导出此节带书签 PDF** (Export this section as a bookmarked PDF; desktop only)

The section starts at the selected heading and includes the heading itself, its body, and all descendant headings. It ends immediately before the next heading at the same or a higher level. If no such heading follows, the section continues to the end of the file. The original Markdown is preserved without renumbering or demoting headings.

Exports are written beside the source note:

- Markdown: `source-file--heading.section.md`
- PDF: `source-file--heading.bookmarked.pdf`

Invalid filename characters and excess whitespace are sanitized. If duplicate headings, or headings that sanitize to the same filename, would collide, the filename receives that heading's 1-based ordinal in the full document before the extension. Exporting the same section again overwrites its corresponding output.

A section PDF adds the source note's basename as a synthetic H1, which becomes both the visual top-level title and the root PDF bookmark. The selected heading and its descendants retain their original Markdown levels. The existing bookmark rules add PDF bookmarks for H1–H3 headings within the section.

### Live Content and Safe Failure

- If the source file is active or open in any Markdown editor, copy and export read the editor's latest snapshot, including unsaved changes. Otherwise, the plugin reads the Vault file.
- Duplicate headings are resolved by position and full-document ordinal, never by blindly choosing the first matching title.
- If the heading is changed or deleted after the context menu opens, the action stops safely and asks you to right-click again.
- Obsidian does not expose a public context-menu API for core Outline headings. The plugin isolates private Outline details in a validated adapter. If a future Obsidian release changes that structure, the section menu stays hidden or the action aborts rather than guessing and exporting the wrong section.

## Commands

| Command | What it does |
| --- | --- |
| Copy current file outline as Markdown | Copies the note heading tree to the clipboard. |
| Export current file outline as Markdown | Writes a `*.outline.md` file beside the source note. |
| Export bookmarked PDF | **Primary path**: native print + unique marker page mapping + outline write in one shot. Success notices show `matched/expected`; any incomplete match fails without writing the final file. |
| Add bookmarks to existing PDF (best-effort, not one-shot export) | **Secondary path**: best-effort text matching against an existing native PDF. Partial matches and wrong pages are possible; prefer one-shot export. |

PDF commands depend on Electron PDF export APIs and therefore require the Obsidian desktop app. Copying or exporting a section as Markdown remains available on mobile.

## Why This Exists

Obsidian can export notes to PDF, and several community plugins can improve export styling or long-form publishing. The missing piece for study notes, manuals, and book-like documents is reliable native PDF bookmarks generated from the Markdown heading structure.

This plugin focuses on that narrow job: keep writing in Markdown, export a complete note or a section selected from the right-side Outline, and preserve the heading structure as clickable PDF bookmarks.

## Plugin Positioning

| Tool or approach | PDF export | Native PDF bookmarks | Notes |
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

The test suite checks outline and section parsing, export paths, duplicate-heading resolution, heading filtering, page mapping, and PDF outline injection.

## Limitations

- PDF export commands and bookmarked section PDF export require Obsidian desktop.
- Bookmarks come from Markdown headings and default to **H1–H3** only.
- **One-shot export contract**: the final `*.bookmarked.pdf` is written only when every expected bookmark marker matches; incomplete matches fail hard and do not leave a bookmark-less "bookmarked" file.
- Output lands next to the source note (`*.bookmarked.pdf` or `source--heading.bookmarked.pdf`), not on the desktop or in a temp folder.
- Prefer external readers (Edge / SumatraPDF / Adobe) for the outline sidebar; Obsidian's built-in PDF view may not show `/Outlines`.
- Temporary UI freezes during export come from Obsidian's native `printToPdf` layout, not from the bookmark writer itself.
- "Add bookmarks to existing PDF" is best-effort text matching and can mis-page on repeated heading words; prefer one-shot export.
- Section context menus depend on a runtime-validated private structure in Obsidian's core Outline view. If it becomes incompatible, the feature fails closed instead of guessing a heading.

## GitHub Repository Metadata

Suggested GitHub description:

> Export Obsidian notes or Outline sections to PDFs with native bookmarks generated from Markdown headings.

Suggested topics:

```text
obsidian-plugin, obsidian, markdown, pdf, bookmarks, outline, typescript
```

## License

MIT
