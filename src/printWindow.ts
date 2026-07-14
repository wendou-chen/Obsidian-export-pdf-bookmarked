const PRINT_PRELOAD_STYLE = "<style>.outline-markdown-export-print-root{display:block!important}</style>";

export function buildPrintDocumentHtml(
  headHtml: string,
  bodyClass: string,
  wrapperHtml: string,
): string {
  const escapedBodyClass = bodyClass.replace(/[&"'<>]/g, (character) => ({
    "&": "&amp;",
    "\"": "&quot;",
    "'": "&#39;",
    "<": "&lt;",
    ">": "&gt;",
  }[character] ?? character));

  return `<!doctype html><html><head><meta charset="utf-8">${headHtml}${PRINT_PRELOAD_STYLE}</head><body class="${escapedBodyClass}">${wrapperHtml}</body></html>`;
}


function getAppCssResourcePattern(): RegExp {
  return /url\(\s*(["']?)(app:\/\/obsidian\.md\/[^"'()\s<>]+)\1\s*\)/g;
}

export function findAppCssResourceUrls(content: string): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  const pattern = getAppCssResourcePattern();
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    const url = match[2];
    if (!seen.has(url)) {
      seen.add(url);
      urls.push(url);
    }
  }
  return urls;
}

export function replaceAppCssResourceUrls(
  content: string,
  replacements: ReadonlyMap<string, string>,
): string {
  return content.replace(
    getAppCssResourcePattern(),
    (original, quote: string, url: string) => {
      const replacement = replacements.get(url);
      return replacement ? `url(${quote}${replacement}${quote})` : original;
    },
  );
}
