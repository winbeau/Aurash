# schools 页接入真数据：胶水层 + 前端切换

> **写给新对话的 Claude**：本文档是 schools 业务域接入计划。当前 `frontend/src/features/schools/data.ts` 是手写 mock；本轮把它换成从 supervisor-claw 导出的真数据。
>
> **架构定型**：三层。Aurash 前端 → Aurash 后端胶水层 → 文件（claw 导出的 SQLite 快照）。**不走 HTTP** 直连 claw——claw 是离线工具，README 里有"禁止公开部署到外网"红线。
>
> **数据契约**：supervisor-claw v0.4 产出 `exports/{manifest.json, schools.sqlite}`，schema 定义在 claw repo 的 `docs/EXPORT_SCHEMA_v1.md`。本计划假设该契约稳定。
>
> **规模假设**：20+ 学校 × 200+ 导师 ≈ 4000+ advisor，含嵌套 quotas/evaluations/trace。所有过滤/排序/搜索走 SQL，不在 Python 层重新实现。

---

## 1. 架构

```
┌─────────────────────────────────────────────────────┐
│ Aurash 前端 (features/schools/*)                    │
│  - 调 api/endpoints/schools.ts                      │
│  - 不知道 claw 存在，不关心文件                       │
└─────────────────────────────────────────────────────┘
                    ↓ /schools/list, /schools/{id}
┌─────────────────────────────────────────────────────┐
│ Aurash 后端胶水层                                    │
│  ┌─────────────────────────────────────────────┐   │
│  │ db/schools_engine.py                         │   │
│  │  - 独立 read-only AsyncEngine                │   │
│  │    指向 data/schools/schools.sqlite          │   │
│  │  - mtime 监控，文件变更时换引擎              │   │
│  └─────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────┐   │
│  │ services/schools_query.py                    │   │
│  │  - SQL 过滤/排序/分页/FTS                    │   │
│  │  - 返回 advisor_id 列表 + 必要字段           │   │
│  └─────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────┐   │
│  │ services/schools_overlay.py                  │   │
│  │  - 第二查询：Aurash 主 DB 取 UGC            │   │
│  │    (note_count, is_starred)                  │   │
│  │  - Python 层 merge                           │   │
│  └─────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────┐   │
│  │ routes/schools.py                            │   │
│  │  - GET /schools/list?school=&dept=&...       │   │
│  │  - GET /schools/{id}                         │   │
│  │  - POST /admin/schools/reload                │   │
│  └─────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
                    ↑ 文件 (read-only attach)
┌─────────────────────────────────────────────────────┐
│ Aurash backend/data/schools/  ← 文件交换点          │
│  ├── manifest.json                                  │
│  └── schools.sqlite                                 │
└─────────────────────────────────────────────────────┘
                    ↑ rsync / HF Dataset / scp
┌─────────────────────────────────────────────────────┐
│ supervisor-claw (用户本地)                          │
│  $ uv run claw export --format sqlite --out exports/│
└─────────────────────────────────────────────────────┘
```

**为什么用 SQLite 快照而非自己建表 / 内存加载**：

- **规模**：20+ 校 × 200+ 人 + 嵌套 = 几万行级别，纯内存线性扫不合适
- **现成索引 + FTS5**：q 搜、dept/title 多选、recruit/rep 过滤全走 SQL，无需在 Python 重写
- **mmap 懒加载**：常驻内存几 MB，不随数据量增长
- **零 migration**：schema 定义在 claw 那边，Aurash 侧仅读，避免双向同步成本
- **UGC 拼接**：Aurash 主 DB 的 note/star 单独查，按 advisor_id 在 Python 层 merge——这点比单 DB 全 JOIN 多一次查询，但代价小（page_size=50 行的 IN 查询）

---

## 2. 前端契约（已存在，按现状对齐）

前端 `Advisor` shape 定义在 `frontend/src/features/schools/types.ts`，全 snake_case。本计划**不动**前端类型——后端反过来适配。

**约定**：schools 域走 snake_case wire（与现有 notes 域的 camelCase 不同）。理由：
- claw 导出原文就是 snake_case
- 前端 types.ts 已经全 snake_case，零改动
- 新增 `schemas/_base.py::SnakeModel` 替代 CamelModel 用于 schools 路由

> 这是本计划唯一打破"全站 camelCase"的地方。如果坚持统一 camelCase，前端 types.ts 整体重命名 + AdvisorTable/Drawer 全跟着改，工作量 vs 收益不划算。

---

## 3. 后端胶水层

### 3.1 文件加载点

新目录 `backend/data/schools/`（git ignore）。运维路径见 §6。

文件不存在时：`/schools/*` 返回空 + 503 + manifest 状态，前端展示"数据未就绪"提示，不阻塞 Aurash 其它功能。

### 3.2 独立只读引擎

新文件 `app/db/schools_engine.py`：

```python
from sqlalchemy.ext.asyncio import create_async_engine, AsyncEngine
from sqlalchemy import event

class SchoolsEngineHolder:
    """单例：持有一个只读 AsyncEngine 指向 schools.sqlite。
    文件 mtime 变化时换新引擎，旧引擎 dispose。"""

    def __init__(self, db_path: Path):
        self._path = db_path
        self._engine: AsyncEngine | None = None
        self._mtime: float = 0
        self._manifest: dict | None = None

    async def get(self) -> AsyncEngine:
        await self._maybe_reload()
        if self._engine is None:
            raise SchoolsDataMissing()
        return self._engine

    async def _maybe_reload(self) -> None:
        if not self._path.exists():
            return
        mt = self._path.stat().st_mtime
        if mt == self._mtime and self._engine is not None:
            return
        old = self._engine
        self._engine = self._build_engine()
        self._mtime = mt
        self._manifest = self._load_manifest()
        if old is not None:
            await old.dispose()

    def _build_engine(self) -> AsyncEngine:
        # mode=ro: 内核级只读保护；immutable=1 关闭 WAL 兼容性检查，下游不会写 -wal/-shm
        url = f"sqlite+aiosqlite:///file:{self._path}?mode=ro&immutable=1&uri=true"
        eng = create_async_engine(url, connect_args={"uri": True})

        # 防御性：连接层再加 query_only，万一 ORM 误发 INSERT 也会 RAISE
        @event.listens_for(eng.sync_engine, "connect")
        def _ro(dbapi_conn, _rec):
            dbapi_conn.execute("PRAGMA query_only = ON")
        return eng

_holder: SchoolsEngineHolder | None = None
def get_schools_engine_holder() -> SchoolsEngineHolder: ...
```

启动加载放 `app/main.py::lifespan`（与 `_author_sync_loop` 同位置），失败不阻塞 boot（schools 数据缺失只让 `/schools/*` 返回 503）。

### 3.3 数据模型

新文件 `app/schemas/school.py`（与前端 `types.ts` 字段对齐）：

```python
from typing import Literal
from app.schemas._base import SnakeModel, UtcDateTime

Reputation = Literal["positive", "neutral", "negative", "unknown"]
Degree = Literal["PhD", "MS", "Postdoc"]

class SchoolRef(SnakeModel):
    code: str
    name_cn: str

class DeptRef(SnakeModel):
    code: str
    name_cn: str

class QuotaOut(SnakeModel):
    year: int | None
    degree: Degree | None
    count: int | None
    confidence: float | None
    raw_text: str
    source_url: str | None

class EvaluationOut(SnakeModel):
    source: str
    source_url: str | None
    content: str
    rating: float | None
    posted_at: UtcDateTime | None

class TraceOut(SnakeModel):
    kind: str
    label: str
    detail: str

class AdvisorRow(SnakeModel):
    """表格行：瘦版，无 quotas/evaluations/trace。"""
    id: int
    school: SchoolRef
    departments: list[DeptRef]
    name_cn: str
    title: str | None
    homepage: str
    source_url: str
    email: str | None
    email_obfuscated: bool
    research_interests: list[str]
    is_recruiting: bool | None
    recruiting_confidence: float | None
    reputation_tag: Reputation | None
    enriched_summary: str | None
    last_enriched_at: UtcDateTime | None
    note_count: int = 0      # UGC overlay
    is_starred: bool = False

class AdvisorDetail(AdvisorRow):
    """详情：含全部嵌套。"""
    name_en: str | None
    phone: str | None
    photo_url: str | None
    bio_text: str | None
    quotas: list[QuotaOut]
    evaluations: list[EvaluationOut]
    trace: list[TraceOut]
```

### 3.4 查询层

`app/services/schools_query.py`：纯 SQL，不读内存对象。

**列表查询**（瘦版，给表格）：

```sql
-- 过滤维度全走 WHERE / JOIN / FTS
WITH filtered AS (
    SELECT a.id
    FROM advisor a
    LEFT JOIN appointment ap ON ap.advisor_id = a.id
    WHERE
        (:school_codes IS NULL OR a.school_code IN (:school_codes))
        AND (:dept_codes IS NULL OR ap.dept_code IN (:dept_codes))
        AND (:titles    IS NULL OR a.title      IN (:titles))
        AND (:recruit   IS NULL OR a.is_recruiting IS :recruit_value)
        AND (:rep       IS NULL OR a.reputation_tag IN (:rep))
        AND (NOT :has_email    OR a.email IS NOT NULL)
        AND (NOT :has_summary  OR a.enriched_summary IS NOT NULL)
        AND (:q IS NULL OR a.id IN (
            SELECT rowid FROM advisor_fts WHERE advisor_fts MATCH :q
        ))
    GROUP BY a.id
)
SELECT a.*, s.name_cn AS school_name_cn
FROM filtered f
JOIN advisor a ON a.id = f.id
JOIN school s  ON s.code = a.school_code
ORDER BY <按 sort_key>
LIMIT :limit OFFSET :offset;
```

`departments` 字段通过第二查询批量取（`SELECT advisor_id, dept_code, name_cn FROM appointment ... WHERE advisor_id IN (:ids)`），在 Python 层聚合到每条 row。这比 SQLite 端 group_concat + 解析便宜。

`research_interests` 是 JSON string，在 Python 层 `json.loads()` 反序列化。

**详情查询**：单次 SELECT advisor + 三次 SELECT 关联表（quota / evaluation / trace），都按 advisor_id 索引。

### 3.5 UGC overlay

`app/services/schools_overlay.py`：

```python
async def overlay_ugc(
    main_db: AsyncSession, user: User | None, rows: list[AdvisorRow]
) -> list[AdvisorRow]:
    """填充 note_count / is_starred。"""
    if not rows:
        return rows
    ids = [r.id for r in rows]
    # SELECT advisor_ref, COUNT(*) FROM note WHERE advisor_ref IN (...) GROUP BY ...
    # SELECT advisor_ref FROM advisor_star WHERE user_id = ? AND advisor_ref IN (...)
    # 二查询，python 字典 merge
    ...
```

**注**：`note.advisor_ref` / `advisor_star` 这两张关联表是**未来扩展点**。本轮**不建**——先返回 `note_count=0, is_starred=False` 占位，前端按现状不依赖它们。等 schools 页跑顺再加。

### 3.6 路由

`app/routes/schools.py`：

```python
@router.get("/schools/list", response_model=PaginatedAdvisors)
async def list_advisors(
    school: list[str] = Query(default=[]),
    dept: list[str] = Query(default=[]),
    title: list[str] = Query(default=[]),
    recruit: list[str] = Query(default=[]),
    rep: list[str] = Query(default=[]),
    q: str | None = None,
    has_email: bool = True,
    has_summary: bool = False,
    sort_key: str = "default",
    sort_dir: str = "desc",
    page: int = 1, page_size: int = 50,
    holder: SchoolsEngineHolder = Depends(get_schools_engine_holder),
    main_db: AsyncSession = Depends(get_db),
    user: User | None = Depends(get_optional_user),
) -> PaginatedAdvisors:
    eng = await holder.get()
    async with AsyncSession(eng) as s:
        rows, total = await query_advisor_rows(s, filters=..., page=...)
    rows = await overlay_ugc(main_db, user, rows)
    return PaginatedAdvisors(items=rows, total=total, page=page)

@router.get("/schools/{advisor_id}", response_model=AdvisorDetail)
async def get_advisor(advisor_id: int, ...):
    eng = await holder.get()
    async with AsyncSession(eng) as s:
        detail = await query_advisor_detail(s, advisor_id)
    if detail is None:
        raise HTTPException(404)
    return detail

@router.post("/admin/schools/reload")  # admin-gated, sid match like /admin/*
async def reload(holder: SchoolsEngineHolder = Depends(...)):
    await holder._maybe_reload()  # 强触发，绕过 mtime
    return {"ok": True, "manifest": holder._manifest}
```

详情接口返回**完整** `AdvisorDetail`（含 quotas/evaluations/trace），列表只返回 `AdvisorRow`。前端抽屉打开时再拉详情，省 payload。

### 3.7 nginx

需要新顶级 prefix `/schools`。改 huawei2 上 `/etc/nginx/sites-available/aurash`：

```nginx
location ~ ^/(auth|notes|drafts|interactions|ai|health|uploads|admin|schools)(/|$) {
    proxy_pass http://127.0.0.1:8001;
    ...
}
```

`docs/plan-next-round.md §nginx 路由` 里有过同款坑，这次别忘了 sudo reload。

---

## 4. 前端切换

### 4.1 zod schema

新文件 `frontend/src/api/schemas/school.ts`：复刻 `features/schools/types.ts` 为 zod。types.ts 不动；schema 单独写：

```ts
export const SchoolRefSchema = z.object({ code: z.string(), name_cn: z.string() })
export const AdvisorRowSchema = z.object({
  id: z.number(),
  school: SchoolRefSchema,
  // ...
  note_count: z.number().default(0),
  is_starred: z.boolean().default(false),
})
export const AdvisorDetailSchema = AdvisorRowSchema.extend({
  quotas: z.array(QuotaSchema),
  evaluations: z.array(EvaluationSchema),
  trace: z.array(TraceSchema),
})
```

### 4.2 endpoints

新文件 `frontend/src/api/endpoints/schools.ts`：

```ts
export async function listAdvisors(params: ListAdvisorsParams) {
  return request({
    method: 'GET',
    path: '/schools/list',
    query: paramsToQuery(params),
    schema: PaginatedAdvisorsSchema,
  })
}

export async function getAdvisor(id: number) {
  return request({
    method: 'GET',
    path: `/schools/${id}`,
    schema: AdvisorDetailSchema,
  })
}
```

### 4.3 dev mock

`frontend/src/api/mock/` 目前的 mock dispatch 已经支持 `registerMock`。把现有 `features/schools/data.ts::ADVISORS` 包成 mock handler，dev 模式无 `VITE_API_BASE` 时仍走 mock，跑后端时切真接口——**零业务代码改动**。

### 4.4 页面接入

`features/schools/SchoolsPage.tsx`：

- 删 `import { ADVISORS } from './data'`
- 改 `const { data } = useSWR(['schools', filters], () => listAdvisors(...))`
- 抽屉打开时 `getAdvisor(id)` 拉详情合并

`data.ts` 里的 `SCHOOLS / SCHOOL_GROUPS / schoolDepts` 这些纯前端静态映射保留，跟数据无关。

---

## 5. Tasks

| # | 任务 | 改动 |
|---|---|---|
| T1 | `app/schemas/_base.py::SnakeModel` | 加一个 base class，alias_generator 仅做 identity |
| T2 | `app/schemas/school.py` | 新文件 |
| T3 | `app/db/schools_engine.py` 只读引擎 + mtime poll | 新文件 |
| T4 | `app/services/schools_query.py` SQL 过滤/排序/分页/FTS | 新文件 |
| T5 | `app/services/schools_overlay.py` UGC 占位 | 新文件，先 hardcode 0 / False |
| T6 | `app/routes/schools.py` 三接口 | 新文件 |
| T7 | `app/main.py` lifespan 启动加载 + admin reload 注册 | 改 |
| T8 | `app/settings.py` 加 `schools_data_dir` 配置 | 改 |
| T9 | `frontend/src/api/schemas/school.ts` zod | 新文件 |
| T10 | `frontend/src/api/endpoints/schools.ts` | 新文件 |
| T11 | `frontend/src/api/mock/schools.ts` 把 ADVISORS 包成 mock | 新文件 |
| T12 | `SchoolsPage` 切真 API | 改 |
| T13 | nginx 加 `schools` 到 location 正则 | huawei2 上 sudo |
| T14 | 后端测试：用一份固定 schools.sqlite fixture，跑全套 filter/sort/FTS | 新 |
| T15 | 前端测试：endpoints zod parse smoke + page render | 新 |

---

## 6. 部署与数据分发

### 6.1 文件位置

- VPS / 本地开发：`Aurash/backend/data/schools/` （git ignored）
- huawei2 生产：`/home/winbeau/Aurash/backend/data/schools/`

### 6.2 推送通道

复用现有 `make sync-push` 套路（已经在跑 HF Dataset 同步 DB + 密钥）。加一对 target：

```Makefile
schools-push:  # 用户本地：把 claw 导出推到 HF Dataset
	cd ../claude-tools/supervisor-claw && uv run claw export --format sqlite --out ./exports
	huggingface-cli upload <repo> ../claude-tools/supervisor-claw/exports schools/

schools-pull:  # huawei2：拉到 backend/data/schools/
	huggingface-cli download <repo> --include "schools/*" --local-dir backend/data
	curl -X POST http://127.0.0.1:8001/admin/schools/reload -H "Authorization: Bearer $$ADMIN_TOKEN"
```

### 6.3 节奏

- claw 富化每月跑 1-2 次（导师招生信息变化慢）
- 跑完用户本地 `make schools-push`
- huawei2 `make schools-pull` （手动 / cron 都行）
- reload 走 admin 接口换引擎，不需要重启 uvicorn

### 6.4 文件替换的并发安全

mtime 监控 + 引擎切换的微妙点：rsync / hf download 落地时是**先写临时文件再 rename**（atomic on POSIX），不会让 SQLite 读到半截文件。`schools-pull` 推荐用 `--temp-dir` + `mv` 二步，避免读到 partial bytes。

---

## 7. 不在本轮范围

- `note.advisor_ref` / `advisor_star` 关联表：先占位返回 0，等 schools 页跑起来再加 UGC
- 增量更新：claw v0.4 全量导出，4000 行/月重建够便宜
- 自定义评价撰写（用户给导师写笔记 → 反向回 claw）：明确不做，违反 claw"个人参考"使用条款
- 学校页公开访问：当前需登录拉数据（与 notes 一致），管 schools 数据合规边界
- claw 内部 schema 升级 → 双向 schema diff 工具：等出现 v2 再说
