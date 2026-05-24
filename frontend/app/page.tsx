"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createSession } from "../lib/api";

const MODES = [
  {
    id: "single",
    title: "單題練習",
    description: "針對單一題目進行深度練習，AI 評分後提供詳細反饋，適合重點攻克特定知識點。",
    tag: "Single Mode",
    color: "#6C63FF",
    icon: "★",
  },
  {
    id: "mock",
    title: "模擬面試",
    description: "模擬真實面試情境，AI 連續出題並最終產生整體評估報告，提升臨場應試能力。",
    tag: "Mock Interview",
    color: "#4ECDC4",
    icon: "◈",
  },
  {
    id: "weak_review",
    title: "弱點複習",
    description: "根據 SM-2 算法自動選出需要複習的弱點題目，針對低分題目加強練習。",
    tag: "Weak Review",
    color: "#F59E0B",
    icon: "⟳",
  },
] as const;

const PROVIDERS = ["openai", "claude", "gemini"] as const;
type Provider = (typeof PROVIDERS)[number];

export default function HomePage() {
  const router = useRouter();
  const [selectedMode, setSelectedMode] = useState<string>("single");
  const [evalProvider, setEvalProvider] = useState<Provider>("openai");
  const [loading, setLoading] = useState(false);

  async function handleStart() {
    setLoading(true);
    try {
      const session = await createSession(selectedMode, evalProvider);
      router.push(
        `/interview?session_id=${session.session_id}&mode=${selectedMode}&provider=${evalProvider}`
      );
    } catch (err) {
      alert("無法建立 session，請確認後端已啟動。\n" + String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col min-h-screen" style={{ background: "var(--color-bg)" }}>
      {/* Header */}
      <header
        className="flex items-center justify-between px-10 border-b"
        style={{
          height: 64,
          borderColor: "var(--color-border)",
          background: "var(--color-surface)",
        }}
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
      </header>

      {/* Main */}
      <main
        className="flex-1 flex flex-col items-center gap-10"
        style={{ padding: "60px 120px" }}
      >
        {/* Hero */}
        <div className="text-center">
          <h1
            className="font-bold text-4xl mb-3"
            style={{ color: "var(--color-text-primary)" }}
          >
            選擇面試模式
          </h1>
          <p className="text-base" style={{ color: "var(--color-text-secondary)" }}>
            透過 AI 語音面試官互動，根據 SM-2 間隔複習算法智能出題
          </p>
        </div>

        {/* Mode Cards */}
        <div className="grid grid-cols-3 gap-6 w-full max-w-4xl">
          {MODES.map((mode) => {
            const isSelected = selectedMode === mode.id;
            return (
              <button
                key={mode.id}
                onClick={() => setSelectedMode(mode.id)}
                className="flex flex-col gap-4 p-6 rounded-2xl border text-left transition-all cursor-pointer"
                style={{
                  background: isSelected ? `${mode.color}14` : "var(--color-surface)",
                  borderColor: isSelected ? mode.color : "var(--color-border)",
                  borderWidth: isSelected ? 2 : 1,
                }}
              >
                <div
                  className="w-12 h-12 rounded-xl flex items-center justify-center font-bold text-xl"
                  style={{ background: `${mode.color}26`, color: mode.color }}
                >
                  {mode.icon}
                </div>
                <div>
                  <h3
                    className="font-semibold text-lg mb-2"
                    style={{ color: "var(--color-text-primary)" }}
                  >
                    {mode.title}
                  </h3>
                  <p
                    className="text-sm leading-relaxed"
                    style={{ color: "var(--color-text-secondary)" }}
                  >
                    {mode.description}
                  </p>
                </div>
                <span
                  className="text-xs font-medium px-2 py-1 rounded-md self-start"
                  style={{ background: `${mode.color}1F`, color: mode.color }}
                >
                  {mode.tag}
                </span>
              </button>
            );
          })}
        </div>

        {/* Controls Row */}
        <div className="flex items-center justify-between w-full max-w-4xl">
          {/* Eval Provider */}
          <div>
            <p
              className="text-xs font-medium mb-2"
              style={{ color: "var(--color-text-secondary)" }}
            >
              評分模型
            </p>
            <div className="flex gap-2">
              {PROVIDERS.map((p) => {
                const isActive = evalProvider === p;
                return (
                  <button
                    key={p}
                    onClick={() => setEvalProvider(p)}
                    className="px-4 py-2 rounded-lg text-sm font-medium border transition-all cursor-pointer"
                    style={
                      isActive
                        ? {
                            background: "rgba(108,99,255,0.2)",
                            borderColor: "var(--color-primary)",
                            borderWidth: "1.5px",
                            color: "#C4BEFF",
                          }
                        : {
                            background: "var(--color-surface-elevated)",
                            borderColor: "var(--color-border)",
                            color: "var(--color-text-secondary)",
                          }
                    }
                  >
                    {p.charAt(0).toUpperCase() + p.slice(1)}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Start Button */}
          <button
            onClick={handleStart}
            disabled={loading}
            className="px-10 py-4 rounded-xl font-semibold text-base text-white transition-opacity disabled:opacity-50 cursor-pointer"
            style={{ background: "var(--color-primary)", borderRadius: 12 }}
          >
            {loading ? "建立中..." : "開始面試"}
          </button>
        </div>
      </main>
    </div>
  );
}
