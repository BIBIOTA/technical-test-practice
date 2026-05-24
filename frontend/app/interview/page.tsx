"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import EvalResultCard from "../../components/EvalResultCard";
import InterviewRoom from "../../components/InterviewRoom";
import TranscriptPanel from "../../components/TranscriptPanel";
import { completeSession, type EvaluationResult, type NextQuestion } from "../../lib/api";
import { RealtimeClient, type TranscriptMessage } from "../../lib/realtimeClient";

type Tab = "transcript" | "eval";
type MicStatus = "idle" | "requesting" | "granted" | "denied";

function InterviewContent() {
  const router = useRouter();
  const params = useSearchParams();
  const sessionId = params.get("session_id") ?? "";
  const mode = params.get("mode") ?? "single";
  const provider = params.get("provider") ?? "openai";

  const clientRef = useRef<RealtimeClient | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("transcript");
  const [transcripts, setTranscripts] = useState<TranscriptMessage[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState<NextQuestion | null>(null);
  const [questionIndex, setQuestionIndex] = useState(1);
  const [evalResult, setEvalResult] = useState<EvaluationResult | null>(null);
  const [isCompleted, setIsCompleted] = useState(false);
  const [answerSummary, setAnswerSummary] = useState("");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [micStatus, setMicStatus] = useState<MicStatus>("idle");
  const [connectionStatus, setConnectionStatus] = useState<string>("disconnected");

  // Timer
  useEffect(() => {
    const interval = setInterval(() => setElapsedSeconds((s) => s + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  // Request mic and connect
  async function startSession() {
    setMicStatus("requesting");
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      setMicStatus("granted");
    } catch {
      setMicStatus("denied");
      return;
    }

    const client = new RealtimeClient(sessionId, mode, {
      onTranscript: (msg) => setTranscripts((prev) => [...prev, msg]),
      onQuestion: (q) => {
        setCurrentQuestion({
          question_id: q.question_id,
          question_text: q.question_text,
          category: q.category,
          difficulty: q.difficulty,
          tags: [],
          sm2: { ease_factor: null, interval_days: null, next_review_at: null, last_score: null },
        });
        setQuestionIndex((i) => i + 1);
      },
      onEvalResult: (result) => {
        setEvalResult(result as EvaluationResult);
        setAnswerSummary(result.summary);
        setIsCompleted(true);
        setActiveTab("eval");
      },
      onStatusChange: setConnectionStatus,
      onError: (msg) => console.error("Realtime error:", msg),
    });

    clientRef.current = client;
    try {
      await client.connect();
    } catch (err) {
      console.error("Failed to connect:", err);
      setConnectionStatus("error");
    }
  }

  async function handleEndSession() {
    clientRef.current?.disconnect();
    await completeSession(sessionId).catch(() => {});
    router.push("/");
  }

  function handleNextQuestion() {
    setIsCompleted(false);
    setEvalResult(null);
    setAnswerSummary("");
    setActiveTab("transcript");
  }

  return (
    <div className="flex flex-col h-screen" style={{ background: "var(--color-bg)" }}>
      {/* Mic permission overlay */}
      {micStatus === "idle" && (
        <div className="absolute inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(15,17,23,0.9)" }}>
          <div
            className="rounded-2xl p-8 flex flex-col gap-4 items-center text-center max-w-sm"
            style={{ background: "var(--color-surface)" }}
          >
            <div className="text-4xl">🎤</div>
            <h2 className="font-semibold text-xl" style={{ color: "var(--color-text-primary)" }}>
              需要麥克風權限
            </h2>
            <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
              語音面試需要使用您的麥克風，請允許存取後開始面試。
            </p>
            <button
              onClick={startSession}
              className="w-full py-3 rounded-xl font-semibold text-white"
              style={{ background: "var(--color-primary)" }}
            >
              允許並開始
            </button>
          </div>
        </div>
      )}

      {micStatus === "denied" && (
        <div className="absolute inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(15,17,23,0.9)" }}>
          <div
            className="rounded-2xl p-8 flex flex-col gap-4 items-center text-center max-w-sm"
            style={{ background: "var(--color-surface)" }}
          >
            <div className="text-4xl">⚠️</div>
            <h2 className="font-semibold text-xl" style={{ color: "var(--color-text-primary)" }}>
              麥克風存取被拒
            </h2>
            <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
              請在瀏覽器設定中允許此網頁使用麥克風，然後重新整理頁面。
            </p>
            <button
              onClick={() => router.push("/")}
              className="w-full py-3 rounded-xl font-semibold"
              style={{ background: "var(--color-surface-elevated)", color: "var(--color-text-primary)" }}
            >
              返回
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Left Panel */}
        <div className="flex-1 overflow-hidden flex flex-col" style={{ borderRight: "1px solid var(--color-border)" }}>
          <InterviewRoom
            client={clientRef.current}
            currentQuestion={currentQuestion}
            questionIndex={questionIndex}
            totalQuestions={0}
            isCompleted={isCompleted}
            answerSummary={answerSummary}
            onEndSession={handleEndSession}
            onNextQuestion={handleNextQuestion}
            elapsedSeconds={elapsedSeconds}
            mode={mode}
            evalProvider={provider}
          />
        </div>

        {/* Right Panel */}
        <div
          className="flex flex-col"
          style={{ width: 400, background: "#15172E", padding: 24 }}
        >
          {/* Tab Row */}
          <div
            className="flex rounded-xl p-1 mb-5 flex-shrink-0"
            style={{ background: "var(--color-surface)" }}
          >
            {(["transcript", "eval"] as Tab[]).map((tab) => {
              const isActive = activeTab === tab;
              return (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className="flex-1 py-2 rounded-lg text-sm transition-all"
                  style={{
                    background: isActive ? "var(--color-surface-elevated)" : "transparent",
                    color: isActive ? "var(--color-text-primary)" : "var(--color-text-secondary)",
                    fontWeight: isActive ? 600 : 400,
                  }}
                >
                  {tab === "transcript" ? "對話紀錄" : "評分結果"}
                </button>
              );
            })}
          </div>

          {/* Tab Content */}
          {activeTab === "transcript" ? (
            <TranscriptPanel messages={transcripts} />
          ) : evalResult ? (
            <EvalResultCard
              evaluation={evalResult}
              onNext={handleNextQuestion}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
                評分結果將在回答後顯示
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function InterviewPage() {
  return (
    <Suspense fallback={<div>載入中...</div>}>
      <InterviewContent />
    </Suspense>
  );
}
