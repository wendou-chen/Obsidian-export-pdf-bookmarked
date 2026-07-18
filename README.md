# Bookmarked PDF Export

简体中文 | [English](README.en.md)

把 Obsidian 笔记或右侧大纲中选中的章节导出为带原生 PDF 书签的文档，书签会根据 Markdown 标题自动生成。

这个插件会把笔记里的标题层级写入 PDF 的原生 outline/bookmarks 结构。导出后，用常见 PDF 阅读器打开文件时，可以直接在侧边栏看到可点击的大纲。它也保留了原本的大纲工作流：可以复制当前笔记大纲，或把大纲导出为 Markdown 文件。

## 主要用途

这个插件主要服务两个场景：

- 整理考研大纲和考研资料。长篇 Markdown 笔记可以导出成类似书籍的 PDF，章节标题会变成可点击的 PDF 书签，复习、检索和分发资料时更顺手；也可以只从右侧大纲复制或导出当前需要的章节。
- 配合我的笔记仓库 [MBA Study Notes](https://github.com/wendou-chen/MBA-Study-Notes) 使用。笔记仓库负责沉淀 Obsidian 里的结构化知识，这个插件负责把选中的笔记、大纲和专题资料包导出成带书签的 PDF。

这两个仓库配合使用会更有效：`MBA Study Notes` 负责长期维护知识库结构，`Bookmarked PDF Export` 负责把 Markdown 标题结构转换成可阅读、可分享、可归档的 PDF 文档。

## 功能

- 将当前笔记导出为 `*.bookmarked.pdf`。
- 为 Obsidian 原生导出的 PDF 添加书签。
- 根据 Markdown 标题生成 PDF 书签。
- 导出的 PDF 会写入 `/Outlines`，并设置 `/PageMode /UseOutlines`。
- 复制或导出当前笔记的 Markdown 大纲。
- 从 Obsidian 核心右侧 Outline 精确复制或导出单个标题对应的完整 Markdown 区段。
- 在桌面端把选中区段导出为带书签 PDF。

## 从右侧 Outline 导出单节

在 Obsidian 核心右侧 **Outline（大纲）** 中右击一个标题，可使用：

1. **复制此节 Markdown**
2. **导出此节 Markdown**
3. **导出此节带书签 PDF**（仅 Obsidian 桌面端）

区段从被右击的标题开始，包含标题本身、正文和所有更深层级的后代标题；在下一个同级或更高级标题之前结束。如果后面没有这样的标题，则持续到文件末尾。插件原样保留所选 Markdown，不重新编号或降低标题层级。

单节导出文件写入系统 **Downloads** 文件夹（Windows 通常为 `C:\Users\<用户名>\Downloads`），便于即用即删：

- Markdown：`Downloads\源文件名--标题.section.md`
- PDF：`Downloads\源文件名--标题.bookmarked.pdf`

整篇大纲 Markdown 和整篇带书签 PDF 仍写入源笔记所在目录。

文件名中的非法字符和多余空白会被安全清理。若重复标题或清理后的标题会产生同名文件，文件名会在扩展名前追加该标题在全文中的 1-based 序号，以稳定区分不同区段；再次导出同一区段会覆盖对应文件。

单节 PDF 会以原笔记 basename 生成一个合成 H1，作为视觉一级标题和 PDF 根书签；被选标题及其后代仍保留原始 Markdown 标题层级。现有 PDF 书签规则会为区段中的 H1–H3 生成书签。

### 实时内容与安全行为

- 如果源文件处于活动编辑器或任一打开的 Markdown 编辑器中，复制和导出会读取编辑器的最新内容，包括尚未保存的修改；否则读取 Vault 中的文件。
- 插件会依据标题位置与全文序号定位重复标题，不会只按标题文字选择第一个同名标题。
- 若标题在右键菜单打开后被修改或删除，操作会安全终止并提示重新右击。
- 核心 Outline 没有公开的标题右键菜单 API。插件将私有 Outline 结构隔离在适配层；若未来 Obsidian 改变该结构，插件会不显示区段菜单或中止操作，而不会猜测并导出错误章节。

## 命令

| 命令 | 作用 |
| --- | --- |
| 复制当前文件大纲 Markdown | 将当前笔记的标题树复制到剪贴板。 |
| 导出当前文件大纲 Markdown | 在源笔记旁边生成 `*.outline.md` 文件。 |
| 导出带书签 PDF | **推荐主路径**：内部完成原生打印 + 唯一标记定位 + 书签写入，一次生成 `*.bookmarked.pdf`。成功 Notice 会显示 `matched/expected`；任一书签未匹配则失败且不写最终文件。 |
| 给已有 PDF 注入书签（尽力匹配，非一键导出） | **次路径/兼容**：对已有原生 PDF 按标题文本尽力匹配。可能部分命中、页码不准；不保证与一键导出同等质量。 |

PDF 相关命令及单节文件写入系统 Downloads 依赖桌面文件系统，因此需要在 Obsidian 桌面端使用。移动端仍可使用“复制此节 Markdown”。

## 为什么需要这个插件

Obsidian 自带 PDF 导出，社区里也有不少插件可以改善导出样式或处理长文发布。但对考研资料、课程讲义、手册式文档来说，一个常见缺口是：PDF 里没有可靠的原生书签。

这个插件专注解决这个小而关键的问题：继续用 Markdown 写笔记，按整篇或右侧大纲中的单节导出，并在 PDF 中保留标题结构，让 PDF 也像一本有目录的书一样可导航。

## 插件定位

| 工具或方案 | PDF 导出 | 原生 PDF 书签 | 说明 |
| --- | --- | --- | --- |
| Bookmarked PDF Export (`outline-markdown-export`) | 支持 | 支持 | 使用 `pdf-lib` 写入 `/Outlines`，并设置 `/PageMode /UseOutlines`。 |
| Obsidian 原生 PDF 导出 | 支持 | 不能可靠按 Markdown 标题生成 | 可以作为“给已有 PDF 注入书签”命令的来源 PDF。 |
| 常见 outline/TOC 插件 | 通常不负责 | 通常不负责 | 多数用于生成 Markdown 目录或笔记内导航，不写 PDF outline 对象。 |

## 从源码安装

```bash
npm install
npm run build
```

然后把下面这些文件放在你的 vault 插件目录中，或直接保留当前插件目录：

```text
.obsidian/plugins/outline-markdown-export/
  main.js
  manifest.json
```

之后在 Obsidian 的社区插件设置中启用插件。

## 开发

```bash
npm install
npm run dev
npm test
```

测试覆盖大纲与区段解析、导出路径、重复标题定位、标题过滤、页码匹配和 PDF 书签注入。

## 限制

- PDF 导出命令和单节带书签 PDF 需要 Obsidian 桌面端。
- 书签来自 Markdown 标题，默认只写入 **H1–H3**（更深标题不会进 PDF 大纲）。
- **一键导出契约**：书签必须全部匹配成功才写入 `*.bookmarked.pdf`；匹配不全会明确失败，不会留下“无书签却叫 bookmarked”的文件。
- 整篇 `*.bookmarked.pdf` 保留在源笔记目录；单节 `.section.md` 与 `.bookmarked.pdf` 写入系统 Downloads 文件夹。
- 查看书签请优先用 **Edge / SumatraPDF / Adobe** 等外部阅读器打开左侧大纲；Obsidian 内置 PDF 查看器不一定显示 `/Outlines`。
- 导出期间可能短暂无响应，来自 Obsidian 原生 `printToPdf` 布局，不是书签算法本身。
- 「给已有 PDF 注入书签」按页面文本匹配标题，属于尽力而为；扫描版、纯图 PDF 或正文同名词可能导致错页，推荐改用「导出带书签 PDF」。
- 单节右键功能依赖经过运行时校验的 Obsidian 核心 Outline 私有结构；结构不兼容时会安全停用，不会猜测标题。

## GitHub 仓库信息

推荐 GitHub description：

> 将 Obsidian 笔记或大纲章节导出为带原生 PDF 书签的文档，适合考研大纲和资料整理。

推荐 topics：

```text
obsidian-plugin, obsidian, markdown, pdf, bookmarks, outline, typescript
```

## 许可证

MIT
