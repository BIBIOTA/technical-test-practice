"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import {
  createSession,
  getQuestion,
  type QuestionDetail,
  type QuestionDetailKeyPoint,
} from "../../../lib/api";
import { ApiError } from "../../../lib/errors";

const CATEGORY_COLORS: Record<string, string> = {
  "llm-engineering": "#6C63FF",
  testing: "#4ECDC4",
  auth: "#F59E0B",
  backend: "#10B981",
  frontend: "#3B82F6",
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

type FetchErrorKind =
  | { kind: "network" }
  | { kind: "not_found" }
  | { kind: "other" };

function QuestionDetailContent() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const id = params.id;
  const provider = search.get("provider") ?? "openai";

  const [data, setData] = useState<QuestionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<FetchErrorKind | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function load() {
    setLoading(true);
    setFetchError(null);
    try {
      setData(await getQuestion(id));
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setFetchError({ kind: "not_found" });
      } else if (err instanceof TypeError) {
        setFetchError({ kind: "network" });
      } else {
        setFetchError({ kind: "other" });
      }
    } finally {
      setLoading(false);
    }
  }

  function goBackToSelect() {
    router.push(`/questions/select?provider=${provider}`);
  }

  async function handleStartPractice() {
    setStartError(null);
    setStarting(true);
    try {
      const session = await createSession("single", provider);
      router.push(
        `/interview?session_id=${session.session_id}&mode=single&provider=${provider}&question_id=${id}`
      );
    } catch {
      setStartError("建立練習失敗，請稍後再試。");
      setStarting(false);
    }
  }

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
          onClick={goBackToSelect}
          className="text-sm px-4 py-2 rounded-lg border transition-all"
          style={{
            borderColor: "var(--color-border)",
            color: "var(--color-text-secondary)",
            background: "var(--color-surface-elevated)",
          }}
        >
          ← 返回選題
        </button>
      </header>

      <main className="flex-1 flex flex-col items-center gap-6" style={{ padding: "48px 120px" }}>
        <div className="w-full max-w-3xl">
          <h1 className="font-bold text-3xl mb-2" style={{ color: "var(--color-text-primary)" }}>
            題目內容
          </h1>
          <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
            複習此題的參考答案、評分要點與常見錯誤
          </p>
        </div>

        {loading && (
          <p className="text-sm text-center py-6" style={{ color: "var(--color-text-secondary)" }}>
            載入中...
          </p>
        )}

        {!loading && fetchError?.kind === "network" && (
          <div
            className="w-full max-w-3xl flex flex-col gap-3 items-center py-6"
            style={{ background: "#F0444414", border: "1px solid #F0444440", borderRadius: 10 }}
          >
            <p className="text-sm" style={{ color: "var(--color-text-primary)" }}>
              無法連線到後端伺服器，請確認伺服器已啟動後重試。
            </p>
            <button
              onClick={load}
              className="px-4 py-2 rounded-lg text-sm font-medium"
              style={{ background: "var(--color-surface-elevated)", color: "var(--color-text-primary)" }}
            >
              重試
            </button>
          </div>
        )}

        {!loading && fetchError?.kind === "not_found" && (
          <div
            className="w-full max-w-3xl flex flex-col gap-3 items-center py-6"
            style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10 }}
          >
            <p className="text-sm" style={{ color: "var(--color-text-primary)" }}>
              找不到這題，可能已被移除。
            </p>
            <button
              onClick={goBackToSelect}
              className="px-4 py-2 rounded-lg text-sm font-medium"
              style={{ background: "var(--color-surface-elevated)", color: "var(--color-text-primary)" }}
            >
              返回選題
            </button>
          </div>
        )}

        {!loading && fetchError?.kind === "other" && (
          <div
            className="w-full max-w-3xl flex flex-col gap-3 items-center py-6"
            style={{ background: "#F0444414", border: "1px solid #F0444440", borderRadius: 10 }}
          >
            <p className="text-sm" style={{ color: "var(--color-text-primary)" }}>
              無法載入題目內容，請稍後再試。
            </p>
            <button
              onClick={load}
              className="px-4 py-2 rounded-lg text-sm font-medium"
              style={{ background: "var(--color-surface-elevated)", color: "var(--color-text-primary)" }}
            >
              重試
            </button>
          </div>
        )}

        {!loading && data && (
          <>
            <Section title="題目">
              <div className="flex items-center gap-2 flex-wrap mb-3">
                <Chip color={catColor(data.category)} label={data.category} />
                <Chip color={diffColor(data.difficulty)} label={data.difficulty} />
                {data.tags.map((t) => (
                  <Chip key={t} color={DEFAULT_COLOR} label={t} />
                ))}
              </div>
              <p
                className="text-base leading-relaxed whitespace-pre-wrap"
                style={{ color: "var(--color-text-primary)" }}
              >
                {data.question_text}
              </p>
            </Section>

            <Section title="參考答案">
              <p
                className="text-sm leading-relaxed whitespace-pre-wrap"
                style={{ color: "var(--color-text-primary)" }}
              >
                {data.reference_answer}
              </p>
            </Section>

            <Section title="評分要點">
              {data.key_points.length === 0 ? (
                <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
                  （尚無評分要點）
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {data.key_points.map((kp, idx) => (
                    <KeyPointItem key={idx} kp={kp} />
                  ))}
                </ul>
              )}
            </Section>

            <Section title="常見錯誤">
              {data.common_mistakes.length === 0 ? (
                <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
                  （尚無常見錯誤紀錄）
                </p>
              ) : (
                <ul className="flex flex-col gap-2 list-disc pl-5">
                  {data.common_mistakes.map((m, idx) => (
                    <li
                      key={idx}
                      className="text-sm leading-relaxed"
                      style={{ color: "var(--color-text-primary)" }}
                    >
                      {m}
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            {startError && (
              <div
                className="w-full max-w-3xl px-4 py-3 text-sm"
                style={{
                  background: "#F0444414",
                  border: "1px solid #F0444440",
                  borderRadius: 10,
                  color: "var(--color-text-primary)",
                }}
              >
                {startError}
              </div>
            )}

            <div className="w-full max-w-3xl flex items-center justify-end gap-3">
              <button
                onClick={goBackToSelect}
                className="px-4 py-2 rounded-lg text-sm font-medium border"
                style={{
                  borderColor: "var(--color-border)",
                  color: "var(--color-text-secondary)",
                  background: "var(--color-surface-elevated)",
                }}
              >
                返回選題
              </button>
              <button
                onClick={handleStartPractice}
                disabled={starting}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50 cursor-pointer"
                style={{ background: "var(--color-primary)" }}
              >
                {starting ? "建立中..." : "開始練習這題"}
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      className="w-full max-w-3xl px-5 py-4 rounded-xl border"
      style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}
    >
      <h2 className="text-sm font-semibold mb-3" style={{ color: "var(--color-text-secondary)" }}>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Chip({ color, label }: { color: string; label: string }) {
  return (
    <span
      className="text-xs font-medium px-2 py-0.5 rounded-md"
      style={{ background: `${color}1F`, color }}
    >
      {label}
    </span>
  );
}

function KeyPointItem({ kp }: { kp: QuestionDetailKeyPoint }) {
  const point = typeof kp.point === "string" ? kp.point : null;
  const weight = typeof kp.weight === "number" ? kp.weight : null;
  return (
    <li
      className="text-sm leading-relaxed flex items-start gap-2"
      style={{ color: "var(--color-text-primary)" }}
    >
      <span style={{ color: "var(--color-text-secondary)" }}>•</span>
      <span className="flex-1">
        {point ?? "（未填寫評分要點內容）"}
        {weight !== null && (
          <span className="ml-2 text-xs" style={{ color: "var(--color-text-secondary)" }}>
            ({Math.round(weight * 100)}%)
          </span>
        )}
      </span>
    </li>
  );
}

export default function QuestionDetailPage() {
  return (
    <Suspense fallback={<div>載入中...</div>}>
      <QuestionDetailContent />
    </Suspense>
  );
}
