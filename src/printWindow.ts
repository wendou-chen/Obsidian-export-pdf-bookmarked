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

  return `<!doctype html><html><head><meta charset="utf-8">${headHtml}</head><body class="${escapedBodyClass}">${wrapperHtml}</body></html>`;
}
