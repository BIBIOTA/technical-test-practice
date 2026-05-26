"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { createSession, listQuestions, type QuestionSummary } from "../../../lib/api";
import { parseConnectionError } from "../../../lib/errors";

const CATEGORY_COLORS: Record<string, string> = {
  "llm-engineering": "#6C63FF",
  "testing": "#4ECDC4",
  "auth": "#F59E0B",
  "backend": "#10B981",
  "frontend": "#3B82F6",
};
const DEFAULT_COLOR = "#6B7280";

const DIFFICULTY_COLORS: Record<string, string> = {
  easy: "#10B981",
  medium: "#F59E0B",
  hard: "#EF4444",
};

function catColor(cat: string): string {
  return CATEGORY_COLORS[cat] ?? DEFAULT_COLOR;
}

function diffColor(diff: string): string {
  return DIFFICULTY_COLORS[diff] ?? DEFAULT_COLOR;
}

function QuestionSelectContent() {
  const router = useRouter();
  const params = useSearchParams();
  const provider = params.get("provider") ?? "openai";

  const [questions, setQuestions] = useState<QuestionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [difficultyFilter, setDifficultyFilter] = useState("all");
  const [startingId, setStartingId] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setFetchError(null);
    try {
      setQuestions(await listQuestions());
    } catch (err) {
      setFetchError(parseConnectionError(err).message);
    } finally {
      setLoading(false);
    }
  }

  const categories = Array.from(new Set(questions.map((q) => q.category))).sort();

  const filtered = questions.filter((q) => {
    if (categoryFilter !== "all" && q.category !== categoryFilter) return false;
    if (difficultyFilter !== "all" && q.difficulty !== difficultyFilter) return false;
    return true;
  });

  async function handleSelect(question: QuestionSummary) {
    setStartError(null);
    setStartingId(question.question_id);
    try {
      const session = await createSession("single", provider);
      router.push(
        `/interview?session_id=${session.session_id}&mode=single&provider=${provider}&question_id=${question.question_id}`
      );
    } catch (err) {
      setStartError(parseConnectionError(err).message);
      setStartingId(null);
    }
  }

  const selectStyle = {
    background: "var(--color-surface)",
    borderColor: "var(--color-border)",
    color: "var(--color-text-primary)",
  };

  return (
    <div className="flex flex-col min-h-screen" style={{ background: "var(--color-bg)" }}>
      <header
        className="flex items-center justify-between px-10 border-b"
        style={{ height: 64, borderColor: "var(--color-border)", background: "var(--color-surface)" }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-sm"
            style={{ background: "var(--color-primary)" }}
          >
            I
          </div>
          <span className="font-semibold text-lg" style={{ color: "var(--color-text-primary)" }}>
            Interview Practice
          </span>
        </div>
        <button
          onClick={() => router.push("/")}
          className="text-sm px-4 py-2 rounded-lg border transition-all"
          style={{ borderColor: "var(--color-border)", color: "var(--color-text-secondary)", background: "var(--color-surface-elevated)" }}
        >
          ← 返回
        </button>
      </header>

      <main className="flex-1 flex flex-col items-center gap-8" style={{ padding: "48px 120px" }}>
        <div className="text-center">
          <h1 className="font-bold text-4xl mb-2" style={{ color: "var(--color-text-primary)" }}>
            選擇練習題目
          </h1>
          <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>Single Mode</p>
        </div>

        <div className="flex gap-3 w-full max-w-3xl">
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="px-3 py-2 rounded-lg border text-sm"
            style={selectStyle}
          >
            <option value="all">全部類別</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select
            value={difficultyFilter}
            onChange={(e) => setDifficultyFilter(e.target.value)}
            className="px-3 py-2 rounded-lg border text-sm"
            style={selectStyle}
          >
            <option value="all">全部難度</option>
            {(["easy", "medium", "hard"] as const).map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-3 w-full max-w-3xl">
          {loading && (
            <p className="text-sm text-center py-6" style={{ color: "var(--color-text-secondary)" }}>
              載入中...
            </p>
          )}

          {fetchError && (
            <div
              className="flex flex-col gap-3 items-center py-6"
              style={{ background: "#F0444414", border: "1px solid #F0444440", borderRadius: 10 }}
            >
              <p className="text-sm" style={{ color: "var(--color-text-primary)" }}>{fetchError}</p>
              <button
                onClick={load}
                className="px-4 py-2 rounded-lg text-sm font-medium"
                style={{ background: "var(--color-surface-elevated)", color: "var(--color-text-primary)" }}
              >
                重試
              </button>
            </div>
          )}

          {!loading && !fetchError && filtered.length === 0 && (
            <p className="text-sm text-center py-6" style={{ color: "var(--color-text-secondary)" }}>
              {questions.length === 0 ? "目前沒有可用的題目" : "沒有符合條件的題目"}
            </p>
          )}

          {filtered.map((q) => {
            const cc = catColor(q.category);
            const dc = diffColor(q.difficulty);
            const isStarting = startingId === q.question_id;
            return (
              <div
                key={q.question_id}
                className="flex items-center justify-between gap-4 px-5 py-4 rounded-xl border"
                style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}
              >
                <div className="flex flex-col gap-2 flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className="text-xs font-medium px-2 py-0.5 rounded-md"
                      style={{ background: `${cc}1F`, color: cc }}
                    >
                      {q.category}
                    </span>
                    <span
                      className="text-xs font-medium px-2 py-0.5 rounded-md"
                      style={{ background: `${dc}1F`, color: dc }}
                    >
                      {q.difficulty}
                    </span>
                    <span className="text-xs" style={{ color: "var(--color-text-secondary)" }}>
                      {q.sm2.last_score !== null ? `上次：${q.sm2.last_score} 分` : "尚未練習"}
                    </span>
                  </div>
                  <p className="text-sm leading-relaxed" style={{ color: "var(--color-text-primary)" }}>
                    {q.question_text.length > 60 ? q.question_text.slice(0, 60) + "…" : q.question_text}
                  </p>
                </div>
                <button
                  onClick={() => handleSelect(q)}
                  disabled={startingId !== null}
                  className="flex-shrink-0 px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50 cursor-pointer"
                  style={{ background: "var(--color-primary)" }}
                >
                  {isStarting ? "建立中..." : "選擇練習"}
                </button>
              </div>
            );
          })}

          {startError && (
            <div
              className="px-4 py-3 text-sm"
              style={{ background: "#F0444414", border: "1px solid #F0444440", borderRadius: 10, color: "var(--color-text-primary)" }}
            >
              {startError}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default function QuestionSelectPage() {
  return (
    <Suspense fallback={<div>載入中...</div>}>
      <QuestionSelectContent />
    </Suspense>
  );
}
