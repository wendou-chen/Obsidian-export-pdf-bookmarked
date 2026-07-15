export const NATIVE_TEMP_FILE_PREFIX = "outline-markdown-export-native-";

export interface PdfIncludeNameSnapshot {
  hadValue: boolean;
  value: unknown;
}

export interface PdfBookmarkMarkerHeading {
  heading: string;
  level: number;
  startOffset: number;
  endOffset: number;
  style: "atx" | "setext";
}

export interface PdfBookmarkMarker {
  marker: string;
  heading: string;
  level: number;
}

export interface PdfBookmarkMarkerTarget {
  heading: string;
  level: number;
  pageIndex: number;
}

function sanitizeToken(token: string): string {
  return token.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "temp";
}

export function getNativeTempMarkdownPath(sourcePath: string, token: string): string {
  const normalizedPath = sourcePath.replace(/\\/g, "/");
  const slashIndex = normalizedPath.lastIndexOf("/");
  const folder = slashIndex >= 0 ? normalizedPath.slice(0, slashIndex + 1) : "";
  return `${folder}${NATIVE_TEMP_FILE_PREFIX}${sanitizeToken(token)}.md`;
}

export function getNativeTempPdfFileName(token: string): string {
  return `${NATIVE_TEMP_FILE_PREFIX}${sanitizeToken(token)}.pdf`;
}

export function snapshotPdfIncludeName(settings: unknown): PdfIncludeNameSnapshot {
  if (typeof settings !== "object" || settings === null) {
    return { hadValue: false, value: undefined };
  }
  const record = settings as Record<string, unknown>;
  return {
    hadValue: Object.prototype.hasOwnProperty.call(record, "includeName"),
    value: record.includeName,
  };
}

export function restorePdfIncludeName(
  settings: unknown,
  snapshot: PdfIncludeNameSnapshot,
): Record<string, unknown> {
  const restored = typeof settings === "object" && settings !== null
    ? { ...(settings as Record<string, unknown>) }
    : {};
  if (snapshot.hadValue) {
    restored.includeName = snapshot.value;
  } else {
    delete restored.includeName;
  }
  return restored;
}

export function injectPdfBookmarkMarkers(
  markdown: string,
  headings: PdfBookmarkMarkerHeading[],
  token: string,
): { markdown: string; markers: PdfBookmarkMarker[] } {
  const markerToken = sanitizeToken(token).replace(/-/g, "");
  const markers = headings.map((heading, index) => ({
    marker: `OMXBM${markerToken}X${index}END`,
    heading: heading.heading.trim(),
    level: heading.level,
  }));
  const insertions = headings.map((heading, index) => {
    const firstLineEnd = markdown.indexOf("\n", heading.startOffset);
    let offset = firstLineEnd >= 0 && firstLineEnd < heading.endOffset
      ? firstLineEnd
      : heading.endOffset;
    if (offset > heading.startOffset && markdown[offset - 1] === "\r") {
      offset -= 1;
    }
    if (heading.style === "atx") {
      const line = markdown.slice(heading.startOffset, offset);
      const closingHashes = line.match(/[ \t]+#+[ \t]*$/);
      if (closingHashes?.index !== undefined) {
        offset = heading.startOffset + closingHashes.index;
      }
    }
    const marker = markers[index].marker;
    return {
      offset,
      html: ` <span style="font-size:1px;color:#fff;letter-spacing:0">${marker}</span>`,
    };
  }).sort((left, right) => right.offset - left.offset);

  let output = markdown;
  for (const insertion of insertions) {
    output = `${output.slice(0, insertion.offset)}${insertion.html}${output.slice(insertion.offset)}`;
  }
  return { markdown: output, markers };
}

/**
 * PDF.js may insert whitespace between characters of the invisible marker.
 * Match only on the unique OMXBM token after stripping all whitespace.
 */
export function normalizePdfMarkerSearchText(text: string): string {
  return text.replace(/\s+/g, "");
}

export function mapPdfBookmarkMarkersToPages(
  markers: PdfBookmarkMarker[],
  pageTexts: string[],
): PdfBookmarkMarkerTarget[] {
  const normalizedPages = pageTexts.map((text) => normalizePdfMarkerSearchText(text));
  const targets: PdfBookmarkMarkerTarget[] = [];
  let cursorPage = 0;
  for (const marker of markers) {
    const normalizedMarker = normalizePdfMarkerSearchText(marker.marker);
    if (!normalizedMarker) {
      continue;
    }
    let matchedPage = -1;
    for (let pageIndex = cursorPage; pageIndex < normalizedPages.length; pageIndex += 1) {
      if (normalizedPages[pageIndex].includes(normalizedMarker)) {
        matchedPage = pageIndex;
        break;
      }
    }
    if (matchedPage < 0) {
      // Keep reading order: a missing marker must not let later markers
      // silently attach to an earlier page's leftover text.
      break;
    }
    targets.push({
      heading: marker.heading,
      level: marker.level,
      pageIndex: matchedPage,
    });
    cursorPage = matchedPage;
  }
  return targets;
}

/** Pure contract helper: one-shot bookmarked export only succeeds on full match. */
export function isCompleteBookmarkMatch(matchedCount: number, expectedCount: number): boolean {
  return expectedCount > 0 && matchedCount === expectedCount;
}

export function formatBookmarkedExportSuccessNotice(
  kind: "note" | "section",
  matchedCount: number,
  expectedCount: number,
  outputPath: string,
): string {
  const label = kind === "section" ? "此节带书签 PDF" : "带书签 PDF";
  return (
    `已导出${label}（${matchedCount}/${expectedCount}）：${outputPath}`
    + "。请用 Edge/Sumatra/Adobe 打开左侧书签；Obsidian 内置 PDF 可能不显示大纲"
  );
}

/** Byte-level proof that pdf-lib actually attached an outline dictionary. */
export function assertPdfBytesHaveOutlines(pdfBytes: Uint8Array, matchedCount: number): void {
  if (matchedCount <= 0) {
    throw new Error("书签数量为 0，未写入最终文件");
  }
  // Avoid importing outlineMarkdown here (native helpers stay dependency-light).
  const marker = "/Outlines";
  let found = false;
  for (let index = 0; index <= pdfBytes.length - marker.length; index += 1) {
    let matched = true;
    for (let markerIndex = 0; markerIndex < marker.length; markerIndex += 1) {
      if (pdfBytes[index + markerIndex] !== marker.charCodeAt(markerIndex)) {
        matched = false;
        break;
      }
    }
    if (matched) {
      found = true;
      break;
    }
  }
  if (!found) {
    throw new Error("PDF 字节中未检测到 /Outlines，书签写入失败，未写入最终文件");
  }
  if (!pdfBytesIncludes(pdfBytes, "/UseOutlines")) {
    throw new Error("PDF 字节中未检测到 /UseOutlines，书签目录模式写入失败，未写入最终文件");
  }
}

function pdfBytesIncludes(pdfBytes: Uint8Array, needle: string): boolean {
  for (let index = 0; index <= pdfBytes.length - needle.length; index += 1) {
    let matched = true;
    for (let needleIndex = 0; needleIndex < needle.length; needleIndex += 1) {
      if (pdfBytes[index + needleIndex] !== needle.charCodeAt(needleIndex)) {
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

export function shouldRetryNativeTempPdfCleanup(error: unknown): boolean {
  const code = typeof error === "object" && error !== null && "code" in error
    ? (error as { code?: unknown }).code
    : undefined;
  return code === "EBUSY" || code === "EPERM" || code === "EACCES";
}

export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timeoutId);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeoutId);
        reject(error);
      },
    );
  });
}
