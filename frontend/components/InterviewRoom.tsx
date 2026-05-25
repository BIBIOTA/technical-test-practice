"use client";

import { useEffect, useRef, useState } from "react";
import type { NextQuestion } from "../lib/api";
import type { RealtimeClient } from "../lib/realtimeClient";

interface Props {
  client: RealtimeClient | null;
  stream: MediaStream | null;
  currentQuestion: NextQuestion | null;
  questionIndex: number;
  totalQuestions: number;
  isCompleted: boolean;
  answerSummary: string;
  onEndSession: () => void;
  onNextQuestion: () => void;
  elapsedSeconds: number;
  mode: string;
  evalProvider: string;
}

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

const SOUND_WAVE_HEIGHTS = [16, 28, 40, 56, 60, 48, 36, 24, 36, 48, 60, 56, 40, 28, 16];

export default function InterviewRoom({
  currentQuestion,
  questionIndex,
  isCompleted,
  answerSummary,
  onEndSession,
  onNextQuestion,
  elapsedSeconds,
  mode,
  evalProvider,
  stream,
}: Props) {
  const [isMuted, setIsMuted] = useState(false);
  const [barHeights, setBarHeights] = useState(SOUND_WAVE_HEIGHTS);
  const animFrameRef = useRef<number | null>(null);

  useEffect(() => {
    if (!stream) return;

    const audioCtx = new AudioContext();
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.75;
    source.connect(analyser);

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    // Map voice-range frequencies (up to ~4kHz) to our bars
    const voiceBins = Math.round((4000 / (audioCtx.sampleRate / 2)) * analyser.frequencyBinCount);
    const numBars = SOUND_WAVE_HEIGHTS.length;

    const tick = () => {
      analyser.getByteFrequencyData(dataArray);
      const binStep = voiceBins / numBars;
      const newHeights = SOUND_WAVE_HEIGHTS.map((maxH, i) => {
        const start = Math.floor(i * binStep);
        const end = Math.ceil((i + 1) * binStep);
        let sum = 0;
        for (let j = start; j < end && j < voiceBins; j++) sum += dataArray[j];
        const avg = sum / Math.max(end - start, 1);
        const minH = maxH * 0.12;
        return minH + (maxH - minH) * (avg / 255);
      });
      setBarHeights(newHeights);
      animFrameRef.current = requestAnimationFrame(tick);
    };

    animFrameRef.current = requestAnimationFrame(tick);

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      source.disconnect();
      audioCtx.close();
    };
  }, [stream]);

  const modeBadgeColor = mode === "single" ? "#6C63FF" : mode === "mock" ? "#4ECDC4" : "#F59E0B";
  const modeLabel =
    mode === "single" ? "Single Mode" : mode === "mock" ? "Mock Mode" : "Weak Review";

  const difficultyColor =
    currentQuestion?.difficulty === "easy"
      ? "#10B981"
      : currentQuestion?.difficulty === "hard"
      ? "#C83737"
      : "#F59E0B";

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div
        className="flex items-center justify-between px-6 border-b flex-shrink-0"
        style={{ height: 60, borderColor: "var(--color-border)", background: "var(--color-surface-elevated)" }}
      >
        <div className="flex items-center gap-3">
          <button
            onClick={onEndSession}
            className="px-3 py-1.5 rounded-lg text-sm"
            style={{ background: "var(--color-surface-elevated)", color: "var(--color-text-secondary)" }}
          >
            ← 返回
          </button>
          <div className="w-px h-6" style={{ background: "var(--color-border)" }} />
          <span
            className="px-3 py-1 rounded-lg text-xs font-medium"
            style={{
              background: `${modeBadgeColor}26`,
              color: modeBadgeColor === "#6C63FF" ? "#C4BEFF" : modeBadgeColor,
            }}
          >
            {modeLabel}
          </span>
          <span className="text-sm" style={{ color: isCompleted ? "#10B981" : "var(--color-text-secondary)" }}>
            Q{questionIndex} {isCompleted ? "· 完成" : ""}
          </span>
        </div>

        <div className="flex flex-col items-center">
          <span className="font-bold text-xl" style={{ color: "var(--color-text-primary)" }}>
            {formatTime(elapsedSeconds)}
          </span>
          <span className="text-xs" style={{ color: "var(--color-text-secondary)" }}>
            {isCompleted ? "面試已完成" : "面試進行中"}
          </span>
        </div>

        <div className="flex items-center gap-3">
          <span
            className="px-3 py-1.5 rounded-lg text-xs"
            style={{ background: "var(--color-surface-elevated)", color: "var(--color-text-secondary)" }}
          >
            Eval: {evalProvider}
          </span>
          {!isCompleted && (
            <button
              onClick={onEndSession}
              className="px-4 py-2 rounded-lg text-sm border"
              style={{
                background: "rgba(200,55,55,0.15)",
                borderColor: "rgba(200,55,55,0.4)",
                color: "#E57373",
              }}
            >
              結束面試
            </button>
          )}
        </div>
      </div>

      {/* Body: Question Card + Voice Interface */}
      <div className="flex-1 overflow-y-auto flex flex-col gap-6 p-8" style={{ paddingLeft: 40, paddingRight: 32 }}>
        {/* Question Card */}
        <div className="rounded-2xl p-6 flex flex-col gap-4" style={{ background: "var(--color-surface)" }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium" style={{ color: "var(--color-text-secondary)" }}>
                當前問題
              </span>
              {currentQuestion && (
                <>
                  <span
                    className="px-2 py-0.5 rounded text-xs font-medium"
                    style={{ background: `${difficultyColor}26`, color: difficultyColor }}
                  >
                    {currentQuestion.difficulty}
                  </span>
                  <span
                    className="px-2 py-0.5 rounded text-xs font-medium"
                    style={{ background: "rgba(78,205,196,0.15)", color: "#4ECDC4" }}
                  >
                    {currentQuestion.category}
                  </span>
                </>
              )}
            </div>
            {currentQuestion?.sm2?.last_score !== null && currentQuestion?.sm2?.last_score !== undefined && (
              <span className="text-xs" style={{ color: "var(--color-text-secondary)" }}>
                上次: {currentQuestion.sm2.last_score}分
              </span>
            )}
          </div>
          <p className="font-semibold text-lg leading-relaxed" style={{ color: "var(--color-text-primary)" }}>
            {currentQuestion ? currentQuestion.question_text : "載入題目中..."}
          </p>
        </div>

        {/* Voice Interface or Answer Summary */}
        {isCompleted ? (
          <div className="rounded-2xl p-6 flex-1" style={{ background: "var(--color-surface)" }}>
            <p className="text-xs font-medium mb-3" style={{ color: "var(--color-text-secondary)" }}>
              您的回答摘要
            </p>
            <p className="text-sm leading-relaxed" style={{ color: "#C5D0DE" }}>
              {answerSummary || "等待回答..."}
            </p>
          </div>
        ) : (
          <div
            className="rounded-2xl p-6 flex-1 flex flex-col gap-6"
            style={{ background: "var(--color-surface)" }}
          >
            {/* AI Avatar */}
            <div className="flex items-center gap-4">
              <div
                className="w-20 h-20 rounded-full flex items-center justify-center font-bold text-2xl border-2"
                style={{
                  background: "rgba(108,99,255,0.2)",
                  borderColor: "var(--color-primary)",
                  color: "#C4BEFF",
                }}
              >
                AI
              </div>
              <div>
                <p className="font-semibold text-sm" style={{ color: "var(--color-text-primary)" }}>
                  AI 面試官
                </p>
                <div className="flex items-center gap-2 mt-1">
                  <div className="w-2 h-2 rounded-full" style={{ background: "#10B981" }} />
                  <span className="text-xs" style={{ color: "#10B981" }}>
                    正在聆聽...
                  </span>
                </div>
              </div>
            </div>

            {/* Sound Wave */}
            <div className="flex items-center justify-center gap-1 py-4">
              {barHeights.map((h, i) => (
                <div
                  key={i}
                  style={{
                    width: 6,
                    height: Math.round(h),
                    background: "var(--color-primary)",
                    borderRadius: 3,
                    transition: "height 60ms ease",
                  }}
                />
              ))}
            </div>

            {/* Controls */}
            <div className="flex items-center justify-center gap-4">
              <button
                onClick={() => setIsMuted((v) => !v)}
                className="px-4 py-3 rounded-xl text-sm"
                style={{
                  background: "var(--color-surface-elevated)",
                  color: isMuted ? "#C83737" : "var(--color-text-secondary)",
                }}
              >
                {isMuted ? "取消靜音" : "靜音"}
              </button>
              <div
                className="w-16 h-16 rounded-full flex items-center justify-center font-bold text-xl text-white"
                style={{ background: "var(--color-primary)" }}
              >
                M
              </div>
              <button
                onClick={onNextQuestion}
                className="px-4 py-3 rounded-xl text-sm"
                style={{ background: "var(--color-surface-elevated)", color: "var(--color-text-secondary)" }}
              >
                下一題 →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
