import { Menu, Platform, Plugin, TFile, WorkspaceLeaf } from "obsidian";
import type { HeadingCache } from "obsidian";

import type { MarkdownHeadingSelection } from "./outlineMarkdown";
import { resolveOutlineHeadingIdentityWithOptionalMetadata } from "./outlineContextResolver";

export interface OutlineHeadingSelection extends MarkdownHeadingSelection {
  file: TFile;
  heading: string;
  level: number;
  startLine: number;
  startOffset: number;
  ordinal: number;
  sameHeadingIndex: number;
  sameHeadingCount: number;
}

export interface OutlineSectionActions {
  copy(selection: OutlineHeadingSelection): Promise<void>;
  exportMarkdown(selection: OutlineHeadingSelection): Promise<void>;
  exportPdf(selection: OutlineHeadingSelection): Promise<void>;
}

interface CachedHeadingDomEntry {
  selfEl?: HTMLElement;
  coverEl?: HTMLElement;
  heading?: HeadingCache;
}

interface OutlineViewPrivate {
  contentEl?: HTMLElement;
  file?: TFile;
  cachedHeadingDom?: CachedHeadingDomEntry[];
}

function resolveOutlineSelection(
  plugin: Plugin,
  leaf: WorkspaceLeaf,
  itemEl: HTMLElement,
): OutlineHeadingSelection | null {
  const view = leaf.view as typeof leaf.view & OutlineViewPrivate;
  const file = view.file;
  const entries = Array.isArray(view.cachedHeadingDom) ? view.cachedHeadingDom : [];
  if (!(file instanceof TFile)) return null;
  const metadataHeadings = plugin.app.metadataCache.getFileCache(file)?.headings ?? [];
  const displayHeading = itemEl.textContent?.trim();
  const resolved = resolveOutlineHeadingIdentityWithOptionalMetadata(
    entries, metadataHeadings, itemEl,
    displayHeading ? { heading: displayHeading } : undefined,
  );
  return resolved ? { file, ...resolved } : null;
}

export function registerOutlineSectionMenus(
  plugin: Plugin,
  actions: OutlineSectionActions,
): void {
  const bound = new WeakSet<HTMLElement>();
  let disposed = false;
  let warnedPrivateShape = false;
  plugin.register(() => { disposed = true; });

  const scan = (): void => {
    if (disposed) return;
    for (const leaf of plugin.app.workspace.getLeavesOfType("outline")) {
      const view = leaf.view as typeof leaf.view & OutlineViewPrivate;
      const contentEl = view.contentEl;
      if ((!view.file || !Array.isArray(view.cachedHeadingDom)) && !warnedPrivateShape) {
        warnedPrivateShape = true;
        console.warn("Outline Markdown Export: unsupported Outline private view shape");
      }
      if (!contentEl || bound.has(contentEl)) continue;
      bound.add(contentEl);
      plugin.registerDomEvent(contentEl, "contextmenu", (event: MouseEvent) => {
        if (disposed) return;
        const target = event.target;
        if (!(target instanceof Element)) return;
        const itemEl = target.closest<HTMLElement>(".tree-item-self");
        if (!itemEl || !contentEl.contains(itemEl)) return;
        const selection = resolveOutlineSelection(plugin, leaf, itemEl);
        if (!selection) return;

        event.preventDefault();
        const menu = new Menu();
        menu.addItem((item) => item.setTitle("复制此节 Markdown").setIcon("copy")
          .onClick(() => void actions.copy(selection)));
        menu.addItem((item) => item.setTitle("导出此节 Markdown").setIcon("file-output")
          .onClick(() => void actions.exportMarkdown(selection)));
        if (Platform.isDesktopApp) {
          menu.addItem((item) => item.setTitle("导出此节带书签 PDF").setIcon("file-output")
            .onClick(() => void actions.exportPdf(selection)));
        }
        menu.showAtMouseEvent(event);
      });
    }
  };

  plugin.app.workspace.onLayoutReady(() => {
    if (!disposed) scan();
  });
  plugin.registerEvent(plugin.app.workspace.on("layout-change", scan));
}
