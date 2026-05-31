# 「资料」页 — 迁移 KnoHub 课程资料 → Aurash

> 来源：research+design workflow（13 agent，深读 KnoHub clone + Aurash 靶点，评审三票 + 对抗式批判）。
> 骨架 = 「高保真迁移」（评审三票皆第一 74/74/75）。批判 verdict = **needs-revision**：
> 靶点对齐准确、Logisim/HF/数据模型/房规均逐行核实无误，但上线前必须补 6 项硬伤。
> **范围**：只迁 KnoHub `type='course'` 课程资料页；忽略 tech/info 模块、Logisim `.circ`、Dashboard 统计/活跃IP、`.doc`→POI 转换。

## 概述

KnoHub 课程资料页 → Aurash `/materials`「资料」页：资源卡片网格 → 详情（左树右预览 split-pane）→ 递归文件夹树 + 增删改 + @dnd-kit 拖拽 reorder + 多文件上传弹窗 + 多格式在线预览（多页 PDF/docx/image/code）+ 最近上传条带。
- 后端 FastAPI + SQLAlchemy（落主库 `labnotes.db`），前端 React18 + shadcn + lucide + `@dnd-kit`（headless 树拖拽）。
- 数据落 `labnotes.db` + `backend/uploads/materials/<sid>/<rid>/`，**HF 备份由现有两条 ARTIFACTS（`db_snapshot` + `uploads dir_tar`）自动覆盖，零改 `scripts/sync/config.py`**。
- KnoHub 视觉（sky/blue/emerald + FontAwesome + 手写 modal）→ 全换 Aurash token（`cat-*`/`tag-*`/`bg`/`border`）+ lucide + shadcn dialog/alert-dialog/context-menu + sonner + font-serif 标题。

## 导航 / 路由 / 后端前缀

- **Header**：`Header.tsx` 第 51 行 `/write` 与 52 行 `/schools` 之间插 `<NavItem to="/materials" label="资料" />`（复用本地 `NavItem`）。
- **路由**：`router.tsx` 加 `MaterialsPage` lazy 声明 + `/write` 后 `/schools` 前插 `{ path:'/materials', element:<PageBoundary><RequireAccess requireAuth><MaterialsPage/></RequireAccess></PageBoundary> }`；新建 `pages/MaterialsPage.tsx` 薄 re-export。
- **后端前缀** `/materials`（顶级，同 `/schools`/`/conferences`）。`main.py` import + `include_router(materials.router)`；`routes/materials.py` 用 `APIRouter(tags=["materials"])`，各 path 自带 `/materials`。

## 数据模型（`backend/app/db/models.py`，落 `labnotes.db`）

两张表，自引用递归树。**关系一律 `lazy="raise"` + `passive_deletes=True` + DB `ondelete=CASCADE`，绝不用 `cascade="all, delete-orphan"`**（与 `models.py` Note/Like 房规一致）。

- `MaterialResource`：`id`(uuid hex PK) · `title` · `description` · `tag`('New'|'Hot'|'Rec' 可空) · `owner_sid`(FK users.sid ondelete=CASCADE, index) · `sort_order` · `deleted`(软删标志) · `created_at`/`updated_at`(onupdate=now)。
- `MaterialFile`（同表存文件与文件夹，`is_folder` 区分）：`id`(uuid PK) · `resource_id`(FK→resource ondelete=CASCADE) · `parent_id`(FK→self ondelete=CASCADE，根级 NULL) · `name` · `is_folder` · `ext`(小写扩展名，驱动图标/预览) · `mime` · `size_bytes` · `url`(绝对 `public_base_url/uploads/materials/<sid>/<rid>/<file>`) · `storage_path`(相对盘路径，物理删/定位用) · `sort_order`(同 parent 作用域 0..n) · `deleted` · `created_at`。
- **重名唯一性**：同 `(resource_id, parent_id)` 作用域内未删 `name` 唯一 → 全走 service 层 `SELECT WHERE deleted=False`（根级显式 `parent_id IS NULL`）；**不加 DB UniqueConstraint**（SQLite 对 NULL parent_id 视为互不相等会漏判根级）。
- **权限**：写 `Depends(get_current_user)` + service 校验 `owner_sid==user.sid`(403)；读 `get_optional_user`（路由层 requireAuth，列表只返 owner 自己的）。
- **建表**：Alembic autogenerate `0006_materials.py`，`down_revision="0005_draft_summary"`（已核实当前 head）；`deploy.sh` 的 `alembic upgrade head` 自动应用。

## REST API（`routes/materials.py`，CamelModel 裸返回，错误 4xx+detail）

资源 CRUD：`GET /materials/resources?q=` · `GET /materials/resources/{rid}` · `POST /materials/resources` · `PATCH /materials/resources/{rid}` · `DELETE /materials/resources/{rid}`(204，级联软删 + 物理 unlink)。
文件树：`GET /materials/resources/{rid}/files`(组好的树) · `POST /materials/resources/{rid}/files?folderId=`(多文件 multipart) · `POST /materials/resources/{rid}/folders` · `PATCH /materials/files/{fileId}/rename`(强制保留扩展名) · `POST /materials/files/reorder`(body `{dragId,dropId,position:'before'|'after'|'inside'}`，204) · `DELETE /materials/files/{fileId}` · `DELETE /materials/folders/{folderId}`(递归) · `GET /materials/files/{fileId}/download`(StreamingResponse + UTF-8 `Content-Disposition`)。

## 存储 + HF 备份

- 布局 `backend/uploads/materials/<sid>/<rid>/<ts>-<rand>.<ext>`（两级桶：sid 外 / rid 内；文件夹只是 DB 行，磁盘平铺）。命名 `int(time.time())-token_hex(4)`（照搬 `uploads.py`，原始名存 DB `name`）。
- **HF 备份零改 config.py**：资料表进 `labnotes.db` → 随 `db_snapshot`；文件进 `backend/uploads/` 子目录 → 随 `uploads dir_tar`。`make data-push/data-pull` 一键覆盖。绝不学 schools/conferences 加独立 `*.sqlite`/`*_PREFIX`（那是只读可重生成参考数据；资料是不可再生 UGC，必须进 `state/` 镜像）。

## 文件树 + 拖拽 reorder

- **库** `@dnd-kit/core@^6.3.1` + `@dnd-kit/sortable@^10.0.0`（MIT, headless；当前无 dnd 库，clean install；不用 pre-1.0 `@dnd-kit/react`）。headless = 每个 DOM 节点自渲染用 lucide + `cat-*` token，100% Aurash 化（优于自带 CSS 的 react-arborist）。
- **前端**（dnd-kit 官方 sortable-tree：flatten/unflatten + depth projection）：`lib/tree.ts` 拍平递归树（折叠子树整段排除）→ `FileTree` 用 `DndContext`+`SortableContext`(verticalListSortingStrategy) → `projectDrop` 用指针 X 缩进 + Y 三分判 before/after/inside（文件夹 y∈(25%,75%)→inside 整行 ring；否则 <50%→before/≥50%→after，按 `depth*16px` 缩进画 0.5px 指示线）→ `onDragEnd` 调 reorder → `invalidateQueries` 重拉。
- **后端 reorder service**（照搬 KnoHub `FileService.reorder` + **环路守卫**，见关键修订 §2）：加载 drag/drop（同 resource）→ 求 newParent+siblings → 移除 drag → 按 position 算 insertIndex → 整段 siblings 重写 `sort_order=0..n` + `dragItem.parent_id=newParent`，一个事务原子完成。
- **右键菜单**：新增 shadcn `ui/context-menu.tsx`（替 KnoHub 手写 CustomEvent 全局互斥）。

## 上传 / 预览（见「跨功能统一」— 与文件上传功能共用基础设施）

- **上传**：新增 `/materials/.../files` 端点（resourceId+folderId 归属，语义不同于 `/notes`），但**底层落盘/校验 util 与前端上传 UI 原语复用共享层**。`UploadDialog`（映射 `UploadModal.vue`）：拖拽/点选多文件 → pendingFiles 网格（改 baseName/移除，扩展名只读后缀）→ 目标文件夹 `Select`（拼父/子路径）→ idle/uploading/success/error 四态 + 进度条。toast 调用放 hook 层而非 Dialog 渲染期（MEMORY：sonner 对 strict-mode+HMR 敏感）。
- **预览**：详情右栏 `PreviewPane`（split-pane 用 `react-resizable-panels`，WritePage 同款）按 `ext` 路由到共享 viewer。资料页特有增强（KnoHub 标志、用户点名「预览很不错」要保留）：**多页 PDF 连续滚动 + 缩放 30-300% + 适宽 + per-file zoom localStorage 缓存（key 用稳定 `fileId`）+ HiDPI outputScale + renderToken 竞态取消 + 三级缓存（ArrayBuffer/zoom/localStorage）+ 500ms 延迟 spinner**；docx 用 docx-preview；图片 Ctrl+滚轮；txt/md/code 用 highlight.js（已装）。pdfjs worker 用 Vite `?url`，cMap 指本地 `pdfjs-dist/cmaps`（中文 PDF 必需，避免 unpkg 外网）。

## 风格对齐（KnoHub → Aurash）

配色全换 token（禁 `sky-*`/`slate-*` 硬编码）；FontAwesome → lucide（Folder/FolderOpen、File/FileText/FileSpreadsheet/FileType/Presentation/FileImage/FileArchive/FileCode、Upload/Download/GripVertical/Chevron/Plus/Pencil/Trash2/Eye/ZoomIn/Out/Loader2…）；标题 font-serif；圆角收敛 `rounded-sm/md/lg` + `shadow-card`；hover 用 `bg-bg-hover` + group-hover 显行内按钮（仿 AdvisorTable）；手写 modal → shadcn dialog/alert-dialog/context-menu（动画用 tailwindcss-animate，勿自写 @keyframes）；Toast → sonner（勿改基线）；滚动条 → `ui/scroll-area`；页面外壳照 `SchoolsPage`（`<main className="w-full px-7 pb-16 pt-7 xl:px-10">` + font-serif h1「资料」）。

## 关键修订（来自对抗式批判 — 上线前必做，verdict=needs-revision）

1. **[线上 404 拦路] nginx allowlist 必须实读 prod 再改**：当前 allowlist 文档版停在 `…|admin|schools)`，但 `/conferences` 是 live → **prod `/etc/nginx` 已被手改含 conferences**。禁止用文档版正则盲覆盖 prod。上线前 `ssh huawei2` 实读 `/etc/nginx/sites-available/aurash` 当前 `location ~` 正则，在其真实基础上追加 `materials`（顺手核实 conferences 在内），`nginx -t && nginx -s reload`（用户执行）。
2. **[正确性] reorder 祖先环路守卫**：KnoHub 原算法**无**此检查，照搬即埋雷。`position='inside'` 或 newParent 非 NULL 时，沿 newParent 的 `parent_id` 链上溯，遇到 `dragId`（含 `dragId==newParent`）即 400「不能把文件夹移动到自身或其子目录下」。否则 parent_id 成环 → 组树无限递归/丢节点。
3. **[安全] `/uploads` 静态硬化**（与文件上传功能协同，做一次）：(a) `ALLOWED_TYPES` 显式不收 `.svg/.html/.htm/.xml`；(b) `/uploads`（至少 doc 类）加 `X-Content-Type-Options: nosniff` + `Content-Disposition: attachment`，由 prod nginx 或后端 StaticFiles 自定义响应实现。否则浏览器 sniff 成 HTML 执行 → 存储型 XSS。
4. **[正确性] 组树端点严禁触碰 `lazy="raise"` 关系**：用一条 flat `SELECT`（resource_id, deleted=False, order_by sort_order）拉全部行 → 纯 Python dict 按 parent_id 组树 → `FileOut` 从手工 dict 构造，**绝不 `from_attributes` 映射 ORM `.children`/`.files`**（否则线上 `MissingGreenlet`/raise）。schema 递归 `model_rebuild()` 仅用于 dict→pydantic。
5. **[正确性] 上传内存/超时防护**：50MB×N 多文件并发 `await file.read()` 一次性进内存有 OOM 风险 → 分块流式落盘，超 `MAX_BYTES` 时**在读满前**用 Content-Length/分块累计提前中断。PR 标注 prod nginx 需 `client_max_body_size>=50M` + `proxy_read_timeout` 调大（大文件慢传防 504）。
6. **[一致性] 与文件上传功能统一预览栈与上限**（见下「跨功能统一」）。

次要 gap（验收覆盖）：dnd-kit 补 KeyboardSensor + `announcements` aria-live + tree role/aria-expanded（迁移补 a11y 好时机）；移动端给 stacked 降级/「建议桌面访问」提示（`/materials` 在全站 Header 可达）；`useQuery` isError 页面级错误态 + 预览 fetch 失败兜底（catch→toast→降级卡，不白屏）；reorder 跨请求并发靠 invalidate 重拉（标注已知限制）；rename 只改 DB name 不 mv 物理文件（uuid 名解耦，实现注释写明）；HF 跨环境 `public_base_url` url 污染（只在目标环境上传，或恢复后校验 url 前缀）。

## 跨功能统一（与「文件上传」`docs/plan-file-upload.md` 的 reconciliation）

两功能共享一套**上传 + 预览基础设施**，避免重复造/bundle 双倍：

- **统一预览栈 = 较强的一套**（pdfjs-dist + docx-preview + @js-preview/excel），因用户明确称「KnoHub 预览很不错」要保留多页/缩放/高保真。全部 lazy-load，首屏零增。
  - 共享 `frontend/src/components/common/preview/` 一组 viewer + ext→kind 路由，**同时**被文件上传的 `FilePreviewDialog`（编辑器附件点击预览）与资料页 `PreviewPane`（split-pane）消费。
  - 这覆盖了文件上传方案里「PDF=iframe / DOCX=mammoth」的初版选型 → 升级为共享 pdfjs/docx-preview（文件上传方案早已把 PdfViewer 抽象为可替换、取数统一 fetch→blob，正好平滑切换）。
- **统一上传后端 util**：`ALLOWED_TYPES` + 魔数嗅探 + 流式落盘 + 拒 svg/html，抽成共享函数；`/notes/files` 与 `/materials/.../files` 两个薄端点各自加归属逻辑后复用。
- **统一上传上限**：文档类 25MB→50MB 统一（资料课件常较大）；HF tar 膨胀靠上限 + 文档化单写者纪律控制。
- **统一 `/uploads` 静态硬化**（nosniff + Content-Disposition + 拒 svg/html）做一次。
- **隔离**：资料的 DB 表 / 落盘子目录 `uploads/materials/` / nginx 前缀 `/materials` 独立，不与笔记/草稿混淆。

## 落地顺序（建议）

0. **共享基础设施先行**：后端上传 util + `/uploads` 硬化；前端 `components/common/preview/` 共享 viewer（pdfjs/docx-preview/excel/image/code）+ 文件图标映射。
1. **文件上传功能**（`docs/plan-file-upload.md`）：`/notes/files` + FileCard + Markdown 接入 + `useAnchorMarks` 修订 + 编辑器拖拽。
2. **资料页**：① 后端表(0006 迁移)→ schema/service/route → main.py；② 后端单测；③(并行)前端 ui/alert-dialog+context-menu+progress + @dnd-kit；④ api 层；⑤ feature 骨架（列表/卡片/RecentUploads/Form/Confirm）；⑥ 详情 + 树 + 拖拽 + 上传弹窗；⑦ 预览（复用共享 viewer + KnoHub 增强）；⑧ 导航接线（放最后）。
3. 文档/nginx：`docs/plan-schools-integration.md §3.7` allowlist 补 `materials`(+conferences)；**prod nginx 改动实读后由用户在 huawei2 执行**。
4. 验证：后端 pytest → 前端 tsc/lint/build → 本地端到端 → HF round-trip → playwright 截图实测 → 用户跑 deploy.sh + 改 nginx。

## 验证清单（节选）

- 后端 pytest `test_materials.py`：CRUD、建夹同名 409、上传落盘+url、rename 保留扩展名、reorder before/after/inside（验 sort_order+parent_id 重写）、**环路守卫 400**、级联软删+物理 unlink、根级重名、非 owner 403、未登录 401
- Alembic up/down round-trip（0006，down_revision=0005_draft_summary）；CamelModel 输出 camelCase；zod `material.test.ts` 递归 `z.lazy` parse
- `pnpm tsc && lint && build`：@dnd-kit/pdfjs/docx-preview/Radix 打包通过；grep 无 FontAwesome / `sky-*`/`slate-*`
- 本地端到端：建资源→上传(根+文件夹)→建夹→拖拽 reorder 三区→重命名→预览(pdf 多页缩放/docx/图片)→删除(确认)→删资源；每步验 DB 行 + 物理文件
- 权限：A 建卡 B 操作 403；未登录写 401
- HF round-trip：上传→`make data-push`(db_snapshot+uploads dir_tar 两 artifact)→另机 `data-pull`→GET 返回含树 + 预览 url 不 404 + reorder 顺序恢复；不碰 config.py
- nginx：实读 prod 正则加 materials → `curl https://winbeau.top/materials/resources` 带 token 返 200/401 而非 404；大 pdf 上传不 413
- playwright（MEMORY 强制）：列表网格/最近上传/详情 split-pane/树展开+拖拽指示线+inside ring/右键菜单/上传四态/各预览 viewer+缩放，截图比对 Aurash 风格（token/lucide/font-serif/无 sky-* 残留）
- prod：用户自己跑 `./deploy.sh` + 改 nginx；我只改代码+commit+push，跑完只读验证+playwright

## 开放决策

| 决策 | 推荐 |
|---|---|
| 资料是**共享知识库**（全员可见/贡献）还是**个人私有 UGC**？ | KnoHub 原意是共享知识库；但 WF2 默认私有。**需用户拍板**（决定 owner_sid 过滤与权限模型）。 |
| 拖拽 reorder + 最近上传是否首版纳入？ | **纳入**（用户点名「拖拽管理很不错」，是 KnoHub 标志交互）。 |
| `.doc`(旧版) 在线预览？ | **否**，走「不支持+下载」兜底（POI/LibreOffice 重依赖性价比低）。初版仅 `.docx`。 |
| 软删 vs 硬删？ | **简化软删**（deleted 标志，可恢复/审计；物理文件 DELETE 时即 unlink 防孤儿）。 |
| 预览栈与上传上限是否与文件上传功能统一？ | **统一**（pdfjs+docx-preview+excel 共享、50MB），见「跨功能统一」。 |
