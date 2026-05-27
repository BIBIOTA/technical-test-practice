"use client";

import { useEffect, useRef, useState } from "react";
import type { NextQuestion } from "../lib/api";
import type { TranscriptMessage } from "../lib/realtimeClient";

type MicStatus = "idle" | "requesting" | "granted" | "denied";

interface Props {
  stream: MediaStream | null;
  currentQuestion: NextQuestion | null;
  questionIndex: number;
  totalQuestions: number;
  isCompleted: boolean;
  answerSummary: string;
  onEndSession: () => void;
  onNextQuestion: () => void;
  onStartSession: () => void;
  elapsedSeconds: number;
  mode: string;
  evalProvider: string;
  isMuted: boolean;
  onMuteToggle: () => void;
  transcripts: TranscriptMessage[];
  micStatus: MicStatus;
  onSubmitAnswer?: () => void;
  isSubmitting?: boolean;
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
  onStartSession,
  elapsedSeconds,
  mode,
  evalProvider,
  stream,
  isMuted,
  onMuteToggle,
  transcripts,
  micStatus,
  onSubmitAnswer,
  isSubmitting,
}: Props) {
  const [barHeights, setBarHeights] = useState(SOUND_WAVE_HEIGHTS);
  const animFrameRef = useRef<number | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!stream) return;

    const audioCtx = new AudioContext();
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.75;
    source.connect(analyser);

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
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

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcripts]);

  // Only show completed messages + typing indicators (empty-text) to avoid noisy deltas
  const displayTranscripts = transcripts
    .filter((m) => !m.isTyping || m.text === "")
    .slice(-8);
  const answerTranscript = transcripts
    .filter((m) => m.role === "user" && !m.isTyping && m.text.trim())
    .map((m) => m.text.trim())
    .join("\n\n");

  const modeBadgeColor = mode === "single" ? "#6C63FF" : mode === "mock" ? "#4ECDC4" : "#F59E0B";
  const modeLabel =
    mode === "single" ? "Single Mode" : mode === "mock" ? "Mock Mode" : "Weak Review";

  const difficultyColor =
    currentQuestion?.difficulty === "easy"
      ? "#10B981"
      : currentQuestion?.difficulty === "hard"
      ? "#C83737"
      : "#F59E0B";

  const sessionControls = (
    <div className="flex items-center justify-center gap-4 flex-shrink-0">
      <button
        onClick={onMuteToggle}
        className="px-4 py-2.5 rounded-xl text-sm font-medium border"
        style={{
          background: isMuted ? "rgba(200,55,55,0.15)" : "var(--color-surface-elevated)",
          borderColor: isMuted ? "rgba(200,55,55,0.4)" : "transparent",
          color: isMuted ? "#E57373" : "var(--color-text-secondary)",
        }}
      >
        {isMuted ? "🎤 開啟麥克風" : "🔇 靜音"}
      </button>
      {onSubmitAnswer && (
        <button
          onClick={onSubmitAnswer}
          disabled={isSubmitting || !currentQuestion}
          className="px-4 py-2.5 rounded-xl text-sm font-medium"
          style={{
            background: isSubmitting ? "var(--color-surface-elevated)" : "rgba(16,185,129,0.15)",
            color: isSubmitting || !currentQuestion ? "var(--color-text-secondary)" : "#10B981",
            opacity: !currentQuestion ? 0.5 : 1,
            cursor: isSubmitting || !currentQuestion ? "not-allowed" : "pointer",
          }}
        >
          {isSubmitting ? "評分中..." : "送出答案"}
        </button>
      )}
      {isCompleted && (
        <button
          onClick={onNextQuestion}
          className="px-4 py-2.5 rounded-xl text-sm"
          style={{ background: "var(--color-surface-elevated)", color: "var(--color-text-secondary)" }}
        >
          {mode === "single" ? "← 返回題目列表" : "下一題 →"}
        </button>
      )}
    </div>
  );

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

      {/* Body */}
      <div className="flex-1 overflow-y-auto flex flex-col gap-6 p-8" style={{ paddingLeft: 40, paddingRight: 32 }}>
        {/* Question Card — only shown after session starts */}
        {micStatus !== "idle" && <div className="rounded-2xl p-6 flex flex-col gap-4" style={{ background: "var(--color-surface)" }}>
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
        </div>}

        {/* Voice Interface or Answer Summary */}
        {isCompleted ? (
          <div className="rounded-2xl p-6 flex-1 flex flex-col gap-4" style={{ background: "var(--color-surface)" }}>
            <div className="flex-1 flex flex-col gap-5">
              <div>
                <p className="text-xs font-medium mb-3" style={{ color: "var(--color-text-secondary)" }}>
                  您的回答逐字稿
                </p>
                <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: "#C5D0DE" }}>
                  {answerTranscript || "尚未收到語音逐字稿"}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium mb-3" style={{ color: "var(--color-text-secondary)" }}>
                  評分摘要
                </p>
                <p className="text-sm leading-relaxed" style={{ color: "#C5D0DE" }}>
                  {answerSummary || "等待回答..."}
                </p>
              </div>
            </div>
            {sessionControls}
          </div>
        ) : micStatus === "idle" ? (
          /* Pre-session: show question, offer start button */
          <div
            className="rounded-2xl p-8 flex-1 flex flex-col items-center justify-center gap-5"
            style={{ background: "var(--color-surface)" }}
          >
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center text-2xl"
              style={{ background: "rgba(108,99,255,0.15)", border: "2px solid rgba(108,99,255,0.3)" }}
            >
              🎤
            </div>
            <div className="text-center flex flex-col gap-2">
              <p className="font-semibold" style={{ color: "var(--color-text-primary)" }}>
                準備好了嗎？
              </p>
              <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
                開始後麥克風預設為關閉，您可隨時開啟
              </p>
            </div>
            <button
              onClick={onStartSession}
              className="px-8 py-3 rounded-xl font-semibold text-white"
              style={{ background: "var(--color-primary)" }}
            >
              開始面試
            </button>
          </div>
        ) : micStatus === "requesting" ? (
          /* Requesting mic permission */
          <div
            className="rounded-2xl p-8 flex-1 flex flex-col items-center justify-center gap-4"
            style={{ background: "var(--color-surface)" }}
          >
            <div
              className="w-8 h-8 rounded-full border-2 animate-spin"
              style={{ borderColor: "var(--color-primary)", borderTopColor: "transparent" }}
            />
            <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
              正在請求麥克風權限...
            </p>
          </div>
        ) : (
          /* Active session */
          <div
            className="rounded-2xl p-6 flex-1 flex flex-col gap-4"
            style={{ background: "var(--color-surface)" }}
          >
            {/* AI Avatar + status */}
            <div className="flex items-center gap-4 flex-shrink-0">
              <div
                className="w-14 h-14 rounded-full flex items-center justify-center font-bold text-xl border-2"
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
                  <div
                    className="w-2 h-2 rounded-full"
                    style={{ background: isMuted ? "#C83737" : "#10B981" }}
                  />
                  <span className="text-xs" style={{ color: isMuted ? "#C83737" : "#10B981" }}>
                    {isMuted ? "您的麥克風已關閉" : "正在聆聽..."}
                  </span>
                </div>
              </div>
            </div>

            {/* Sound Wave */}
            <div className="flex items-center justify-center gap-1 flex-shrink-0" style={{ height: 76 }}>
              {barHeights.map((h, i) => (
                <div
                  key={i}
                  style={{
                    width: 5,
                    height: Math.round(h),
                    background: isMuted ? "var(--color-border)" : "var(--color-primary)",
                    borderRadius: 3,
                    transition: "height 60ms ease",
                    opacity: isMuted ? 0.5 : 1,
                  }}
                />
              ))}
            </div>

            {/* Live Transcript */}
            <div className="flex-1 overflow-y-auto flex flex-col gap-2 min-h-0">
              {displayTranscripts.length === 0 ? (
                <p className="text-xs text-center py-4" style={{ color: "var(--color-text-secondary)" }}>
                  對話文字將顯示於此...
                </p>
              ) : (
                displayTranscripts.map((msg, i) => (
                  <div
                    key={i}
                    className={`flex items-start gap-2 ${msg.role === "user" ? "flex-row-reverse" : ""}`}
                  >
                    {msg.role === "ai" && (
                      <div
                        className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                        style={{ background: "rgba(108,99,255,0.2)", color: "var(--color-primary)" }}
                      >
                        AI
                      </div>
                    )}
                    <div
                      className="px-3 py-1.5 rounded-xl text-xs leading-relaxed"
                      style={{
                        maxWidth: "75%",
                        ...(msg.role === "ai"
                          ? { background: "var(--color-surface-elevated)", color: "var(--color-text-primary)" }
                          : { background: "rgba(108,99,255,0.2)", color: "var(--color-text-primary)" }),
                      }}
                    >
                      {msg.isTyping && msg.text === "" ? (
                        <span className="opacity-60">●●●</span>
                      ) : (
                        msg.text
                      )}
                    </div>
                  </div>
                ))
              )}
              <div ref={transcriptEndRef} />
            </div>
            {/* Controls */}
            {sessionControls}
          </div>
        )}
      </div>
    </div>
  );
}
