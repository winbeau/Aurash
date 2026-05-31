# 写作栏文件上传 + 预览 + HF同步 — 实现方案

> 来源：research+design workflow（12 agent，评审三票 + 对抗式完备性批判）。
> 评审选定骨架 = 「最小依赖·自托管优先」。批判 verdict = **needs-revision**：骨架扎实，
> 但落地前必须补齐下方「关键修订」7 项硬伤后方可实现。

> **跨功能统一（reconciliation，2026-05-31）**：本功能与「资料」页（`docs/plan-materials-integration.md`）
> 共享一套上传+预览基础设施。**预览栈已统一为较强的一套：pdfjs-dist（多页/缩放）+ docx-preview（高保真）+ @js-preview/excel**，
> 取代本文下方初版的「PDF=iframe / DOCX=mammoth」选型（全部 lazy-load，首屏零增；本方案早已把 PdfViewer 抽象为可替换 + 取数统一 fetch→blob，正好平滑切换）。
> 上传上限统一 **50MB**；`/uploads` 静态硬化（nosniff + Content-Disposition + 拒 svg/html）做一次。
> 共享 `components/common/preview/` viewer 同时服务编辑器附件预览（本功能 `FilePreviewDialog`）与资料页 `PreviewPane`。下方 iframe/mammoth/25MB 描述以本 banner 为准修订。

## 概述

写作栏支持 Windows 拖拽上传 `doc/docx/ppt/pptx/xls/xlsx/pdf`：
- 后端新增 `POST /notes/files`（复用 `/notes` 前缀，**零 nginx 改动**；纯 stdlib 魔数校验 + OOXML zipfile 子类型校验 + 25MB 上限）。
- 文件存到现有 `backend/uploads/notes/<sid>/`，**HF `dir_tar` 自动覆盖、零同步代码改动**。
- 正文用标准 markdown 链接 `[文件名.ext](url)` 表示，在共享 `Markdown.tsx` 的 `components.a` 识别 → 渲染 `FileCard`（预览面板 + 发布详情页两处生效）。
- 预览统一进 `ui/dialog` 弹窗：PDF=零依赖 `iframe`（抽成可替换 `PdfViewer`）；DOCX=lazy `mammoth` + `DOMPurify` 套 `prose-claude`；XLSX=lazy `@js-preview/excel`；PPTX/老二进制(.doc/.ppt/.xls)=降级下载卡。
- 图标自写一套单色折角文档 SVG（DOC蓝/XLS绿/PPT橙/PDF红），配色严格取 `cat-*`/`tag-*` token，与全站 lucide 同笔触、零供应链、无 AI 味。
- 前端仅新增 2 个 lazy 依赖 + 1 个 sanitize 依赖，**首屏 bundle 零增**。

## 后端契约 — `POST /notes/files`

同一 `router=APIRouter(prefix="/notes")`，同一文件 `backend/app/routes/uploads.py`：

```
async def upload_file(file: UploadFile = File(...), user: User = Depends(get_current_user)) -> UploadedFile
```

- 鉴权同 `upload_image`（无 token → 401）。入参 `multipart/form-data` 单字段 `file`。
- 新增模块级常量（便于 monkeypatch 测试）：
  - `DOC_DIR = IMAGE_DIR`（= `UPLOAD_ROOT/"notes"`，doc 与图片同目录；抽成独立常量预留未来拆 Artifact）
  - `MAX_DOC_BYTES = 25 * 1024 * 1024`
  - `ALLOWED_DOC_EXTS = {'.pdf','.doc','.docx','.ppt','.pptx','.xls','.xlsx'}`
  - `EXT_TO_MIME`（ext → 规范 MIME 反查表）
- **四道交叉校验（全 stdlib，零新依赖）**：
  1. 扩展名 allowlist：不在 `ALLOWED_DOC_EXTS` → 400「仅支持 pdf / word / ppt / excel」。**显式不收 `.svg/.html/.htm/.xml`**（注释写明：否则浏览器当页面执行 → XSS）。
  2. `content_type` 仅作旁证（可伪造，不强制；见关键修订 §7 决定去留）。
  3. 空体 → 400「文件为空」；`len(data) > MAX_DOC_BYTES` → 400「文件不能超过 25 MB」。
  4. 魔数 `_sniff_doc(ext, data) -> bool`（独立可测函数）：
     - pdf: `data[:5] == b'%PDF-'`
     - OOXML(docx/xlsx/pptx): `data[:4] in (PK\x03\x04, PK\x05\x06, PK\x07\x08)` 且 `zipfile` 能打开、`namelist` 含 `[Content_Types].xml`，并按子类型校验目录前缀（docx→`word/`、xlsx→`xl/`、pptx→`ppt/`）
     - OLE2(老 doc/xls/ppt): `data[:8] == b'\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1'`
     - 魔数与扩展名家族不匹配 → 400「文件内容与类型不符」
- 存储：`DOC_DIR / user.sid / fname`，`fname = f"{int(time.time())}-{secrets.token_hex(4)}{ext}"`（后端生成，**丢弃用户原始 filename 做磁盘名**，杜绝穿越/覆盖/XSS）。
- 返回 schema `UploadedFile(CamelModel)`：`{ url, filename, size, mime }`
  - `url = f"{settings.public_base_url}/uploads/notes/{user.sid}/{fname}"`
  - `filename` = 安全展示名（去控制字符 + **转义 markdown 元字符**，见关键修订 §2 + 截断 200）
  - `size = len(data)`；`mime = EXT_TO_MIME[ext]`（规范 MIME，不回传客户端可伪造的 content_type）

## 存储 + HF 同步（备份）

- 磁盘：`backend/uploads/notes/<sid>/<ts>-<rand>.<ext>`，doc 与图片混放同目录，靠扩展名区分。
- **HF 同步零代码改动**：`config.ARTIFACTS` 已含 `Artifact("uploads","dir_tar","state/uploads.tar", backend/uploads)`，doc 自动纳入确定性 tar；`make data-pull` 一键恢复。
- tar 膨胀对策 = 后端 `MAX_DOC_BYTES=25MB` 单文件封顶；暂不拆独立 Artifact（`DOC_DIR` 常量已预留，未来需单列限额时 append 一条 `Artifact("docs","dir_tar",...)`，push/pull 不动）。
- pull 整目录覆盖语义（非增量 merge）= 现有图片同风险；遵循 push-pull 单写者纪律：上传前先 pull、上传后即 push。

## 前端

| 文件 | 作用 |
|---|---|
| `lib/fileTypes.ts` (new) | 单一来源：`DOC_EXTS`、`extOf`、`isDocFile`/`isImageFile`(Win 优先扩展名兜底)、`kindOf`→{kind,label,brand}、`isPreviewable`、`isAttachmentHref` |
| `components/common/FileTypeIcon.tsx` (new) | 自写彩色 SVG（折角文档 + 品牌色类型标签），currentColor 单色，未知走 lucide `File` |
| `components/common/FileCard.tsx` (new) | 附件卡片（`span` 块级，`data-filecard`）：左 tile + 文件名 + 类型 badge + 预览(`Eye`)/下载/新窗口(`ExternalLink`) |
| `components/common/FilePreviewDialog.tsx` (new) | 统一预览弹窗，按 `kind` 分发，lazy viewer + Suspense |
| `components/common/preview/PdfViewer.tsx` (new) | iframe（带 `sandbox`，见 §4），抽象可替换 |
| `components/common/preview/DocxViewer.tsx` (new) | lazy mammoth → DOMPurify → 套 prose-claude |
| `components/common/preview/ExcelViewer.tsx` (new) | lazy `@js-preview/excel`，命令式 API，卸载 destroy |
| `api/endpoints/uploads.ts` (edit) | `uploadNoteFile` + `UploadedFileSchema` |
| `components/common/Markdown.tsx` (edit) | `components.a` 命中 `isAttachmentHref` → `<FileCard>` |
| `features/editor/MarkdownEditor.tsx` (edit) | paste/drop 两处硬过滤 `image/` → `isImageFile||isDocFile` |
| `features/editor/WritePage.tsx` (edit) | `uploadAndInsert` 分流 + toast 泛化 + `docInputRef`/第二 input + 拖拽 overlay(dragCounter 防抖) + 多文件循环 |
| `features/editor/toolbar/SubToolbar.tsx` (edit) | 加 `onPickFile` + Paperclip 按钮 |
| `features/comments/.../useAnchorMarks.ts` (edit) | **见关键修订 §1**：walker 跳过 FileCard 子树 |

### 图标规范（无 AI 味四原则）
24×24 折角文档轮廓 + 底部品牌色类型标签（DOC/XLS/PPT/PDF 白字）。配色取 token：Word→`cat-kaggle`蓝、Excel→`cat-tools`绿、PPT→`cat-course`橙、PDF→`cat-research`红，`tag-*` 12% tint 底（复刻 NoteCard avatar-tile）。其余 UI 一律 lucide 线性单色。①绝不全用同一灰 `File` ②与工具栏 lucide 同笔触 ③只取既有 token 不造新色 ④单 currentColor 无渐变。

### 依赖
`pnpm add mammoth@^1.12.0 @js-preview/excel@^1.7.14 dompurify@^3` + `@types/dompurify`(dev)。三者全部**动态 import 进 lazy chunk**，不进首屏。（避开 SheetJS CVE-2023-30533 与 CDN-tarball CI 脆弱；@js-preview/excel 内含 exceljs ~1MB 必须 lazy + bundle-viz 复核。）

## 关键修订（来自对抗式批判 — 落地前必做，verdict=needs-revision）

1. **[严重/已核实] FileCard ↔ 评论锚点 DOM walker 冲突**：`NoteDetailPage` 的 `useAnchorMarks.ts` 用 `createTreeWalker(SHOW_TEXT)` 遍历 contentRef 全部文本节点拼 `total` 串再注入 `<mark>`。FileCard 文件名会污染全局偏移 / `<mark>` 被插进卡片内部撕裂布局。**必须改 `useAnchorMarks.ts`**：`acceptNode` 对 `closest('[data-filecard]')` 整棵子树返回 `FILTER_REJECT`。→ 推翻「只改 Markdown.tsx 一处」承诺，fileChangeList 须含 `useAnchorMarks.ts`。
2. **[安全] filename markdown 元字符注入**：后端写盘前对 filename 转义 `[]()`*<>` 或 FileCard 链接文本不用原始名（用占位 + `title` 显示真实名），杜绝 `[filename](url)` 被畸形名破坏链接语法/注入。
3. **[安全] `/uploads` 加 `X-Content-Type-Options: nosniff`** + doc 类 `Content-Disposition: attachment`（或受控策略）；PR 说明里写清 prod nginx 是否已具备。allowlist 拒 svg/html 是第一道、nosniff 是第二道，缺一不可。
4. **[安全] iframe `sandbox` + 明确 DOMPurify 配置**：`PdfViewer` 的 iframe 加 `sandbox`（禁 `allow-scripts`）；`DocxViewer` 的 DOMPurify `FORBID_TAGS` 含 `script/iframe/object`、`img` 仅放行 `data:`、禁 `on*` 与 `javascript:` href（mammoth 默认把图转 base64，但须锁死）。
5. **[正确性] 跨源下载失效**：`<a download>` 仅对同源/`blob:` 生效；dev(5173↔8000 跨源)会退化为导航打开。下载按钮改 `fetch(url)→blob→a[download]`（与 viewer 取数统一），或明确接受 prod 同源、dev 降级。
6. **[正确性] 多文件上传语义**：定义失败是否中断后续、并发 toast 策略、`await` 期间光标移动导致 `onMarkdownInsert` 插错位的防护（插入前锁定/重定位插入点）。
7. **[整洁] 死字段 `mime`**：当前 FileCard 按扩展名 `kindOf` 分发，`mime` 无消费者 → 删除，或说明预览何处用它。

次要 gap（验收覆盖）：拖到编辑器空白/padding 区松手 & `editor-only`/`preview-only` viewMode 的拖拽行为须定义（防静默失败）；`isAttachmentHref` 单测覆盖绝对/相对/带 query/大写扩展名/URL 编码；移动端 NoteDetailPage 的 FileCard/Dialog（iOS Safari PDF iframe 常不内联）；exceljs lazy chunk 缺 CI size gate；HF tar 膨胀缺总量告警。

## 落地顺序

0. (并行) `lib/fileTypes.ts` + 后端 `schemas/uploads.py` 加 `UploadedFile`
1. 后端 `routes/uploads.py`（含 `_sniff_doc`）+ `test_doc_upload.py` → pytest 先绿
2. (并行) `pnpm add` 三依赖 → `pnpm build` 确认
3. 前端 `api/endpoints/uploads.ts` 加 `uploadNoteFile`
4. (并行) `FileTypeIcon` / `FileCard` / `PdfViewer`；`DocxViewer`/`ExcelViewer`(依赖步2)；`FilePreviewDialog`(依赖各 viewer)
5. `Markdown.tsx` 接 FileCard + `useAnchorMarks.ts` 修订(§1)
6. `MarkdownEditor` → `SubToolbar` → `WritePage`（拖拽/分流/多文件）
7. typecheck && lint && build → pytest → playwright → HF round-trip

## 验证清单（节选，完整见 workflow 输出）

- 后端 pytest：happy(真字节 pdf/docx/xlsx)、401、扩展名拒绝、显式拒 svg/html、超限、魔数伪造、OOXML 子类型错配、空文件、同名并发不覆盖；`_sniff_doc` 单测；filename 元字符
- 前端 typecheck/lint/build；bundle-viz 确认 mammoth/@js-preview/excel/exceljs/dompurify 全进 lazy chunk（记录 before/after KB）
- `isAttachmentHref` 单测（绝对/相对/query/大写/编码）
- Markdown 静态渲染四类型 FileCard 配色 + 普通链接仍走 `<a>`；NoteDetailPage 同样生效
- **anchor-mark 冲突回归**：含 FileCard + 紧邻文件名的评论锚点，确认卡片未被插 `<mark>`、其它锚点未错位；预览/下载按钮 stopPropagation 不误触
- 预览四态 + 损坏文件兜底（catch→toast→降级卡，不白屏）；Dialog a11y（Title/Esc/焦点回归）
- 拖拽(playwright)：虚线 overlay、dragleave 不闪烁、多文件按序插入、`f.type` 空的 office 文件扩展名兜底；空白区/viewMode 边界
- 未登录拦截 toast 泛化；跨源 vs 同源下载真触发
- `curl -I` 验 `/uploads` nosniff 头
- HF round-trip：push→sync-status(tar size + tar -tf 含 doc)→pull→sha256 一致 + 链接可访问
- prod FE 验证（双跳 huawei2 git pull + pnpm build，绕登录 playwright 复测，确认 https://winbeau.top 回源 200）

## 开放决策（需用户拍板）

| 决策 | 推荐 |
|---|---|
| 预览是否走微软 Office Online viewer 换 PPTX 高保真？ | **否**（文件外发微软 + 强制公网匿名 URL，违隐私红线）。PPTX/老二进制降级下载卡。 |
| DOCX 预览 mammoth(轻/丢版式) vs docx-preview(重/高保真)？ | **mammoth**（零外发、最省、套 prose-claude 统一），顶部标注「样式简化预览」。 |
| PDF 初版 iframe vs react-pdf？ | **iframe**（零依赖零配置，桌面够用），抽象 PdfViewer 预留 react-pdf 升级位。 |
| doc 是否单独 HF Artifact？ | **暂不拆**，靠 25MB 上限控膨胀；常量已预留。25MB 单文件上限是否 OK？ |
| `/uploads` 是否加鉴权（当前公开直链）？ | 初版**不加**（同现有图片模型）；viewer 已统一 fetch→blob，未来加 token 零返工。附件是否含敏感内容？ |
