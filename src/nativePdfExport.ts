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

export function mapPdfBookmarkMarkersToPages(
  markers: PdfBookmarkMarker[],
  pageTexts: string[],
): PdfBookmarkMarkerTarget[] {
  const targets: PdfBookmarkMarkerTarget[] = [];
  let cursorPage = 0;
  for (const marker of markers) {
    let matchedPage = -1;
    for (let pageIndex = cursorPage; pageIndex < pageTexts.length; pageIndex += 1) {
      if (pageTexts[pageIndex].includes(marker.marker)) {
        matchedPage = pageIndex;
        break;
      }
    }
    if (matchedPage < 0) continue;
    targets.push({
      heading: marker.heading,
      level: marker.level,
      pageIndex: matchedPage,
    });
    cursorPage = matchedPage;
  }
  return targets;
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
