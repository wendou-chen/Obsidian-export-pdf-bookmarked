import {
  App,
  FuzzySuggestModal,
  MarkdownView,
  Notice,
  Platform,
  Plugin,
  TAbstractFile,
  TFile,
  WorkspaceLeaf,
  loadPdfJs,
  normalizePath,
} from "obsidian";

import {
  buildOutlineMarkdown,
  getBookmarkedPdfExportPath,
  getOutlineExportPath,
  getPdfBookmarkHeadings,
  getPrintableBookmarkedPdfMarkdown,
  getPrintableSectionPdfMarkdown,
  getSectionExportPaths,
  locateMarkdownSection,
  parseMarkdownHeadingRanges,
  sliceMarkdownSection,
  mapPdfBookmarkHeadingsToPages,
  needsSyntheticPdfRootHeading,
  needsSectionOrdinalSuffix,
  parseMarkdownHeadings,
  type MarkdownHeadingRange,
  type OutlineHeading,
  type PdfBookmarkTarget,
} from "./outlineMarkdown";
import {
  addPdfBookmarks,
} from "./pdfOutline";
import {
  getNativeTempMarkdownPath,
  getNativeTempPdfFileName,
  injectPdfBookmarkMarkers,
  mapPdfBookmarkMarkersToPages,
  restorePdfIncludeName,
  shouldRetryNativeTempPdfCleanup,
  snapshotPdfIncludeName,
  type PdfBookmarkMarker,
  withTimeout,
} from "./nativePdfExport";
import { registerOutlineSectionMenus, type OutlineHeadingSelection } from "./outlineContextMenu";
import { SerialTaskQueue } from "./serialTaskQueue";

type CurrentFileAction = "copy" | "export" | "bookmarked-pdf" | "pdf";

interface SaveDialogResult {
  canceled: boolean;
  filePath?: string;
}

interface ElectronDialogLike {
  showSaveDialog(...args: unknown[]): Promise<SaveDialogResult>;
}

interface ElectronRemoteLike {
  dialog?: ElectronDialogLike;
}

type WindowWithRequire = Window & {
  require?: (moduleName: string) => unknown;
};

interface NativePdfMarkdownView extends MarkdownView {
  printToPdf?: () => void;
}

interface NodeFileSystemLike {
  existsSync(path: string): boolean;
  readFileSync(path: string): Uint8Array;
  promises: {
    unlink(path: string): Promise<void>;
  };
}

interface NodeTimersLike {
  setTimeout(callback: () => void, milliseconds: number): unknown;
  clearTimeout(timeoutId: unknown): void;
}

interface VaultConfigLike {
  getConfig(key: string): unknown;
  setConfig(key: string, value: unknown): void;
}

const NATIVE_EXPORT_MODAL_TIMEOUT_MS = 5000;
const NATIVE_EXPORT_FILE_TIMEOUT_MS = 120000;
const NATIVE_EXPORT_WATCH_INTERVAL_MS = 250;

export default class OutlineMarkdownExportPlugin extends Plugin {
  private readonly pdfExportQueue = new SerialTaskQueue();
  private unloaded = false;
  private activeNativeExportCleanup: (() => void) | null = null;

  async onload(): Promise<void> {
    this.unloaded = false;
    this.activeNativeExportCleanup = null;
    this.addCommand({
      id: "copy-current-outline-markdown",
      name: "复制当前文件大纲 Markdown",
      checkCallback: (checking) => this.handleCurrentFileCommand(checking, "copy"),
    });

    this.addCommand({
      id: "export-current-outline-markdown",
      name: "导出当前文件大纲 Markdown",
      checkCallback: (checking) => this.handleCurrentFileCommand(checking, "export"),
    });

    if (Platform.isDesktopApp) {
      this.addCommand({
        id: "export-current-note-bookmarked-pdf",
        name: "导出带书签 PDF",
        checkCallback: (checking) => this.handleCurrentFileCommand(checking, "bookmarked-pdf"),
      });

      this.addCommand({
        id: "add-bookmarks-to-native-pdf",
        name: "给已有 PDF 注入书签",
        checkCallback: (checking) => this.handleCurrentFileCommand(checking, "pdf"),
      });
    }

    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, _editor, info) => {
        const file = info.file;
        if (!this.isMarkdownFile(file)) {
          return;
        }

        menu.addItem((item) =>
          item
            .setTitle("复制大纲 Markdown")
            .setIcon("copy")
            .setSection("outline-markdown-export")
            .onClick(() => {
              void this.copyOutlineForFile(file);
            }),
        );

        menu.addItem((item) =>
          item
            .setTitle("导出大纲 Markdown")
            .setIcon("file-output")
            .setSection("outline-markdown-export")
            .onClick(() => {
              void this.exportOutlineForFile(file);
            }),
        );

        if (Platform.isDesktopApp) {
          menu.addItem((item) =>
            item
              .setTitle("导出带书签 PDF")
              .setIcon("file-output")
              .setSection("outline-markdown-export")
              .onClick(() => {
                void this.exportBookmarkedPdfForFile(file);
              }),
          );
        }
      }),
    );

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (!this.isMarkdownFile(file)) {
          return;
        }

        menu.addItem((item) =>
          item
            .setTitle("复制大纲 Markdown")
            .setIcon("copy")
            .setSection("outline-markdown-export")
            .onClick(() => {
              void this.copyOutlineForFile(file);
            }),
        );

        menu.addItem((item) =>
          item
            .setTitle("导出大纲 Markdown")
            .setIcon("file-output")
            .setSection("outline-markdown-export")
            .onClick(() => {
              void this.exportOutlineForFile(file);
            }),
        );

        if (Platform.isDesktopApp) {
          menu.addItem((item) =>
            item
              .setTitle("导出带书签 PDF")
              .setIcon("file-output")
              .setSection("outline-markdown-export")
              .onClick(() => {
                void this.exportBookmarkedPdfForFile(file);
              }),
          );
        }
      }),
    );

    registerOutlineSectionMenus(this, {
      copy: (selection) => this.copyOutlineSection(selection),
      exportMarkdown: (selection) => this.exportOutlineSectionMarkdown(selection),
      exportPdf: (selection) => this.exportOutlineSectionPdf(selection),
    });
  }

  onunload(): void {
    this.unloaded = true;
    this.activeNativeExportCleanup?.();
    this.activeNativeExportCleanup = null;
  }

  private async resolveSelectedSection(selection: OutlineHeadingSelection): Promise<{
    section: string;
    selected: MarkdownHeadingRange;
    appendOrdinal: boolean;
  } | null> {
    const markdown = await this.getMarkdownContent(selection.file);
    const headings = parseMarkdownHeadingRanges(markdown);
    const selected = locateMarkdownSection(headings, selection);
    if (!selected) {
      new Notice("标题已变化或无法精确定位，请重新右击该大纲条目");
      return null;
    }
    return {
      section: sliceMarkdownSection(markdown, headings, selected),
      selected,
      appendOrdinal: needsSectionOrdinalSuffix(headings, selected),
    };
  }

  private async copyOutlineSection(selection: OutlineHeadingSelection): Promise<void> {
    try {
      const resolved = await this.resolveSelectedSection(selection);
      if (!resolved) return;
      await navigator.clipboard.writeText(resolved.section);
      new Notice(`已复制此节 Markdown：${resolved.selected.heading}`);
    } catch (error) {
      console.error("Failed to copy outline section", error);
      new Notice("复制此节 Markdown 失败");
    }
  }

  private async exportOutlineSectionMarkdown(selection: OutlineHeadingSelection): Promise<void> {
    try {
      const resolved = await this.resolveSelectedSection(selection);
      if (!resolved) return;
      const path = normalizePath(getSectionExportPaths(
        selection.file.path, resolved.selected, resolved.appendOrdinal,
      ).markdownPath);
      const existing = this.app.vault.getAbstractFileByPath(path);
      const output = `${resolved.section.replace(/(?:\r?\n)*$/, "")}\n`;
      if (existing instanceof TFile) await this.app.vault.modify(existing, output);
      else if (existing) throw new Error(`目标路径不是文件：${path}`);
      else await this.app.vault.create(path, output);
      new Notice(`已导出此节 Markdown：${path}`);
    } catch (error) {
      console.error("Failed to export outline section markdown", error);
      new Notice(`导出此节 Markdown 失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async exportOutlineSectionPdf(selection: OutlineHeadingSelection): Promise<void> {
    if (!Platform.isDesktopApp) {
      new Notice("此节 PDF 导出仅支持 Obsidian 桌面端");
      return;
    }
    try {
      const resolved = await this.resolveSelectedSection(selection);
      if (!resolved) return;
      const printable = getPrintableSectionPdfMarkdown(resolved.section, selection.file.basename);
      const prepared = this.prepareBookmarkedNativeMarkdown(printable);
      const path = normalizePath(getSectionExportPaths(
        selection.file.path, resolved.selected, resolved.appendOrdinal,
      ).pdfPath);
      const bookmarkResult = await this.exportBookmarkedNativePdf(
        selection.file,
        prepared.markdown,
        printable,
        prepared.markers,
        path,
      );
      if (bookmarkResult.matchedCount > 0) {
        new Notice(`已导出此节带书签 PDF（${bookmarkResult.matchedCount} 个书签）：${path}`);
      } else {
        throw new Error("未生成任何 PDF 书签");
      }
    } catch (error) {
      console.error("Failed to export outline section PDF", error);
      new Notice(`导出此节带书签 PDF 失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private handleCurrentFileCommand(checking: boolean, action: CurrentFileAction): boolean {
    const file = this.getCurrentMarkdownFile();
    if (!file) {
      return false;
    }

    if (!checking) {
      if (action === "copy") {
        void this.copyOutlineForFile(file);
      } else if (action === "export") {
        void this.exportOutlineForFile(file);
      } else if (action === "bookmarked-pdf") {
        void this.exportBookmarkedPdfForFile(file);
      } else {
        void this.addBookmarksToNativePdfForFile(file);
      }
    }

    return true;
  }

  private getCurrentMarkdownFile(): TFile | null {
    const activeMarkdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
    const activeFile = activeMarkdownView?.file ?? this.app.workspace.getActiveFile();
    return this.isMarkdownFile(activeFile) ? activeFile : null;
  }

  private isMarkdownFile(file: TAbstractFile | null): file is TFile {
    return file instanceof TFile && file.extension.toLowerCase() === "md";
  }

  private isNativePdfCandidate(file: TFile): boolean {
    return file.extension.toLowerCase() === "pdf" && !file.basename.endsWith(".bookmarked");
  }

  private getOutlineMarkdown(file: TFile): string {
    const headings = this.getLiveHeadings(file) ?? this.getCachedHeadings(file);
    return buildOutlineMarkdown(headings, file.basename);
  }

  private getLiveHeadings(file: TFile): OutlineHeading[] | null {
    const activeMarkdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeMarkdownView?.file || activeMarkdownView.file.path !== file.path) {
      return null;
    }

    return parseMarkdownHeadings(activeMarkdownView.getViewData());
  }

  private getCachedHeadings(file: TFile): OutlineHeading[] {
    const cache = this.app.metadataCache.getFileCache(file);
    return (cache?.headings ?? []).map((heading) => ({
      heading: heading.heading,
      level: heading.level,
    }));
  }

  private async copyOutlineForFile(file: TFile): Promise<void> {
    const markdown = this.getOutlineMarkdown(file);
    if (!markdown) {
      new Notice("当前 Markdown 文件没有可复制的大纲");
      return;
    }

    try {
      await navigator.clipboard.writeText(markdown);
      new Notice(`已复制大纲 Markdown：${file.basename}`);
    } catch (error) {
      console.error("Failed to copy outline markdown", error);
      new Notice("复制大纲 Markdown 失败");
    }
  }

  private async exportOutlineForFile(file: TFile): Promise<void> {
    const markdown = this.getOutlineMarkdown(file);
    if (!markdown) {
      new Notice("当前 Markdown 文件没有可导出的大纲");
      return;
    }

    const exportPath = normalizePath(getOutlineExportPath(file.path));
    const existing = this.app.vault.getAbstractFileByPath(exportPath);

    try {
      if (existing instanceof TFile) {
        await this.app.vault.modify(existing, `${markdown}\n`);
      } else if (existing) {
        new Notice(`导出失败：目标路径不是文件 ${exportPath}`);
        return;
      } else {
        await this.app.vault.create(exportPath, `${markdown}\n`);
      }

      new Notice(`已导出大纲 Markdown：${exportPath}`);
    } catch (error) {
      console.error("Failed to export outline markdown", error);
      new Notice("导出大纲 Markdown 失败");
    }
  }

  private async exportBookmarkedPdfForFile(file: TFile): Promise<void> {
    if (!Platform.isDesktopApp) {
      new Notice("带书签 PDF 导出仅支持 Obsidian 桌面端");
      return;
    }

    try {
      const markdown = await this.getMarkdownContent(file);
      const printableMarkdown = getPrintableBookmarkedPdfMarkdown(markdown, file.basename);
      const prepared = this.prepareBookmarkedNativeMarkdown(printableMarkdown);
      const outputPath = normalizePath(getBookmarkedPdfExportPath(file.path));
      const bookmarkResult = await this.exportBookmarkedNativePdf(
        file,
        prepared.markdown,
        printableMarkdown,
        prepared.markers,
        outputPath,
      );

      if (bookmarkResult.matchedCount > 0) {
        new Notice(`已导出带书签 PDF（${bookmarkResult.matchedCount} 个书签）：${outputPath}`);
      } else {
        throw new Error("未生成任何 PDF 书签");
      }
    } catch (error) {
      console.error("Failed to export bookmarked PDF", error);
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`导出带书签 PDF 失败：${message}`);
    }
  }

  private exportBookmarkedNativePdf(
    file: TFile,
    printableMarkdown: string,
    bookmarkMarkdown: string,
    markers: PdfBookmarkMarker[],
    outputPath: string,
  ): Promise<{ matchedCount: number }> {
    return this.pdfExportQueue.run(async () => {
      this.assertPluginLoaded();
      const nativePdfBytes = await this.exportMarkdownWithObsidianNativePdfSerial(file, printableMarkdown);
      return await this.writeBookmarkedNativePdf(outputPath, nativePdfBytes, bookmarkMarkdown, markers);
    });
  }

  private async exportMarkdownWithObsidianNativePdfSerial(
    sourceFile: TFile,
    markdown: string,
  ): Promise<Uint8Array> {
    const requireFn = (window as WindowWithRequire).require?.bind(window);
    const remote = this.getElectronRemote();
    const dialog = remote?.dialog;
    if (!requireFn || !dialog) {
      throw new Error("无法调用 Obsidian 原生 PDF 导出，请确认正在桌面端运行");
    }

    const fileSystem = requireFn("fs") as NodeFileSystemLike;
    const nodeTimers = requireFn("timers") as NodeTimersLike;
    const os = requireFn("os") as { tmpdir(): string };
    const path = requireFn("path") as { join(...parts: string[]): string };
    const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const tempMarkdownPath = normalizePath(getNativeTempMarkdownPath(sourceFile.path, token));
    const tempPdfPath = path.join(os.tmpdir(), getNativeTempPdfFileName(token));
    let tempFile: TFile | null = null;
    let tempLeaf: WorkspaceLeaf | null = null;
    let nativeModal: HTMLElement | null = null;
    let existingModals: ReadonlySet<HTMLElement> | null = null;
    let originalShowSaveDialog: ElectronDialogLike["showSaveDialog"] | null = null;
    let saveDialogWrapper: ElectronDialogLike["showSaveDialog"] | null = null;
    let saveDialogInterceptorActive = false;
    let lateModalObserver: MutationObserver | null = null;
    let lateModalObserverTimeout: number | null = null;
    const vaultConfig = this.app.vault as typeof this.app.vault & VaultConfigLike;
    const pdfIncludeNameSnapshot = snapshotPdfIncludeName(vaultConfig.getConfig("pdfExportSettings"));
    let pdfIncludeNameTouched = false;
    let pdfIncludeNameRestored = false;
    const restoreIncludeNameSetting = (): void => {
      if (!pdfIncludeNameTouched || pdfIncludeNameRestored) return;
      const currentSettings = vaultConfig.getConfig("pdfExportSettings");
      vaultConfig.setConfig(
        "pdfExportSettings",
        restorePdfIncludeName(currentSettings, pdfIncludeNameSnapshot),
      );
      pdfIncludeNameRestored = true;
    };
    let rejectActiveWait: ((error: Error) => void) | null = null;
    const stopLateModalObserver = (): void => {
      lateModalObserver?.disconnect();
      lateModalObserver = null;
      if (lateModalObserverTimeout !== null) {
        window.clearTimeout(lateModalObserverTimeout);
        lateModalObserverTimeout = null;
      }
    };
    const observeLateModal = (): void => {
      if (lateModalObserver || !existingModals || !tempFile) return;
      lateModalObserver = new MutationObserver(() => {
        if (!existingModals || !tempFile) return;
        const lateModal = this.findNativeExportModal(existingModals, tempFile.basename);
        if (!lateModal) return;
        this.closeNativeExportModal(lateModal);
        stopLateModalObserver();
      });
      lateModalObserver.observe(document.body, { childList: true, subtree: true });
      lateModalObserverTimeout = window.setTimeout(stopLateModalObserver, NATIVE_EXPORT_MODAL_TIMEOUT_MS);
    };
    const cleanupRuntime = (): void => {
      saveDialogInterceptorActive = false;
      rejectActiveWait?.(new Error("插件已卸载，已取消原生 PDF 导出"));
      rejectActiveWait = null;
      if (originalShowSaveDialog && saveDialogWrapper && dialog.showSaveDialog === saveDialogWrapper) {
        dialog.showSaveDialog = originalShowSaveDialog;
      }
      restoreIncludeNameSetting();
      const modalToClose = nativeModal ?? (
        existingModals && tempFile
          ? this.findNativeExportModal(existingModals, tempFile.basename)
          : null
      );
      if (modalToClose) {
        this.closeNativeExportModal(modalToClose);
        stopLateModalObserver();
      } else {
        observeLateModal();
      }
      tempLeaf?.detach();
    };
    this.activeNativeExportCleanup = cleanupRuntime;

    new Notice("正在使用 Obsidian 原生方式导出 PDF，期间界面可能暂时无响应", 8000);

    try {
      tempFile = await this.app.vault.create(tempMarkdownPath, markdown);
      this.assertPluginLoaded();
      tempLeaf = this.app.workspace.getLeaf("tab");
      await tempLeaf.openFile(tempFile, { active: true });
      this.assertPluginLoaded();
      await this.delayWithNodeTimers(nodeTimers, 1500);
      this.assertPluginLoaded();

      const nativeView = tempLeaf.view as NativePdfMarkdownView;
      if (!(nativeView instanceof MarkdownView) || typeof nativeView.printToPdf !== "function") {
        throw new Error("无法打开 Obsidian 原生 Markdown 导出视图");
      }

      const currentSettings = vaultConfig.getConfig("pdfExportSettings");
      pdfIncludeNameTouched = true;
      pdfIncludeNameRestored = false;
      vaultConfig.setConfig("pdfExportSettings", {
        ...(typeof currentSettings === "object" && currentSettings !== null
          ? currentSettings as Record<string, unknown>
          : {}),
        includeName: false,
      });
      existingModals = new Set(document.querySelectorAll<HTMLElement>(".modal-container"));
      nativeView.printToPdf();
      nativeModal = await this.waitForNativeExportModal(existingModals, tempFile.basename);
      this.assertPluginLoaded();
      this.configureNativeExportModal(nativeModal);

      let resolveSaveDialogCalled: (() => void) | null = null;
      const saveDialogCalled = new Promise<void>((resolve) => {
        resolveSaveDialogCalled = resolve;
      });
      originalShowSaveDialog = dialog.showSaveDialog;
      saveDialogInterceptorActive = true;
      saveDialogWrapper = async (...args: unknown[]): Promise<SaveDialogResult> => {
        if (!saveDialogInterceptorActive) {
          return originalShowSaveDialog?.apply(dialog, args) ?? { canceled: true };
        }
        const options = args.find((argument) => (
          typeof argument === "object" && argument !== null && "defaultPath" in argument
        )) as {
          defaultPath?: unknown;
          filters?: Array<{ extensions?: string[] }>;
        } | undefined;
        const expectedDefaultPath = `${tempFile?.basename ?? ""}.pdf`;
        const isExpectedPdfDialog = typeof options?.defaultPath === "string" &&
          options.defaultPath.replace(/\\/g, "/").endsWith(expectedDefaultPath) &&
          (options.filters?.some((filter) => filter.extensions?.includes("pdf")) ?? false);
        if (!isExpectedPdfDialog) {
          return originalShowSaveDialog?.apply(dialog, args) ?? { canceled: true };
        }
        resolveSaveDialogCalled?.();
        return { canceled: false, filePath: tempPdfPath };
      };
      dialog.showSaveDialog = saveDialogWrapper;
      const exportButton = nativeModal.querySelector<HTMLButtonElement>("button.mod-cta") ??
        Array.from(nativeModal.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => button.textContent === "导出" || button.textContent === "Export");
      if (!exportButton) {
        throw new Error("未找到 Obsidian 原生导出按钮");
      }
      exportButton.click();
      restoreIncludeNameSetting();

      const cancelled = new Promise<void>((_resolve, reject) => {
        rejectActiveWait = reject;
      });
      await Promise.race([
        withTimeout(saveDialogCalled, NATIVE_EXPORT_MODAL_TIMEOUT_MS, "原生 PDF 保存对话框未响应"),
        cancelled,
      ]);
      rejectActiveWait = null;
      this.assertPluginLoaded();
      saveDialogInterceptorActive = false;
      if (dialog.showSaveDialog === saveDialogWrapper) {
        dialog.showSaveDialog = originalShowSaveDialog;
      }
      return await this.waitForCompleteNativePdf(fileSystem, tempPdfPath, nodeTimers);
    } finally {
      cleanupRuntime();
      if (this.activeNativeExportCleanup === cleanupRuntime) {
        this.activeNativeExportCleanup = null;
      }
      const currentTempFile = this.app.vault.getAbstractFileByPath(tempMarkdownPath);
      if (tempFile && currentTempFile === tempFile) {
        await this.app.vault.delete(tempFile, true).catch(() => undefined);
      }
      void this.cleanupNativeTempPdf(fileSystem, tempPdfPath, nodeTimers);
    }
  }

  private getElectronRemote(): ElectronRemoteLike | null {
    const requireFn = (window as WindowWithRequire).require?.bind(window);
    if (!requireFn) return null;
    try {
      const electron = requireFn("electron") as { remote?: ElectronRemoteLike } | null;
      return electron?.remote ?? (requireFn("@electron/remote") as ElectronRemoteLike | null);
    } catch (error) {
      console.error("Failed to access Electron remote", error);
      return null;
    }
  }

  private async waitForNativeExportModal(
    existingModals: ReadonlySet<HTMLElement>,
    tempBasename: string,
  ): Promise<HTMLElement> {
    const deadline = Date.now() + NATIVE_EXPORT_MODAL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      this.assertPluginLoaded();
      const modal = this.findNativeExportModal(existingModals, tempBasename);
      if (modal) return modal;
      await this.delay(100);
    }
    throw new Error("Obsidian 原生 PDF 导出窗口未打开");
  }

  private findNativeExportModal(
    existingModals: ReadonlySet<HTMLElement>,
    tempBasename: string,
  ): HTMLElement | null {
    return Array.from(document.querySelectorAll<HTMLElement>(".modal-container"))
      .find((candidate) => (
        !existingModals.has(candidate) && candidate.textContent?.includes(tempBasename)
      )) ?? null;
  }

  private configureNativeExportModal(modal: HTMLElement): void {
    const configured = this.setNativeExportCheckbox(
      modal,
      ["将文件名作为标题", "将笔记名作为标题", "Include file name as title", "Include note name as title"],
      0,
      false,
    );
    if (!configured) {
      throw new Error("无法关闭原生导出的临时文件名标题");
    }
  }

  private setNativeExportCheckbox(
    modal: HTMLElement,
    labels: string[],
    fallbackIndex: number,
    checked: boolean,
  ): boolean {
    const setting = Array.from(modal.querySelectorAll<HTMLElement>(".setting-item"))
      .find((item) => labels.some((label) => item.textContent?.includes(label)));
    const allCheckboxes = Array.from(modal.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
    const checkbox = setting?.querySelector<HTMLInputElement>('input[type="checkbox"]') ?? allCheckboxes[fallbackIndex];
    if (!checkbox) return false;
    if (checkbox && checkbox.checked !== checked) {
      checkbox.click();
    }
    return checkbox.checked === checked;
  }

  private closeNativeExportModal(modal: HTMLElement | null): void {
    if (!modal?.isConnected) return;
    const closeButton = modal.querySelector<HTMLElement>(".modal-close-button");
    if (closeButton) {
      closeButton.click();
      return;
    }
    const cancelButton = Array.from(modal.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "取消" || button.textContent === "Cancel");
    cancelButton?.click();
  }

  private async waitForCompleteNativePdf(
    fileSystem: NodeFileSystemLike,
    pdfPath: string,
    nodeTimers: NodeTimersLike,
  ): Promise<Uint8Array> {
    return await new Promise<Uint8Array>((resolve, reject) => {
      let settled = false;
      let pollId: unknown = null;
      let lastCompleteSize = -1;
      let stableCompletePolls = 0;
      const finish = (callback: () => void): void => {
        if (settled) return;
        settled = true;
        if (pollId !== null) nodeTimers.clearTimeout(pollId);
        nodeTimers.clearTimeout(timeoutId);
        callback();
      };
      const inspectFile = (): void => {
        if (settled) return;
        if (this.unloaded) {
          finish(() => reject(new Error("插件已卸载，已取消原生 PDF 导出")));
          return;
        }
        const scheduleNext = (): void => {
          if (!settled) {
            pollId = nodeTimers.setTimeout(inspectFile, NATIVE_EXPORT_WATCH_INTERVAL_MS);
          }
        };
        if (!fileSystem.existsSync(pdfPath)) {
          scheduleNext();
          return;
        }
        try {
          const bytes = new Uint8Array(fileSystem.readFileSync(pdfPath));
          if (this.isCompletePdf(bytes)) {
            stableCompletePolls = bytes.length === lastCompleteSize ? stableCompletePolls + 1 : 1;
            lastCompleteSize = bytes.length;
            if (stableCompletePolls >= 2) {
              finish(() => resolve(bytes));
              return;
            }
            scheduleNext();
            return;
          }
          lastCompleteSize = -1;
          stableCompletePolls = 0;
          scheduleNext();
        } catch {
          scheduleNext();
        }
      };
      const timeoutId = nodeTimers.setTimeout(() => {
        finish(() => reject(new Error("Obsidian 原生 PDF 导出超时")));
      }, NATIVE_EXPORT_FILE_TIMEOUT_MS);
      inspectFile();
    });
  }

  private isCompletePdf(bytes: Uint8Array): boolean {
    if (bytes.length < 8 || String.fromCharCode(...bytes.subarray(0, 5)) !== "%PDF-") {
      return false;
    }
    const tail = bytes.subarray(Math.max(0, bytes.length - 1024));
    return new TextDecoder("latin1").decode(tail).includes("%%EOF");
  }

  private async cleanupNativeTempPdf(
    fileSystem: NodeFileSystemLike,
    pdfPath: string,
    nodeTimers: NodeTimersLike,
  ): Promise<void> {
    for (const delayMs of [0, 1000, 5000, 30000, 120000]) {
      if (delayMs > 0) await this.delayWithNodeTimers(nodeTimers, delayMs);
      if (!fileSystem.existsSync(pdfPath)) return;
      try {
        await fileSystem.promises.unlink(pdfPath);
        return;
      } catch (error) {
        if (!shouldRetryNativeTempPdfCleanup(error)) {
          console.warn("Failed to remove native PDF temp file", pdfPath, error);
          return;
        }
      }
    }
    console.warn("Failed to remove native PDF temp file", pdfPath);
  }

  private async addBookmarksToRenderedPdf(
    pdfBytes: Uint8Array,
    markdown: string,
    markers: PdfBookmarkMarker[],
  ): Promise<{ bytes: Uint8Array; matchedCount: number; expectedCount: number }> {
    const pageTexts = await this.extractPdfPageTexts(pdfBytes.slice());
    const headings = getPdfBookmarkHeadings(parseMarkdownHeadings(markdown));
    const targets = mapPdfBookmarkMarkersToPages(markers, pageTexts);
    const title = headings.find((heading) => heading.level === 1)?.heading;
    return {
      bytes: await addPdfBookmarks(pdfBytes, targets, { title }),
      matchedCount: targets.length,
      expectedCount: markers.length,
    };
  }

  private prepareBookmarkedNativeMarkdown(markdown: string): {
    markdown: string;
    markers: PdfBookmarkMarker[];
  } {
    const headings = parseMarkdownHeadingRanges(markdown)
      .filter((heading) => getPdfBookmarkHeadings([heading]).length > 0);
    const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return injectPdfBookmarkMarkers(markdown, headings, token);
  }

  private async writeBookmarkedNativePdf(
    outputPath: string,
    nativePdfBytes: Uint8Array,
    markdown: string,
    markers: PdfBookmarkMarker[],
  ): Promise<{ matchedCount: number }> {
    this.assertPluginLoaded();
    if (markers.length === 0) {
      throw new Error("当前内容没有可写入 PDF 的标题，未生成最终文件");
    }
    const finalized = await this.addBookmarksToRenderedPdf(nativePdfBytes.slice(), markdown, markers);
    if (finalized.matchedCount !== finalized.expectedCount) {
      throw new Error(
        `PDF 书签匹配不完整（${finalized.matchedCount}/${finalized.expectedCount}），未写入最终文件`,
      );
    }

    this.assertPluginLoaded();
    await this.writeBinaryVaultFile(outputPath, this.toArrayBuffer(finalized.bytes));
    return { matchedCount: finalized.matchedCount };
  }

  private delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }

  private delayWithNodeTimers(nodeTimers: NodeTimersLike, milliseconds: number): Promise<void> {
    return new Promise((resolve) => {
      nodeTimers.setTimeout(resolve, milliseconds);
    });
  }

  private async addBookmarksToNativePdfForFile(markdownFile: TFile): Promise<void> {
    if (!Platform.isDesktopApp) {
      new Notice("PDF 书签处理仅支持 Obsidian 桌面端");
      return;
    }

    try {
      const pdfFile = await this.resolveNativePdfFile(markdownFile);
      if (!pdfFile) {
        return;
      }

      const markdown = await this.getMarkdownContent(markdownFile);
      const markdownHeadings = parseMarkdownHeadings(markdown);
      const bookmarkHeadings = getPdfBookmarkHeadings(markdownHeadings);
      if (bookmarkHeadings.length === 0 && !needsSyntheticPdfRootHeading(markdownHeadings)) {
        new Notice("当前 Markdown 文件没有可写入 PDF 的标题");
        return;
      }

      const inputPdfBytes = await this.app.vault.readBinary(pdfFile);
      const pageTexts = await this.extractPdfPageTexts(inputPdfBytes);
      const targets = this.buildBookmarkTargets(markdownFile, markdownHeadings, pageTexts);
      if (targets.length === 0) {
        new Notice("没有在 PDF 中匹配到 Markdown 标题，请确认选择的是该笔记的原生导出 PDF");
        return;
      }

      const outputBytes = await addPdfBookmarks(inputPdfBytes, targets);
      const outputPath = normalizePath(getBookmarkedPdfExportPath(pdfFile.path));
      await this.writeBinaryVaultFile(outputPath, this.toArrayBuffer(outputBytes));

      new Notice(`已添加 ${targets.length} 个 PDF 书签：${outputPath}`);
    } catch (error) {
      console.error("Failed to add PDF bookmarks", error);
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`添加 PDF 书签失败：${message}`);
    }
  }

  private async resolveNativePdfFile(markdownFile: TFile): Promise<TFile | null> {
    const defaultPath = normalizePath(markdownFile.path.replace(/\.md$/i, ".pdf"));
    const defaultFile = this.app.vault.getAbstractFileByPath(defaultPath);
    if (defaultFile instanceof TFile && this.isNativePdfCandidate(defaultFile)) {
      return defaultFile;
    }

    const candidates = this.app.vault
      .getFiles()
      .filter((file) => this.isNativePdfCandidate(file))
      .sort((left, right) => this.scorePdfCandidate(markdownFile, right) - this.scorePdfCandidate(markdownFile, left));

    if (candidates.length === 0) {
      new Notice("未找到可处理的 PDF。请先用 Obsidian 原生功能导出 PDF。");
      return null;
    }

    new Notice("未找到同名 PDF，请在弹出的列表中选择原生导出的 PDF。");
    return new Promise<TFile | null>((resolve) => {
      new PdfFileSuggestModal(this.app, candidates, resolve).open();
    });
  }

  private scorePdfCandidate(markdownFile: TFile, pdfFile: TFile): number {
    let score = 0;
    if (this.getFolder(markdownFile.path) === this.getFolder(pdfFile.path)) {
      score += 100;
    }
    if (pdfFile.basename === markdownFile.basename) {
      score += 50;
    }
    if (pdfFile.basename.includes(markdownFile.basename) || markdownFile.basename.includes(pdfFile.basename)) {
      score += 10;
    }
    return score;
  }

  private getFolder(path: string): string {
    const index = path.lastIndexOf("/");
    return index < 0 ? "" : path.slice(0, index);
  }

  private async getMarkdownContent(file: TFile): Promise<string> {
    const activeMarkdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (activeMarkdownView?.file?.path === file.path) {
      return activeMarkdownView.getViewData();
    }

    // If the same file is open in multiple leaves, prefer the active matching view above;
    // otherwise use the first matching markdown leaf's unsaved snapshot.
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (view instanceof MarkdownView && view.file?.path === file.path) {
        return view.getViewData();
      }
    }

    return this.app.vault.cachedRead(file);
  }

  private buildBookmarkTargets(
    markdownFile: TFile,
    markdownHeadings: OutlineHeading[],
    pageTexts: string[],
  ): PdfBookmarkTarget[] {
    const targets = mapPdfBookmarkHeadingsToPages(markdownHeadings, pageTexts);
    if (needsSyntheticPdfRootHeading(markdownHeadings)) {
      targets.unshift({
        heading: markdownFile.basename,
        level: 1,
        pageIndex: 0,
      });
    }
    return targets;
  }

  private async extractPdfPageTexts(pdfData: ArrayBuffer | Uint8Array): Promise<string[]> {
    const pdfjsLib = await loadPdfJs();
    const bytes = pdfData instanceof Uint8Array ? pdfData : new Uint8Array(pdfData);
    const loadingTask = pdfjsLib.getDocument({ data: bytes });
    const pdfDocument = await loadingTask.promise;
    const pageTexts: string[] = [];

    try {
      for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
        const page = await pdfDocument.getPage(pageNumber);
        const textContent = await page.getTextContent();
        const text = textContent.items
          .map((item: { str?: string }) => item.str ?? "")
          .join("");
        pageTexts.push(text);
      }
    } finally {
      await loadingTask.destroy?.();
      await pdfDocument.destroy?.();
    }

    return pageTexts;
  }

  private toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  }

  private async writeBinaryVaultFile(path: string, data: ArrayBuffer): Promise<void> {
    this.assertPluginLoaded();
    const existing = this.app.vault.getAbstractFileByPath(path);

    if (existing instanceof TFile) {
      await this.app.vault.modifyBinary(existing, data);
      return;
    }

    if (existing) {
      throw new Error(`目标路径不是文件：${path}`);
    }

    await this.app.vault.createBinary(path, data);
  }

  private assertPluginLoaded(): void {
    if (this.unloaded) {
      throw new Error("插件已卸载，已取消导出写入");
    }
  }
}

class PdfFileSuggestModal extends FuzzySuggestModal<TFile> {
  private resolved = false;

  constructor(
    app: App,
    private readonly files: TFile[],
    private readonly resolve: (file: TFile | null) => void,
  ) {
    super(app);
    this.setPlaceholder("选择 Obsidian 原生导出的 PDF");
  }

  getItems(): TFile[] {
    return this.files;
  }

  getItemText(file: TFile): string {
    return file.path;
  }

  onChooseItem(file: TFile): void {
    this.resolved = true;
    this.resolve(file);
  }

  onClose(): void {
    if (!this.resolved) {
      this.resolve(null);
    }
  }
}
