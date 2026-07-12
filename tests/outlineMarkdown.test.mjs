import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const rootDir = path.resolve(import.meta.dirname, "..");
const tempDir = await mkdtemp(path.join(tmpdir(), "outline-markdown-export-test-"));

try {
  const bundlePath = path.join(tempDir, "outlineMarkdown.mjs");
  const pdfBundlePath = path.join(tempDir, "pdfOutline.mjs");
  await build({
    entryPoints: [path.join(rootDir, "src/outlineMarkdown.ts")],
    outfile: bundlePath,
    bundle: true,
    platform: "node",
    format: "esm",
    write: true,
    logLevel: "silent",
  });
  await build({
    entryPoints: [path.join(rootDir, "src/pdfOutline.ts")],
    outfile: pdfBundlePath,
    bundle: true,
    platform: "node",
    format: "esm",
    write: true,
    logLevel: "silent",
  });

  const {
    buildOutlineMarkdown,
    getBookmarkedPdfExportPath,
    getOutlineExportPath,
    getPdfBookmarkHeadings,
    getPrintableBookmarkedPdfMarkdown,
    getSectionExportPaths,
    hasPdfOutlines,
    locateMarkdownSection,
    mapPdfBookmarkHeadingsToPages,
    needsSyntheticPdfRootHeading,
    parseMarkdownHeadingRanges,
    parseMarkdownHeadings,
    sliceMarkdownSection,
  } = await import(pathToFileURL(bundlePath).href);
  const { PDFDocument, PDFName, PDFString } = await import("pdf-lib");
  const { addPdfBookmarks, finalizeBookmarkedPdf } = await import(pathToFileURL(pdfBundlePath).href);

  assert.equal(
    buildOutlineMarkdown(
      [
        { heading: "Probability", level: 2 },
        { heading: "Random variables", level: 3 },
        { heading: "Joint distribution", level: 4 },
        { heading: "Marginal distribution", level: 4 },
      ],
      "Chapter 3",
    ),
    [
      "# Chapter 3 大纲",
      "",
      "- Probability",
      "  - Random variables",
      "    - Joint distribution",
      "    - Marginal distribution",
    ].join("\n"),
  );

  assert.equal(
    buildOutlineMarkdown([
      { heading: "Starts at H3", level: 3 },
      { heading: "H4 child", level: 4 },
    ]),
    ["- Starts at H3", "  - H4 child"].join("\n"),
  );

  assert.equal(
    getOutlineExportPath("math/probability/chapter-3.md"),
    "math/probability/chapter-3.outline.md",
  );

  assert.equal(
    getBookmarkedPdfExportPath("a/b.md"),
    "a/b.bookmarked.pdf",
  );

  assert.equal(
    getBookmarkedPdfExportPath("a/b.pdf"),
    "a/b.bookmarked.pdf",
  );

  assert.deepEqual(
    getPdfBookmarkHeadings([
      { heading: "Document", level: 1 },
      { heading: "目录", level: 2 },
      { heading: "Table of Contents", level: 2 },
      { heading: "Section", level: 2 },
      { heading: "Detail", level: 3 },
      { heading: "Too deep", level: 4 },
      { heading: "   ", level: 2 },
    ]),
    [
      { heading: "Document", level: 1 },
      { heading: "Section", level: 2 },
      { heading: "Detail", level: 3 },
    ],
  );

  assert.equal(needsSyntheticPdfRootHeading([{ heading: "Section", level: 2 }]), true);
  assert.equal(needsSyntheticPdfRootHeading([{ heading: "Document", level: 1 }]), false);

  assert.equal(
    getPrintableBookmarkedPdfMarkdown("## Section\n\nBody", "Source Note"),
    "# Source Note\n\n## Section\n\nBody",
  );

  assert.equal(
    getPrintableBookmarkedPdfMarkdown(
      ["---", "cssclasses: export", "---", "", "## Section"].join("\n"),
      "Source Note",
    ),
    ["---", "cssclasses: export", "---", "", "# Source Note", "", "## Section"].join("\n"),
  );

  assert.equal(
    getPrintableBookmarkedPdfMarkdown("# Existing root\n\n## Section", "Source Note"),
    "# Existing root\n\n## Section",
  );

  assert.deepEqual(
    mapPdfBookmarkHeadingsToPages(
      [
        { heading: "Document", level: 1 },
        { heading: "Section", level: 2 },
        { heading: "Missing", level: 2 },
        { heading: "Detail", level: 3 },
      ],
      ["Document intro", "Section body with Detail"],
    ),
    [
      { heading: "Document", level: 1, pageIndex: 0 },
      { heading: "Section", level: 2, pageIndex: 1 },
      { heading: "Detail", level: 3, pageIndex: 1 },
    ],
  );

  assert.deepEqual(
    mapPdfBookmarkHeadingsToPages(
      [
        { heading: "例题", level: 2 },
        { heading: "例题", level: 2 },
        { heading: "例题", level: 2 },
      ],
      ["intro 例题 first", "body 例题 second", "tail 例题 third"],
    ),
    [
      { heading: "例题", level: 2, pageIndex: 0 },
      { heading: "例题", level: 2, pageIndex: 1 },
      { heading: "例题", level: 2, pageIndex: 2 },
    ],
  );

  assert.deepEqual(
    mapPdfBookmarkHeadingsToPages(
      [
        { heading: "A", level: 2 },
        { heading: "ZZZ", level: 2 },
        { heading: "A", level: 2 },
      ],
      ["A first", "A second"],
    ),
    [
      { heading: "A", level: 2, pageIndex: 0 },
      { heading: "A", level: 2, pageIndex: 1 },
    ],
  );

  assert.equal(
    getPrintableBookmarkedPdfMarkdown(
      ["---", "unclosed frontmatter", "", "## Section"].join("\n"),
      "Source Note",
    ),
    ["---", "unclosed frontmatter", "", "## Section"].join("\n"),
  );

  assert.deepEqual(parseMarkdownHeadings(["# Title", "", "### H3", "#### H4"].join("\n")), [
    { heading: "Title", level: 1 },
    { heading: "H3", level: 3 },
    { heading: "H4", level: 4 },
  ]);

  assert.deepEqual(
    parseMarkdownHeadings(["```", "### Fake heading", "```", "## Real heading"].join("\n")),
    [{ heading: "Real heading", level: 2 }],
  );

  const sectionMarkdown = [
    "# Root",
    "intro",
    "## Repeat",
    "first body",
    "### Child",
    "child body",
    "## Repeat",
    "second body",
    "# Next",
    "tail",
  ].join("\n");
  const sectionHeadings = parseMarkdownHeadingRanges(sectionMarkdown);
  assert.deepEqual(
    sectionHeadings.map(({ heading, level, style, startLine, endLine, ordinal }) => ({
      heading,
      level,
      style,
      startLine,
      endLine,
      ordinal,
    })),
    [
      { heading: "Root", level: 1, style: "atx", startLine: 0, endLine: 0, ordinal: 0 },
      { heading: "Repeat", level: 2, style: "atx", startLine: 2, endLine: 2, ordinal: 1 },
      { heading: "Child", level: 3, style: "atx", startLine: 4, endLine: 4, ordinal: 2 },
      { heading: "Repeat", level: 2, style: "atx", startLine: 6, endLine: 6, ordinal: 3 },
      { heading: "Next", level: 1, style: "atx", startLine: 8, endLine: 8, ordinal: 4 },
    ],
  );
  assert.equal(sectionHeadings[1].startOffset, sectionMarkdown.indexOf("## Repeat"));
  assert.equal(
    sectionHeadings[1].endOffset,
    sectionMarkdown.indexOf("## Repeat") + "## Repeat".length,
  );

  assert.equal(
    sliceMarkdownSection(sectionMarkdown, sectionHeadings, sectionHeadings[0]),
    sectionMarkdown.slice(0, sectionMarkdown.indexOf("# Next")),
  );
  assert.equal(
    sliceMarkdownSection(sectionMarkdown, sectionHeadings, sectionHeadings[1]),
    sectionMarkdown.slice(
      sectionMarkdown.indexOf("## Repeat"),
      sectionMarkdown.indexOf("## Repeat", sectionMarkdown.indexOf("## Repeat") + 1),
    ),
  );
  assert.equal(
    sliceMarkdownSection(sectionMarkdown, sectionHeadings, sectionHeadings[3]),
    sectionMarkdown.slice(sectionHeadings[3].startOffset, sectionHeadings[4].startOffset),
  );
  assert.equal(
    sliceMarkdownSection(sectionMarkdown, sectionHeadings, sectionHeadings[4]),
    "# Next\ntail",
  );

  const emptySectionMarkdown = "## Empty\n## Following\nbody";
  const emptySectionHeadings = parseMarkdownHeadingRanges(emptySectionMarkdown);
  assert.equal(
    sliceMarkdownSection(emptySectionMarkdown, emptySectionHeadings, emptySectionHeadings[0]),
    "## Empty\n",
  );

  const atxHeadings = parseMarkdownHeadingRanges([
    "   ### Three spaces ###   ",
    "## Closing ##",
    "######",
    "    # Indented code, not a heading",
    "####### Not a heading",
    "#NoSpace",
  ].join("\n"));
  assert.deepEqual(
    atxHeadings.map(({ heading, level, style }) => ({ heading, level, style })),
    [
      { heading: "Three spaces", level: 3, style: "atx" },
      { heading: "Closing", level: 2, style: "atx" },
      { heading: "", level: 6, style: "atx" },
    ],
  );

  const setextMarkdown = "Setext one\n===========\n\nSetext two\n---\nbody";
  const setextHeadings = parseMarkdownHeadingRanges(setextMarkdown);
  assert.deepEqual(
    setextHeadings.map(({ heading, level, style, startLine, endLine }) => ({
      heading,
      level,
      style,
      startLine,
      endLine,
    })),
    [
      { heading: "Setext one", level: 1, style: "setext", startLine: 0, endLine: 1 },
      { heading: "Setext two", level: 2, style: "setext", startLine: 3, endLine: 4 },
    ],
  );
  assert.equal(setextHeadings[0].startOffset, 0);
  assert.equal(setextHeadings[0].endOffset, "Setext one\n===========".length);

  const multilineSetextMarkdown = "Foo\nbar\n===\ntail";
  assert.deepEqual(parseMarkdownHeadingRanges(multilineSetextMarkdown), [
    {
      heading: "Foo bar",
      level: 1,
      style: "setext",
      startLine: 0,
      endLine: 2,
      startOffset: 0,
      endOffset: "Foo\nbar\n===".length,
      ordinal: 0,
    },
  ]);
  assert.deepEqual(parseMarkdownHeadingRanges("Foo\n\nbar\n==="), [
    {
      heading: "bar",
      level: 1,
      style: "setext",
      startLine: 2,
      endLine: 3,
      startOffset: "Foo\n\n".length,
      endOffset: "Foo\n\nbar\n===".length,
      ordinal: 0,
    },
  ]);
  assert.deepEqual(parseMarkdownHeadingRanges("Foo\n- list item\n===\n> quote\n---"), []);

  for (const thematicMarkdown of ["***\nFoo\n---", "---\nFoo\n===", "* * *\nFoo\n---", "_  _  _\nFoo\n==="]) {
    const fooOffset = thematicMarkdown.indexOf("Foo");
    const underline = thematicMarkdown.endsWith("---") ? "---" : "===";
    assert.deepEqual(parseMarkdownHeadingRanges(thematicMarkdown), [
      {
        heading: "Foo",
        level: underline === "---" ? 2 : 1,
        style: "setext",
        startLine: 1,
        endLine: 2,
        startOffset: fooOffset,
        endOffset: thematicMarkdown.lastIndexOf(underline) + underline.length,
        ordinal: 0,
      },
    ]);
  }

  const htmlSetextCases = [
    "<div>\nFoo\n</div>\n---",
    " <!-- comment\nFoo\n-->\n---",
    "  <!DOCTYPE\nFoo\n>\n---",
    "<?processing\nFoo\n?>\n---",
    "<![CDATA[\nFoo\n]]>\n---",
    "<script>\nFoo\n</script>\n---",
  ];
  for (const htmlMarkdown of htmlSetextCases) {
    assert.deepEqual(parseMarkdownHeadingRanges(htmlMarkdown), [], htmlMarkdown);
  }

  for (const typeSevenMarkdown of [
    "<span>\nFoo\n</span>\n---",
    "</span>\nFoo\n---",
    "<x-card>\nFoo\n</x-card>\n===",
  ]) {
    assert.deepEqual(parseMarkdownHeadingRanges(typeSevenMarkdown), [], typeSevenMarkdown);
  }

  const typeSevenEndsAtBlank = "<x-card>\nignored\n\nFoo\n---";
  assert.deepEqual(
    parseMarkdownHeadings(typeSevenEndsAtBlank),
    [{ heading: "Foo", level: 2 }],
  );

  const inlineHtmlSetext = "Foo <span>bar</span>\nBaz\n---";
  assert.deepEqual(parseMarkdownHeadingRanges(inlineHtmlSetext), [
    {
      heading: "Foo <span>bar</span> Baz",
      level: 2,
      style: "setext",
      startLine: 0,
      endLine: 2,
      startOffset: 0,
      endOffset: inlineHtmlSetext.length,
      ordinal: 0,
    },
  ]);

  const htmlRangeMarkdown = [
    "# Root",
    "root body",
    "<div>",
    "Foo",
    "</div>",
    "---",
    "",
    "# Next",
    "next body",
  ].join("\n");
  const htmlRangeHeadings = parseMarkdownHeadingRanges(htmlRangeMarkdown);
  assert.deepEqual(
    htmlRangeHeadings.map(({ heading, level, startLine, startOffset }) => ({
      heading,
      level,
      startLine,
      startOffset,
    })),
    [
      { heading: "Root", level: 1, startLine: 0, startOffset: 0 },
      {
        heading: "Next",
        level: 1,
        startLine: 7,
        startOffset: htmlRangeMarkdown.indexOf("# Next"),
      },
    ],
  );
  assert.equal(
    sliceMarkdownSection(htmlRangeMarkdown, htmlRangeHeadings, htmlRangeHeadings[0]),
    htmlRangeMarkdown.slice(0, htmlRangeMarkdown.indexOf("# Next")),
  );
  assert.equal(
    sliceMarkdownSection(htmlRangeMarkdown, htmlRangeHeadings, htmlRangeHeadings[1]),
    "# Next\nnext body",
  );

  assert.deepEqual(
    parseMarkdownHeadingRanges("    indented code\n----\n\tTabbed code\n===="),
    [],
  );

  const atxSpacingCases = [];
  for (let level = 1; level <= 6; level += 1) {
    for (let spaces = 0; spaces <= 3; spaces += 1) {
      atxSpacingCases.push({
        markdown: `${" ".repeat(spaces)}${"#".repeat(level)} H${level}-${spaces}`,
        expected: { heading: `H${level}-${spaces}`, level },
      });
    }
    atxSpacingCases.push({
      markdown: `    ${"#".repeat(level)} Rejected H${level}`,
      expected: null,
    });
  }
  for (const { markdown, expected } of atxSpacingCases) {
    const parsed = parseMarkdownHeadingRanges(markdown);
    assert.deepEqual(
      parsed.map(({ heading, level }) => ({ heading, level })),
      expected === null ? [] : [expected],
      markdown,
    );
  }

  const lfOffsetMarkdown = "preamble\n  ## ATX heading ##\nbody\n\nSetext heading\n-----\ntail";
  const lfOffsetHeadings = parseMarkdownHeadingRanges(lfOffsetMarkdown);
  assert.deepEqual(
    lfOffsetHeadings.map(({ heading, startLine, endLine, startOffset, endOffset }) => ({
      heading,
      startLine,
      endLine,
      startOffset,
      endOffset,
    })),
    [
      {
        heading: "ATX heading",
        startLine: 1,
        endLine: 1,
        startOffset: lfOffsetMarkdown.indexOf("  ## ATX heading ##"),
        endOffset: lfOffsetMarkdown.indexOf("  ## ATX heading ##") + "  ## ATX heading ##".length,
      },
      {
        heading: "Setext heading",
        startLine: 4,
        endLine: 5,
        startOffset: lfOffsetMarkdown.indexOf("Setext heading"),
        endOffset: lfOffsetMarkdown.indexOf("-----") + "-----".length,
      },
    ],
  );

  const protectedMarkdown = [
    "---",
    "title: '# YAML heading'",
    "fake",
    "---",
    "# Real root",
    "````js",
    "## Fake in backtick fence",
    "```",
    "### Still fake after short close",
    "~~~~",
    "#### Still fake after other marker",
    "`````",
    "## After backtick fence",
    "~~~",
    "# Fake in tilde fence",
    "~~~~",
    "### After tilde fence",
  ].join("\n");
  assert.deepEqual(parseMarkdownHeadings(protectedMarkdown), [
    { heading: "Real root", level: 1 },
    { heading: "After backtick fence", level: 2 },
    { heading: "After tilde fence", level: 3 },
  ]);

  const strictTildeFenceMarkdown = [
    "~~~~",
    "## Fake in tilde fence",
    "`````",
    "### Still fake after other marker",
    "~~~",
    "#### Still fake after short close",
    "~~~~~",
    "## Real after tilde fence",
  ].join("\n");
  assert.deepEqual(parseMarkdownHeadings(strictTildeFenceMarkdown), [
    { heading: "Real after tilde fence", level: 2 },
  ]);

  for (const newline of ["\n", "\r\n"]) {
    const invalidBacktickInfoFence = [
      "```lang`invalid",
      "# Real heading",
    ].join(newline);
    assert.deepEqual(parseMarkdownHeadings(invalidBacktickInfoFence), [
      { heading: "Real heading", level: 1 },
    ]);
  }

  const tildeInfoWithBacktick = [
    "~~~ lang`allowed",
    "# Fake in tilde fence",
    "~~~",
    "# Real after tilde fence",
  ].join("\n");
  assert.deepEqual(parseMarkdownHeadings(tildeInfoWithBacktick), [
    { heading: "Real after tilde fence", level: 1 },
  ]);

  const crlfMarkdown = "# First\r\nbody\r\n\r\nSecond\r\n------\r\n## Third";
  const crlfHeadings = parseMarkdownHeadingRanges(crlfMarkdown);
  assert.deepEqual(
    crlfHeadings.map(({ heading, startLine, endLine, startOffset, endOffset }) => ({
      heading,
      startLine,
      endLine,
      startOffset,
      endOffset,
    })),
    [
      { heading: "First", startLine: 0, endLine: 0, startOffset: 0, endOffset: 7 },
      {
        heading: "Second",
        startLine: 3,
        endLine: 4,
        startOffset: crlfMarkdown.indexOf("Second"),
        endOffset: crlfMarkdown.indexOf("------") + "------".length,
      },
      {
        heading: "Third",
        startLine: 5,
        endLine: 5,
        startOffset: crlfMarkdown.indexOf("## Third"),
        endOffset: crlfMarkdown.length,
      },
    ],
  );

  assert.equal(
    locateMarkdownSection(sectionHeadings, {
      heading: "Repeat",
      level: 2,
      startOffset: sectionHeadings[3].startOffset,
    }),
    sectionHeadings[3],
  );
  assert.equal(
    locateMarkdownSection(sectionHeadings, { heading: "Repeat", level: 2, ordinal: 1 }),
    sectionHeadings[1],
  );
  assert.equal(
    locateMarkdownSection(sectionHeadings, { heading: "Child", level: 3, startLine: 5 }),
    sectionHeadings[2],
  );
  assert.equal(
    locateMarkdownSection(sectionHeadings, { heading: "Missing", level: 2, startLine: 2 }),
    null,
  );

  const ambiguousHeadings = parseMarkdownHeadingRanges("## Same\na\nb\nc\n## Same");
  assert.equal(
    locateMarkdownSection(ambiguousHeadings, { heading: "Same", level: 2, startLine: 2 }),
    null,
  );

  assert.deepEqual(
    getSectionExportPaths("notes/source.md", { heading: '  Bad<>:"/\\|?*\u0001 title...  ', ordinal: 0 }, false),
    {
      markdownPath: "notes/source--Bad title.section.md",
      pdfPath: "notes/source--Bad title.bookmarked.pdf",
    },
  );
  assert.deepEqual(
    getSectionExportPaths("notes/source.md", { heading: "Repeat", ordinal: 1 }, true),
    {
      markdownPath: "notes/source--Repeat-2.section.md",
      pdfPath: "notes/source--Repeat-2.bookmarked.pdf",
    },
  );
  assert.deepEqual(
    getSectionExportPaths("source.md", { heading: "<>... ", ordinal: 0 }, false),
    {
      markdownPath: "source--\u672a\u547d\u540d\u6807\u9898.section.md",
      pdfPath: "source--\u672a\u547d\u540d\u6807\u9898.bookmarked.pdf",
    },
  );
  const longHeading = `${"\u{1F600}".repeat(79)}\u7ed3\u5c3e`;
  const longPaths = getSectionExportPaths("source.md", { heading: longHeading, ordinal: 0 }, false);
  assert.equal(Array.from(longPaths.markdownPath.slice("source--".length, -".section.md".length)).length, 80);
  assert.equal(longPaths.markdownPath.endsWith("\u{1F600}\u7ed3.section.md"), true);

  const sourcePdf = await PDFDocument.create();
  sourcePdf.addPage();
  sourcePdf.addPage();
  const sourcePdfBytes = await sourcePdf.save({ useObjectStreams: false });
  const bookmarkedPdfBytes = await addPdfBookmarks(sourcePdfBytes, [
    { heading: "Document", level: 1, pageIndex: 0 },
    { heading: "Section", level: 2, pageIndex: 1 },
  ]);
  const bookmarkedPdfText = Buffer.from(bookmarkedPdfBytes).toString("latin1");
  assert.match(bookmarkedPdfText, /\/Outlines/);
  assert.match(bookmarkedPdfText, /Document|0044006F00630075006D0065006E0074/);
  assert.match(bookmarkedPdfText, /Section|00530065006300740069006F006E/);
  assert.equal(hasPdfOutlines(bookmarkedPdfBytes), true);
  assert.equal(hasPdfOutlines(sourcePdfBytes), false);

  const anchorPdf = await PDFDocument.create();
  const anchorPage0 = anchorPdf.addPage();
  const anchorPage1 = anchorPdf.addPage();
  const anchorContext = anchorPdf.context;
  const addAnchorAnnotation = (page, key, top) => {
    const annotation = anchorContext.obj({
      Type: "Annot",
      Subtype: "Link",
      Rect: [50, top - 2, 52, top],
      Border: [0, 0, 0],
      A: { Type: "Action", S: "URI", URI: PDFString.of(`af://${key}`) },
    });
    const annotationRef = anchorContext.register(annotation);
    page.node.set(PDFName.of("Annots"), anchorContext.obj([annotationRef]));
  };
  addAnchorAnnotation(anchorPage0, "omx-0", 700);
  addAnchorAnnotation(anchorPage1, "omx-1", 650);
  const anchorPdfBytes = await anchorPdf.save({ useObjectStreams: false });

  const finalized = await finalizeBookmarkedPdf(anchorPdfBytes, [
    { key: "omx-0", heading: "第一章", level: 1 },
    { key: "omx-1", heading: "第一节", level: 2 },
    { key: "omx-missing", heading: "Ghost", level: 2 },
  ]);
  assert.equal(finalized.matchedCount, 2);
  assert.equal(hasPdfOutlines(finalized.bytes), true);
  const finalizedText = Buffer.from(finalized.bytes).toString("latin1");
  assert.match(finalizedText, /\/XYZ/);
  assert.ok(!finalizedText.includes("af://"), "anchor annotations should be removed");
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
