export interface OutlineHeading {
  heading: string;
  level: number;
}

export interface MarkdownHeadingRange extends OutlineHeading {
  style: "atx" | "setext";
  startLine: number;
  endLine: number;
  startOffset: number;
  endOffset: number;
  ordinal: number;
}

export interface MarkdownHeadingSelection extends OutlineHeading {
  startLine?: number;
  startOffset?: number;
  ordinal?: number;
  sameHeadingIndex?: number;
  sameHeadingCount?: number;
}

export interface SectionExportPaths {
  markdownPath: string;
  pdfPath: string;
}

export interface SectionExportFileNames {
  markdownFileName: string;
  pdfFileName: string;
}

export interface PdfBookmarkTarget extends OutlineHeading {
  pageIndex: number;
  top?: number;
}

export function buildOutlineMarkdown(headings: OutlineHeading[], sourceName?: string): string {
  const validHeadings = headings.filter((heading) => heading.heading.trim().length > 0);
  if (validHeadings.length === 0) {
    return "";
  }

  const minLevel = Math.min(...validHeadings.map((heading) => clampHeadingLevel(heading.level)));
  const lines = validHeadings.map((heading) => {
    const level = clampHeadingLevel(heading.level);
    const indent = "  ".repeat(Math.max(0, level - minLevel));
    return `${indent}- ${heading.heading.trim()}`;
  });

  if (!sourceName) {
    return lines.join("\n");
  }

  return [`# ${sourceName} 大纲`, "", ...lines].join("\n");
}

export function getOutlineExportPath(filePath: string): string {
  const normalizedPath = filePath.replace(/\\/g, "/");
  const slashIndex = normalizedPath.lastIndexOf("/");
  const folder = slashIndex >= 0 ? normalizedPath.slice(0, slashIndex + 1) : "";
  const fileName = slashIndex >= 0 ? normalizedPath.slice(slashIndex + 1) : normalizedPath;
  const basename = fileName.endsWith(".md") ? fileName.slice(0, -3) : fileName;
  return `${folder}${basename}.outline.md`;
}

export function getBookmarkedPdfExportPath(filePath: string): string {
  const normalizedPath = filePath.replace(/\\/g, "/");
  const slashIndex = normalizedPath.lastIndexOf("/");
  const folder = slashIndex >= 0 ? normalizedPath.slice(0, slashIndex + 1) : "";
  const fileName = slashIndex >= 0 ? normalizedPath.slice(slashIndex + 1) : normalizedPath;
  const basename = fileName.replace(/\.(md|pdf)$/i, "");
  return `${folder}${basename}.bookmarked.pdf`;
}

export function getPdfBookmarkHeadings(headings: OutlineHeading[]): OutlineHeading[] {
  return headings
    .map((heading) => ({
      heading: heading.heading.trim(),
      level: clampHeadingLevel(heading.level),
    }))
    .filter((heading) => (
      heading.heading.length > 0
      && heading.level <= 3
      && !isPdfTocHeadingTitle(heading.heading)
    ));
}

export function getPrintableSectionPdfMarkdown(section: string, sourceName: string): string {
  const title = sourceName.trim() || "Untitled";
  return `# ${title}\n\n${section.replace(/^(?:\r?\n)+/, "")}`;
}

export function getPrintableBookmarkedPdfMarkdown(markdown: string, sourceName: string): string {
  if (!needsSyntheticPdfRootHeading(parseMarkdownHeadings(markdown))) {
    return markdown;
  }

  const rootHeading = `# ${sourceName.trim() || "Untitled"}`;
  const frontmatterEndIndex = getFrontmatterEndIndex(markdown);
  if (frontmatterEndIndex === null) {
    // A malformed/unclosed frontmatter block would end up below the injected
    // heading and leak into the rendered PDF body, so skip injection then.
    if (/^---\r?\n/.test(markdown)) {
      return markdown;
    }
    return [rootHeading, "", markdown].join("\n");
  }

  const frontmatter = markdown.slice(0, frontmatterEndIndex);
  const body = markdown.slice(frontmatterEndIndex).replace(/^\r?\n/, "");
  return [frontmatter.replace(/\s+$/, ""), "", rootHeading, "", body].join("\n");
}

export function hasPdfOutlines(pdfData: ArrayBuffer | Uint8Array): boolean {
  const bytes = pdfData instanceof Uint8Array ? pdfData : new Uint8Array(pdfData);
  const outlineMarker = "/Outlines";

  for (let index = 0; index <= bytes.length - outlineMarker.length; index += 1) {
    let matched = true;
    for (let markerIndex = 0; markerIndex < outlineMarker.length; markerIndex += 1) {
      if (bytes[index + markerIndex] !== outlineMarker.charCodeAt(markerIndex)) {
        matched = false;
        break;
      }
    }
    if (matched) {
      return true;
    }
  }

  return false;
}

export function needsSyntheticPdfRootHeading(headings: OutlineHeading[]): boolean {
  return !getPdfBookmarkHeadings(headings).some((heading) => heading.level === 1);
}

export function mapPdfBookmarkHeadingsToPages(
  headings: OutlineHeading[],
  pageTexts: string[],
): PdfBookmarkTarget[] {
  const normalizedPages = pageTexts.map((text) => normalizeSearchText(text));
  const targets: PdfBookmarkTarget[] = [];

  // Headings appear in reading order, so matching scans forward from the last
  // hit (page + in-page offset). This keeps repeated heading texts ("例题",
  // "小结", ...) from all collapsing onto their first occurrence page.
  let cursorPage = 0;
  let cursorOffset = 0;

  for (const heading of getPdfBookmarkHeadings(headings)) {
    const normalizedHeading = normalizeSearchText(heading.heading);
    if (!normalizedHeading) {
      continue;
    }

    let pageIndex = cursorPage;
    let searchOffset = cursorOffset;
    let matchedPage = -1;
    let matchedOffset = -1;

    while (pageIndex < normalizedPages.length) {
      const position = normalizedPages[pageIndex].indexOf(normalizedHeading, searchOffset);
      if (position >= 0) {
        matchedPage = pageIndex;
        matchedOffset = position;
        break;
      }
      pageIndex += 1;
      searchOffset = 0;
    }

    if (matchedPage < 0) {
      continue;
    }

    targets.push({
      ...heading,
      pageIndex: matchedPage,
    });
    cursorPage = matchedPage;
    cursorOffset = matchedOffset + normalizedHeading.length;
  }

  return targets;
}

interface MarkdownLine {
  text: string;
  lineNumber: number;
  startOffset: number;
  endOffset: number;
}

interface SetextCandidate {
  firstLine: MarkdownLine;
  paragraphLines: string[];
}

type HtmlBlockEndPattern = RegExp | null;

export function parseMarkdownHeadingRanges(markdown: string): MarkdownHeadingRange[] {
  const headings: MarkdownHeadingRange[] = [];
  const lines = splitMarkdownLines(markdown);
  const frontmatterEndOffset = getFrontmatterEndIndex(markdown);
  let fenceCharacter: "`" | "~" | null = null;
  let fenceLength = 0;
  let htmlBlockEndPattern: HtmlBlockEndPattern | undefined;
  let setextCandidate: SetextCandidate | null = null;

  const addHeading = (heading: Omit<MarkdownHeadingRange, "ordinal">): void => {
    headings.push({ ...heading, ordinal: headings.length });
  };

  for (const line of lines) {
    if (frontmatterEndOffset !== null && line.startOffset < frontmatterEndOffset) {
      setextCandidate = null;
      continue;
    }

    if (htmlBlockEndPattern !== undefined) {
      const endsAtBlankLine = htmlBlockEndPattern === null && line.text.trim().length === 0;
      const hasClosingToken = htmlBlockEndPattern !== null && htmlBlockEndPattern.test(line.text);
      if (endsAtBlankLine || hasClosingToken) {
        htmlBlockEndPattern = undefined;
      }
      setextCandidate = null;
      continue;
    }

    if (fenceCharacter !== null) {
      const closingFence = line.text.match(/^ {0,3}(`+|~+)[ \t]*$/);
      if (
        closingFence
        && closingFence[1][0] === fenceCharacter
        && closingFence[1].length >= fenceLength
      ) {
        fenceCharacter = null;
        fenceLength = 0;
      }
      setextCandidate = null;
      continue;
    }

    const openingFence = line.text.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    const hasInvalidBacktickInfo = openingFence?.[1][0] === "`" && openingFence[2].includes("`");
    if (openingFence && !hasInvalidBacktickInfo) {
      fenceCharacter = openingFence[1][0] as "`" | "~";
      fenceLength = openingFence[1].length;
      setextCandidate = null;
      continue;
    }

    const htmlBlockStart = getHtmlBlockEndPattern(line.text, setextCandidate === null);
    if (htmlBlockStart !== undefined) {
      const closesOnOpeningLine = htmlBlockStart !== null && htmlBlockStart.test(line.text);
      htmlBlockEndPattern = closesOnOpeningLine ? undefined : htmlBlockStart;
      setextCandidate = null;
      continue;
    }

    const setextUnderline = line.text.match(/^ {0,3}(=+|-+)[ \t]*$/);
    if (setextUnderline && setextCandidate !== null) {
      addHeading({
        heading: setextCandidate.paragraphLines.join(" "),
        level: setextUnderline[1][0] === "=" ? 1 : 2,
        style: "setext",
        startLine: setextCandidate.firstLine.lineNumber,
        endLine: line.lineNumber,
        startOffset: setextCandidate.firstLine.startOffset,
        endOffset: line.endOffset,
      });
      setextCandidate = null;
      continue;
    }

    const atxHeading = line.text.match(/^ {0,3}(#{1,6})(?:[ \t]+(.*)|[ \t]*)$/);
    if (atxHeading) {
      const rawHeading = atxHeading[2] ?? "";
      const headingWithoutClosingHashes = rawHeading.replace(/[ \t]+#+[ \t]*$/, "");
      addHeading({
        heading: headingWithoutClosingHashes.trim(),
        level: atxHeading[1].length,
        style: "atx",
        startLine: line.lineNumber,
        endLine: line.lineNumber,
        startOffset: line.startOffset,
        endOffset: line.endOffset,
      });
      setextCandidate = null;
      continue;
    }

    const candidateHeading = line.text.trim();
    const isIndentedCode = /^(?: {4}| {0,3}\t)/.test(line.text);
    const isThematicBreak = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(line.text);
    const isParagraphBoundary = /^ {0,3}(?:>|[-+*][ \t]+|\d{1,9}[.)][ \t]+)/.test(line.text);
    if (
      candidateHeading.length === 0
      || isIndentedCode
      || isThematicBreak
      || isParagraphBoundary
    ) {
      setextCandidate = null;
    } else if (setextCandidate === null) {
      setextCandidate = { firstLine: line, paragraphLines: [candidateHeading] };
    } else {
      setextCandidate.paragraphLines.push(candidateHeading);
    }
  }

  return headings;
}

export function parseMarkdownHeadings(markdown: string): OutlineHeading[] {
  return parseMarkdownHeadingRanges(markdown).map(({ heading, level }) => ({ heading, level }));
}

export function locateMarkdownSection(
  headings: MarkdownHeadingRange[],
  selection: MarkdownHeadingSelection,
): MarkdownHeadingRange | null {
  const identityMatches = headings.filter((heading) =>
    heading.level === selection.level && heading.heading === selection.heading);
  const hasLiveOccurrence = Number.isInteger(selection.sameHeadingIndex) &&
    Number.isInteger(selection.sameHeadingCount);

  if (hasLiveOccurrence) {
    const index = selection.sameHeadingIndex as number;
    const count = selection.sameHeadingCount as number;
    if (count < 1 || index < 0 || index >= count || identityMatches.length !== count) return null;
    const occurrence = identityMatches[index];
    if (!occurrence) return null;
    if (Number.isFinite(selection.startOffset)) {
      const exactMatches = identityMatches.filter((heading) => heading.startOffset === selection.startOffset);
      if (exactMatches.length > 1) return null;
      if (exactMatches.length === 1 && exactMatches[0] !== occurrence) return null;
    }
    return occurrence;
  }

  if (Number.isFinite(selection.startOffset)) {
    const exactMatches = identityMatches.filter((heading) => heading.startOffset === selection.startOffset);
    if (exactMatches.length === 1) {
      if (Number.isFinite(selection.ordinal) && exactMatches[0].ordinal !== selection.ordinal) return null;
      return exactMatches[0];
    }
    if (exactMatches.length > 1) return null;
  }

  if (identityMatches.length !== 1 || !Number.isFinite(selection.startLine)) return null;
  return Math.abs(identityMatches[0].startLine - (selection.startLine as number)) <= 2
    ? identityMatches[0]
    : null;
}

export function sliceMarkdownSection(
  markdown: string,
  headings: MarkdownHeadingRange[],
  selected: MarkdownHeadingRange,
): string {
  const nextBoundary = headings.find((heading) => (
    heading.startOffset > selected.startOffset && heading.level <= selected.level
  ));
  return markdown.slice(selected.startOffset, nextBoundary?.startOffset ?? markdown.length);
}

export function needsSectionOrdinalSuffix(
  headings: MarkdownHeadingRange[],
  selected: Pick<MarkdownHeadingRange, "heading"> & Partial<Pick<MarkdownHeadingRange, "startOffset" | "ordinal">>,
): boolean {
  const keys = headings.map((heading) => sectionPathComparisonKey(heading.heading));
  const append = new Set<number>();
  for (let index = 0; index < keys.length; index += 1) {
    if (keys.filter((key) => key === keys[index]).length > 1) append.add(index);
  }

  // Appending an ordinal can itself collide with an unsuffixed original stem (A/A/A-1).
  while (true) {
    const stems = keys.map((key, index) => append.has(index) ? `${key}-${headings[index].ordinal + 1}` : key);
    const newlyColliding = new Set<number>();
    for (let index = 0; index < stems.length; index += 1) {
      if (stems.filter((stem) => stem === stems[index]).length > 1) newlyColliding.add(index);
    }
    const previousSize = append.size;
    for (const index of newlyColliding) append.add(index);
    if (append.size === previousSize) break;
  }

  const selectedIndex = headings.findIndex((heading) => heading === selected || (
    Number.isFinite(selected.startOffset) && heading.startOffset === selected.startOffset &&
    heading.heading === selected.heading
  ));
  return selectedIndex >= 0 ? append.has(selectedIndex) : false;
}

function sectionPathComparisonKey(heading: string): string {
  return sanitizeHeadingPathComponent(heading).toLocaleLowerCase("en-US");
}

export function getSectionExportFileNames(
  filePath: string,
  selection: Pick<MarkdownHeadingRange, "heading" | "ordinal">,
  appendOrdinal: boolean,
): SectionExportFileNames {
  const normalizedPath = filePath.replace(/\\/g, "/");
  const slashIndex = normalizedPath.lastIndexOf("/");
  const fileName = slashIndex >= 0 ? normalizedPath.slice(slashIndex + 1) : normalizedPath;
  const basename = fileName.replace(/\.md$/i, "");
  const safeHeading = sanitizeHeadingPathComponent(selection.heading);
  const ordinalSuffix = appendOrdinal ? `-${selection.ordinal + 1}` : "";
  const stem = `${basename}--${safeHeading}${ordinalSuffix}`;

  return {
    markdownFileName: `${stem}.section.md`,
    pdfFileName: `${stem}.bookmarked.pdf`,
  };
}

export function getSectionExportPaths(
  filePath: string,
  selection: Pick<MarkdownHeadingRange, "heading" | "ordinal">,
  appendOrdinal: boolean,
): SectionExportPaths {
  const normalizedPath = filePath.replace(/\\/g, "/");
  const slashIndex = normalizedPath.lastIndexOf("/");
  const folder = slashIndex >= 0 ? normalizedPath.slice(0, slashIndex + 1) : "";
  const fileNames = getSectionExportFileNames(filePath, selection, appendOrdinal);

  return {
    markdownPath: `${folder}${fileNames.markdownFileName}`,
    pdfPath: `${folder}${fileNames.pdfFileName}`,
  };
}

function getHtmlBlockEndPattern(
  line: string,
  allowTypeSeven: boolean,
): HtmlBlockEndPattern | undefined {
  const typeOne = line.match(/^ {0,3}<(script|pre|style|textarea)(?:[ \t]|>|$)/i);
  if (typeOne) {
    return new RegExp(`</${typeOne[1]}\\s*>`, "i");
  }
  if (/^ {0,3}<!--/.test(line)) {
    return /-->/;
  }
  if (/^ {0,3}<\?/.test(line)) {
    return /\?>/;
  }
  if (/^ {0,3}<![A-Z]/.test(line)) {
    return />/;
  }
  if (/^ {0,3}<!\[CDATA\[/.test(line)) {
    return /\]\]>/;
  }
  if (/^ {0,3}<\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:[ \t]|\/?>|$)/i.test(line)) {
    return null;
  }
  const completeTypeSevenTag = /^ {0,3}(?:<\/[A-Za-z][A-Za-z0-9-]*[ \t]*>|<[A-Za-z][A-Za-z0-9-]*(?:[ \t]+[A-Za-z_:][A-Za-z0-9_.:-]*(?:[ \t]*=[ \t]*(?:"[^"]*"|'[^']*'|[^ \t\r\n"'=<>`]+))?)*[ \t]*\/?>)[ \t]*$/;
  if (allowTypeSeven && completeTypeSevenTag.test(line)) {
    return null;
  }
  return undefined;
}

function splitMarkdownLines(markdown: string): MarkdownLine[] {
  const lines: MarkdownLine[] = [];
  let startOffset = 0;
  let lineNumber = 0;

  while (startOffset < markdown.length) {
    const newlineOffset = markdown.indexOf("\n", startOffset);
    const rawEndOffset = newlineOffset >= 0 ? newlineOffset : markdown.length;
    const endOffset = rawEndOffset > startOffset && markdown[rawEndOffset - 1] === "\r"
      ? rawEndOffset - 1
      : rawEndOffset;
    lines.push({
      text: markdown.slice(startOffset, endOffset),
      lineNumber,
      startOffset,
      endOffset,
    });
    if (newlineOffset < 0) {
      break;
    }
    startOffset = newlineOffset + 1;
    lineNumber += 1;
  }

  return lines;
}

function sanitizeHeadingPathComponent(heading: string): string {
  const cleaned = heading
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "");
  const truncated = Array.from(cleaned).slice(0, 80).join("").replace(/[. ]+$/, "");
  return truncated || "\u672a\u547d\u540d\u6807\u9898";
}

function clampHeadingLevel(level: number): number {
  if (!Number.isFinite(level)) {
    return 1;
  }
  return Math.min(6, Math.max(1, Math.floor(level)));
}

export function isPdfTocHeadingTitle(heading: string): boolean {
  const normalized = heading.trim().toLowerCase();
  return normalized === "目录" || normalized === "table of contents";
}

function getFrontmatterEndIndex(markdown: string): number | null {
  if (!markdown.startsWith("---\n") && !markdown.startsWith("---\r\n")) {
    return null;
  }

  const match = markdown.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/);
  return match ? match[0].length : null;
}

function normalizeSearchText(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, "");
}
