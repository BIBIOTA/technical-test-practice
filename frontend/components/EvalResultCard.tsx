"use client";

import type { EvaluationResult } from "../lib/api";

interface Props {
  evaluation: EvaluationResult;
  sm2?: {
    ease_factor: number | null;
    interval_days: number | null;
  };
  onNext?: () => void;
}

const DIMENSIONS = [
  { key: "技術深度", color: "#6C63FF" },
  { key: "架構設計", color: "#4ECDC4" },
  { key: "溝通表達", color: "#F59E0B" },
  { key: "問題解決", color: "#10B981" },
];

export default function EvalResultCard({ evaluation, sm2, onNext }: Props) {
  return (
    <div className="flex flex-col gap-4 flex-1 overflow-y-auto">
      {/* Score Card */}
      <div
        className="rounded-2xl p-5 flex flex-col gap-4"
        style={{ background: "var(--color-surface)" }}
      >
        {/* Score Row */}
        <div className="flex items-start justify-between">
          <div>
            <span
              className="font-bold text-5xl"
              style={{ color: "var(--color-primary)" }}
            >
              {evaluation.score}
            </span>
            <span className="text-xs ml-1" style={{ color: "var(--color-text-secondary)" }}>
              /100 分 · {evaluation.provider}
            </span>
          </div>
          {sm2 && (
            <div
              className="rounded-xl p-3 text-xs flex flex-col gap-1"
              style={{ background: "var(--color-surface-elevated)" }}
            >
              <span style={{ color: "var(--color-text-secondary)" }}>SM-2 更新</span>
              <span className="font-semibold" style={{ color: "var(--color-text-primary)" }}>
                下次複習: {sm2.interval_days ?? 1} 天後
              </span>
              <span style={{ color: "var(--color-green)" }}>
                EF: {(sm2.ease_factor ?? 2.5).toFixed(2)}
              </span>
            </div>
          )}
        </div>

        <div className="border-t" style={{ borderColor: "var(--color-border)" }} />

        {/* Dimensions */}
        <div>
          <p className="text-xs font-medium mb-3" style={{ color: "var(--color-text-secondary)" }}>
            各維度評分
          </p>
          <div className="flex flex-col gap-3">
            {DIMENSIONS.map(({ key, color }) => {
              const score = evaluation.score; // Simplified: use overall score for now
              return (
                <div key={key} className="flex flex-col gap-1">
                  <div className="flex justify-between text-xs">
                    <span style={{ color: "var(--color-text-primary)" }}>{key}</span>
                    <span className="font-semibold" style={{ color }}>
                      {score}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full" style={{ background: "var(--color-surface-elevated)" }}>
                    <div
                      className="h-1.5 rounded-full"
                      style={{ width: `${score}%`, background: color }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Feedback Card */}
      <div
        className="rounded-2xl p-5 flex flex-col gap-3"
        style={{ background: "var(--color-surface)" }}
      >
        <p className="text-xs font-medium" style={{ color: "var(--color-text-secondary)" }}>
          AI 詳細反饋
        </p>
        <p className="text-sm leading-relaxed" style={{ color: "var(--color-text-primary)" }}>
          {evaluation.summary}
        </p>

        {evaluation.missing_points.length > 0 && (
          <div
            className="rounded-xl p-3"
            style={{ background: "rgba(245,158,11,0.06)" }}
          >
            <p className="text-xs font-medium mb-2" style={{ color: "#F59E0B" }}>
              ● 待改善
            </p>
            <ul className="text-xs space-y-1" style={{ color: "var(--color-text-primary)" }}>
              {evaluation.missing_points.map((p, i) => (
                <li key={i}>• {p}</li>
              ))}
            </ul>
          </div>
        )}

        {evaluation.next_focus.length > 0 && (
          <div
            className="rounded-xl p-3"
            style={{ background: "rgba(16,185,129,0.06)" }}
          >
            <p className="text-xs font-medium mb-2" style={{ color: "#10B981" }}>
              ● 優勢 / 下一步
            </p>
            <ul className="text-xs space-y-1" style={{ color: "var(--color-text-primary)" }}>
              {evaluation.next_focus.map((p, i) => (
                <li key={i}>• {p}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {evaluation.ideal_answer && (
        <div
          className="rounded-2xl p-5 flex flex-col gap-3"
          style={{ background: "var(--color-surface)" }}
        >
          <p className="text-xs font-medium" style={{ color: "var(--color-text-secondary)" }}>
            模範回答參考
          </p>
          <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: "var(--color-text-primary)" }}>
            {evaluation.ideal_answer}
          </p>
        </div>
      )}

      {onNext && (
        <button
          onClick={onNext}
          className="w-full py-4 rounded-xl font-semibold text-sm text-white"
          style={{ background: "var(--color-primary)" }}
        >
          下一題 →
        </button>
      )}
    </div>
  );
}
