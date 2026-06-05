# 題庫 Rubric 結構化（C 順位優化）

**Date**: 2026-06-03
**Status**: Spec draft, pending user review
**Scope**: Backend schema + evaluation prompt + import-blog-questions skill

## 背景與動機

目前評分機制 (`backend/app/services/evaluation.py`) 把整段 free-form Markdown `reference_answer` 餵給 LLM，要求它自行從文章中解析出「該講什麼」並對照應試者回答。三個 provider（OpenAI / Claude / Gemini）共用一套 prompt，沒有結構化的「核心知識點清單」，導致：

- 評分標準在不同 provider、不同回答之間漂移。
- `missing_points` 容易誤判：LLM 不一定能從 Markdown 中精準辨認哪些是「該必提的核心」、哪些是「補充說明」。
- `reference_answer` 更新後沒有版本控制，歷史 attempts 的評分基準與當下 reference 不同。
- 題目沒有「常見誤區」清單，LLM 無法主動偵測應試者落入經典錯誤觀念。
- `difficulty` 沒進 prompt，easy 與 hard 題用同一套嚴格度評分。

本次優化（在 brainstorming 中經 Q1–Q5 收斂）排序為三條軸（A / B / C）中的 **C：題庫結構化**。理由是 C 是 A、B 的地基；不做 C，prompt 怎麼調都只能讓 LLM 從 free-form text 推測評分維度。

## 目標

1. 為 `Question` 加上結構化評分欄位 (`key_points`, `common_mistakes`)。
2. 重寫 evaluation prompt，把 rubric 直接餵給 LLM，並按 `difficulty` 校準分數帶。
3. 既有 10 題透過 LLM 萃取 + 人工 review 完成 backfill。
4. 同步更新 `.claude/skills/import-blog-questions/SKILL.md`，讓新題從一開始就帶結構化 rubric。
5. 完全不動 API contract 與前端。

## Out of Scope（明確列出）

下列項目這次不做：

- **A 順位**：評分機制本身的 few-shot worked examples、provider 一致性檢驗、重試 / fallback。
- **B 順位**：反饋品質微調。
- 題目層級的 `scoring_weights` / `expected_duration_sec` / `follow_up_questions`。
- `category` / `tags` enum 化。
- `reference_answer` 版本控制。
- 任何 API contract 變動、前端 UI 變動。

---

## 設計

### 1. 資料庫 Schema 變更

`questions` 表新增兩個欄位：

```python
# backend/app/models/question.py
class Question(Base):
    # ... 既有欄位不動 ...
    key_points: Mapped[list[dict]] = mapped_column(
        JSONB, nullable=False, server_default=text("'[]'::jsonb")
    )
    common_mistakes: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False, server_default=text("'{}'::text[]")
    )
```

`key_points` JSONB 結構（程式層用 Pydantic 驗證，DB 不加 CHECK）：

```python
class KeyPoint(BaseModel):
    point: str
    tier: Literal["core", "bonus"]
```

**設計取捨**：

| 點 | 選擇 | 理由 |
|----|------|------|
| `nullable=False` + server_default 空集合 | 不允許 NULL | evaluation prompt 不必寫 fallback 邏輯；強制每題都有 rubric |
| JSONB vs 分表 (`question_rubrics`) | JSONB | 題庫量小（<100 題可預見），分表過度設計 |
| `tier` 用 `Literal["core","bonus"]` | Pydantic 驗證 | DB 不加 CHECK，保留 schema 演進彈性 |
| `common_mistakes` 用 `TEXT[]` | 跟現有 `tags` 一致 | 不需要結構化 |

### 2. Alembic Migration

新檔 `backend/alembic/versions/<timestamp>_add_key_points_and_common_mistakes_to_questions.py`：

```python
def upgrade() -> None:
    op.add_column(
        "questions",
        sa.Column(
            "key_points",
            postgresql.JSONB,
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )
    op.add_column(
        "questions",
        sa.Column(
            "common_mistakes",
            postgresql.ARRAY(sa.Text),
            nullable=False,
            server_default=sa.text("'{}'::text[]"),
        ),
    )

def downgrade() -> None:
    op.drop_column("questions", "common_mistakes")
    op.drop_column("questions", "key_points")
```

**為什麼用 server_default**：讓 migration 對既有 10 列直接灌空集合，不需要兩段式（add nullable → backfill → set NOT NULL）。

### 3. seed_questions.py 樣板

每筆 entry 新增兩個欄位：

```python
{
    "id": uuid.uuid4(),
    "notion_id": "...",
    "text": "...",
    "category": "algorithms",
    "difficulty": "medium",
    "tags": ["..."],
    "reference_answer": """...完整 markdown，作為 ideal_answer 來源...""",

    # === 新增 ===
    "key_points": [
        {"point": "Big O 描述演算法執行時間隨 n 的成長趨勢", "tier": "core"},
        {"point": "O(1)：dict 取值、Redis 讀取", "tier": "core"},
        {"point": "O(log n)：二分搜尋、B-tree 索引", "tier": "core"},
        {"point": "O(n log n)：Timsort 等高效排序的下限", "tier": "core"},
        {"point": "O(n^2) 風險：巢狀迴圈未用索引", "tier": "core"},
        {"point": "用 hash table 把 O(n^2) 比對降為 O(n)", "tier": "bonus"},
        {"point": "遞迴可能引發 O(2^n)，需 memoization", "tier": "bonus"},
    ],
    "common_mistakes": [
        "混淆「時間複雜度」與「實際執行時間（毫秒數）」",
        "認為 O(log n) 一定比 O(n) 快 ── 在 n 小時不一定",
        "忽略最壞情況，只給平均情況的複雜度",
    ],
},
```

`on_conflict_do_update` 的 `set_` 中同步加入兩欄。

**數量參考**：core 4-8 個、bonus 2-4 個、common_mistakes 2-5 個。

### 4. Backfill workflow（既有 10 題）

#### 流程

```
seed_questions.py (現況)
       │
       ▼  python scripts/backfill_question_rubric.py
[Claude Haiku 4.5 萃取 key_points + common_mistakes]
       │
       ▼
seed_questions.py.draft (完整新檔，可 diff)
       │
       ▼  git diff --no-index seed_questions.py seed_questions.py.draft
[使用者 review，編輯 .draft 修正錯誤]
       │
       ▼  mv seed_questions.py.draft seed_questions.py
[apply → commit → 跑 seed → 驗證]
```

**核心原則**：script 永不直接覆蓋 `seed_questions.py`，只產生 `.draft`，靠 `git diff` review。

#### Script (`backend/scripts/backfill_question_rubric.py`) 設計重點

- 在**本機**執行（不需要 docker / DB；只需 `ANTHROPIC_API_KEY`）。
- 透過 Claude `tools` + `tool_choice` 強制結構化輸出（沿用 `evaluation.py` 既有模式）。
- 每題一個 API call，避免批次混淆。
- Idempotent：若該題 `key_points` 已非空，跳過。
- 失敗繼續：單題失敗印 warning，不中斷整批。
- 輸出 `.draft` 維持與原檔一致的縮排格式，diff 乾淨。
- `seed_questions.py.draft` 加入 `.gitignore`。

#### 萃取 prompt（概要）

```
題目：{text}
難度：{difficulty}
參考答案：{reference_answer}

請輸出 JSON（繁體中文）：
- key_points: 4-12 項，{point: str, tier: "core" | "bonus"}
  - core 4-8 個（缺一即明顯扣分的主幹概念）
  - bonus 2-4 個（深度、工程取捨、具體例子）
- common_mistakes: 2-5 項，描述「應試者會犯什麼錯」（非「該怎麼做」）

每項 1-2 句、具體、可作為打勾陳述。不要重複 reference_answer 整段。
```

### 5. Evaluation prompt 重做

新 `SYSTEM_PROMPT_TEMPLATE`（位於 `backend/app/services/evaluation.py`）：

```
你是一位嚴格的資深後端工程師面試官，正在評估應試者的技術回答。請全程使用繁體中文。

題目：{question}
難度：{difficulty}

核心評分要點（缺一項即明顯扣分，core）：
{core_points_block}

加分要點（提到能往 85+ 推，bonus）：
{bonus_points_block}

常見誤區（應試者若落入應於 missing_points 指出，並作為扣分依據）：
{common_mistakes_block}

完整參考答案（產 ideal_answer 時參考，不要逐項對照評分）：
{reference_answer}

應試者回答：{transcript}

請嚴格評估並只回傳一個 JSON 物件，所有自然語言文字使用繁體中文。
JSON 必須包含：score / summary / missing_points / next_focus / ideal_answer / provider / model。

評估流程（在心中完成，不輸出）：
1. 逐項對照「核心評分要點」與「加分要點」，標記應試者是否提及（同義或合理等價表達視為提及）。
2. 已明確提及的內容不得列入 missing_points。
3. 檢查應試者是否落入「常見誤區」；若有，列入 missing_points 並具體指出誤區內容。
4. summary 必須同時反映「已答對的重點」與「真正需要補強的地方」，避免套版批評。
5. ideal_answer 提供一份比參考答案更適合學習的完整回答；不得聲稱應試者沒提到他其實已提到的內容。

評分校準（綁定 key_points 覆蓋率）：
- 90-100：涵蓋所有 core + 多數 bonus + 具體例子 / 工程取捨
- 80-89：涵蓋所有 core + 部分 bonus，或 core 全到位但深度略不足
- 70-79：缺 1 個 core，或所有 core 都提及但極度淺薄
- 60-69：缺 2+ 個 core，或落入 1 個以上常見誤區
- 60 以下：偏題 / 嚴重錯誤 / 多數 core 未提及

難度校準（覆蓋上面校準）：
- easy：core 全到位即可給 85+，不強求 bonus
- medium：core 全到位 + 至少 1 個 bonus 才給 85+
- hard：core 全到位 + 多數 bonus + 明確工程取捨 才給 85+

evidence-aligned 規則（保留）：
- 若應試者已提供兩個以上具體例子，不得泛稱缺少具體範例；只能指出哪些例子不夠精準。
- missing_points 每一點都要能從應試者回答中找到證據（未提及 / 錯誤 / 說明不足）。
```

### 6. `EvaluationProvider` 程式碼變動

```python
class EvaluationProvider(ABC):
    @abstractmethod
    async def evaluate(
        self,
        question: str,
        reference_answer: str,
        transcript: str,
        *,
        difficulty: str,
        key_points: list[dict],          # [{point, tier}]
        common_mistakes: list[str],
    ) -> EvaluationResult: ...

    def _build_prompt(
        self,
        question: str,
        reference_answer: str,
        transcript: str,
        *,
        difficulty: str,
        key_points: list[dict],
        common_mistakes: list[str],
    ) -> str:
        core = [kp["point"] for kp in key_points if kp["tier"] == "core"]
        bonus = [kp["point"] for kp in key_points if kp["tier"] == "bonus"]

        def _bulleted(items: list[str], fallback: str) -> str:
            if not items:
                return f"- （{fallback}）"
            return "\n".join(f"- {item}" for item in items)

        return SYSTEM_PROMPT_TEMPLATE.format(
            question=question,
            difficulty=difficulty,
            core_points_block=_bulleted(core, "本題未提供核心要點"),
            bonus_points_block=_bulleted(bonus, "本題未提供加分要點"),
            common_mistakes_block=_bulleted(common_mistakes, "本題未提供常見誤區"),
            reference_answer=reference_answer,
            transcript=transcript,
        )
```

三個 provider（OpenAI / Claude / Gemini）的 `evaluate()` 簽章一起改成 keyword-only 新參數。

`backend/app/routers/attempts.py::_run_evaluation`：

```python
evaluation = await provider.evaluate(
    question=question.text,
    reference_answer=question.reference_answer,
    transcript=transcript,
    difficulty=question.difficulty,
    key_points=question.key_points,
    common_mistakes=question.common_mistakes,
)
```

`EvaluationResult` schema、Claude tool definition、API contract **完全不變** → 前端、`/attempts/{id}/result`、`/attempts/{id}/summary` 完全不受影響。

**Offline mode**：`_offline_result` logic 不動，docstring 補一句「離線模式不參考 key_points / common_mistakes」。

### 7. import-blog-questions Skill 更新

`.claude/skills/import-blog-questions/SKILL.md` 變動：

**Section 3「Add question entry」**：entry 樣板補上 `key_points` 與 `common_mistakes`。

**Section 4 重新命名為「Extract key_points, common_mistakes, and write reference_answer」**：

```markdown
### 4. 從文章萃取三組內容

#### 4a. key_points（核心評分要點）
從文章主要 H2/H3 段落、表格與決策準則中萃取，每項 1-2 句、可作為「評分能否打勾」的具體陳述。

- 標 `core`：缺一個就明顯扣分（題目的「主幹」概念）
- 標 `bonus`：提到能往 85+ 推（深度、工程取捨、具體例子）

數量參考：core 4-8 個、bonus 2-4 個。

#### 4b. common_mistakes（常見誤區）
從文章「注意事項 / 常見錯誤 / 反例」段落，或對照部落格上的反模式段落擷取。每項描述「應試者會犯什麼錯」而非「該怎麼做」。

數量參考：2-5 個。

#### 4c. reference_answer
仍寫成 150-300 字的 markdown，但角色改變：**不再是 LLM 評分的依據，而是產生 ideal_answer 的素材**。可比 key_points 更敘述化、有 code snippet。

注意：reference_answer 與 key_points 不要互相重複；reference 用「為什麼 / 怎麼用」敘事，key_points 用「該講什麼」清單。
```

**Common Mistakes 表新增列**：

| Mistake | Fix |
|---|---|
| 把 reference_answer 整段抄成 key_points | key_points 是清單條目，不是段落；每條獨立可被打勾 |
| 全部 key_points 都標 core | 沒有 bonus 會讓 90+ 分無法達成；要區分「主幹」與「深度加分」 |
| common_mistakes 寫成「應該怎麼做」 | 應描述「應試者會犯什麼錯」，例如「混淆 A 與 B」「以為 X 一定比 Y 快」 |

### 8. 部署順序

單一 PR 內容（綁定 schema、backfilled seed、新 prompt、測試、skill）：

```
backend/
├── alembic/versions/<ts>_add_key_points_and_common_mistakes_to_questions.py  [新增]
├── app/
│   ├── models/question.py                                                    [改]
│   ├── routers/attempts.py                                                   [改]
│   └── services/evaluation.py                                                [改]
├── scripts/
│   ├── seed_questions.py                                                    [改]（10 題已 backfill）
│   └── backfill_question_rubric.py                                          [新增]
└── tests/
    └── test_evaluation_prompt.py                                            [改 + 新增]

.claude/skills/import-blog-questions/SKILL.md                                [改]
.gitignore                                                                   [改]（加 seed_questions.py.draft）
docs/superpowers/specs/2026-06-03-question-rubric-structuring-design.md      [新增，本檔]
```

本機 review 流程（PR 開出之前）：

```
1. 改 schema + model
2. alembic 產生 migration
3. 本機跑 backfill_question_rubric.py → 產生 .draft
4. git diff review .draft → 編輯修正
5. mv .draft → seed_questions.py
6. 改 evaluation.py + attempts.py
7. 更新 / 新增測試
8. make test-env-up && make test 全綠
9. 更新 SKILL.md
10. commit
```

部署（test 環境 / production）：

```
1. alembic upgrade head（加新欄位，既有 row 拿到空集合）
2. docker cp + 跑 seed_questions.py（upsert 進 key_points + common_mistakes）
3. 重啟 backend（載入新 evaluation 邏輯）
```

### 9. Backwards compat

| 情境 | 風險 | 緩解 |
|------|------|------|
| 新 schema + 舊評分程式 | 短暫存在於部署過程 | 舊程式不讀新欄位，無影響 |
| 新評分程式 + 舊資料（key_points = []） | 評分結果可能不佳 | `_build_prompt` fallback「（本題未提供核心要點）」；正常流程不會發生（PR 已含 backfill seed）|
| 透過 API 建立題目但未補 rubric | 目前不存在此 API | 題目只能透過 seed script 進來，必走 SKILL.md 流程 |

---

## 測試

| 類型 | 檔案 | 內容 |
|---------|------|------|
| Unit (prompt) | `backend/tests/test_evaluation_prompt.py` | core/bonus 分塊、common_mistakes 出現、難度校準呈現、空 rubric fallback、evidence-aligned 規則保留 |
| Unit (build_prompt 整合) | 同上 | 新簽章 `difficulty=`/`key_points=`/`common_mistakes=` 必填；正向 case 產出包含三組區塊 |
| Migration | `alembic upgrade head` + `\d questions` | 新欄位存在、`NOT NULL`、`server_default` 對既有 row 灌空集合 |
| Seed | `docker-compose exec backend python scripts/seed_questions.py` | upsert 10 題、每題 `jsonb_array_length(key_points) >= 4`、`array_length(common_mistakes, 1) >= 2` |
| E2E API | `e2e/api/` | `POST /attempts` → 等待評分 → `GET /attempts/{id}/result`：score 在 0-100；`missing_points` 不誤判已提及內容 |
| Offline mode | 既有 e2e 不動 | `evaluation_offline_mode=True` 時行為不變 |
| Skill | 人工 dry-run | 用 `import-blog-questions` skill 對一篇假文章走一輪：能否產出符合數量範圍的 entry |

### PR ready 前 checklist

```
[ ] alembic upgrade head 在乾淨 DB 跟既有 DB 都成功
[ ] alembic downgrade -1 後 schema 回滾正確
[ ] backend/tests 全綠（含新測試）
[ ] make test-env-up && make test 全綠
[ ] 10 題每題 key_points 至少 4 core，總計 4-12 項
[ ] 10 題每題 common_mistakes 至少 2 項
[ ] 隨機抽 3 題做端到端評分驗證：missing_points 對得上 key_points 漏項
[ ] 故意送一個落入 common_mistakes 的回答 → 驗證 missing_points 有指出
[ ] SKILL.md 流程能複製貼上跑得起來
[ ] git diff 沒有意外變動（特別是 seed_questions.py 格式縮排）
```

---

## 非變動範圍

- 前端：**零變動**
- E2E playwright：**零變動**
- `interview_session` / `attempt` / `sm2_state` models：**零變動**
- SM-2 演算法：**零變動**（`score_to_grade` 邏輯不動）
- 其他 routers（`sessions` / `realtime` / `questions`）：**零變動**

---

## 下一步

設計確認後，呼叫 `writing-plans` skill 把本 spec 轉成可執行的實作計畫。
