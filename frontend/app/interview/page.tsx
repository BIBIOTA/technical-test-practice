"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import EvalResultCard from "../../components/EvalResultCard";
import ErrorOverlay from "../../components/ErrorOverlay";
import InterviewRoom from "../../components/InterviewRoom";
import TranscriptPanel from "../../components/TranscriptPanel";
import { completeSession, createAttempt, getAttemptSummary, pollAttemptResult, type EvaluationResult, type NextQuestion } from "../../lib/api";
import { parseConnectionError, type ParsedError } from "../../lib/errors";
import { RealtimeClient, type TranscriptMessage } from "../../lib/realtimeClient";

type Tab = "transcript" | "eval";
type MicStatus = "idle" | "requesting" | "granted" | "denied";

interface ToastError extends ParsedError {
  severity: "warning" | "error";
}

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
  const [micStream, setMicStream] = useState<MediaStream | null>(null);
  const [isMuted, setIsMuted] = useState(true);
  const [connectionStatus, setConnectionStatus] = useState<string>("disconnected");
  const [fatalError, setFatalError] = useState<(ParsedError & { isNetwork: boolean }) | null>(null);
  const [toastError, setToastError] = useState<ToastError | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Sync mute state to mic stream tracks
  useEffect(() => {
    micStream?.getTracks().forEach((t) => { t.enabled = !isMuted; });
  }, [isMuted, micStream]);

  // Timer
  useEffect(() => {
    const interval = setInterval(() => setElapsedSeconds((s) => s + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  // Auto-dismiss toast after 8 000 ms
  useEffect(() => {
    if (!toastError) return;
    const timer = setTimeout(() => setToastError(null), 8000);
    return () => clearTimeout(timer);
  }, [toastError]);

  function handleMuteToggle() {
    setIsMuted((v) => !v);
  }

  // Request mic and connect
  async function startSession() {
    setMicStatus("requesting");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Apply current mute state to tracks before adding to peer connection
      stream.getTracks().forEach((t) => { t.enabled = !isMuted; });
      setMicStream(stream);
      setMicStatus("granted");
    } catch {
      setMicStatus("denied");
      return;
    }

    const client = new RealtimeClient(sessionId, mode, {
      onTranscript: (msg) => setTranscripts((prev) => {
        if (msg.isTyping) {
          // Replace any existing typing indicator for the same role to avoid accumulation
          return [...prev.filter((m) => !(m.role === msg.role && m.isTyping)), msg];
        }
        // Completed message: remove typing indicators for this role, then append
        return [...prev.filter((m) => !(m.role === msg.role && m.isTyping)), msg];
      }),
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
      onError: (msg) => {
        const parsed = parseConnectionError(new Error(msg));
        setToastError({ ...parsed, severity: "warning" });
      },
    });

    clientRef.current = client;
    try {
      await client.connect(stream);
    } catch (err) {
      const parsed = parseConnectionError(err);
      setFatalError({ ...parsed, isNetwork: err instanceof TypeError });
      setConnectionStatus("error");
    }
  }

  async function handleEndSession() {
    clientRef.current?.disconnect();
    micStream?.getTracks().forEach((t) => t.stop());
    setMicStream(null);
    await completeSession(sessionId).catch(() => {});
    router.push("/");
  }

  function handleNextQuestion() {
    setIsCompleted(false);
    setEvalResult(null);
    setAnswerSummary("");
    setActiveTab("transcript");
  }

  async function handleSubmitAnswer() {
    if (!currentQuestion || isSubmitting) return;
    setIsSubmitting(true);
    const userTranscript = transcripts
      .filter((m) => m.role === "user" && !m.isTyping)
      .map((m) => m.text)
      .join(" ");
    try {
      const attempt = await createAttempt(sessionId, currentQuestion.question_id, userTranscript);
      const result = await pollAttemptResult(attempt.attempt_id);
      if (result.status === "completed") {
        const summary = await getAttemptSummary(attempt.attempt_id);
        setEvalResult(summary as EvaluationResult);
        setAnswerSummary(summary.summary);
        setIsCompleted(true);
        setActiveTab("eval");
      } else {
        throw new Error("Evaluation failed");
      }
    } catch (err) {
      const parsed = parseConnectionError(err);
      setToastError({ ...parsed, severity: "error" });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col h-screen" style={{ background: "var(--color-bg)" }}>
      {/* Fatal error overlay */}
      {fatalError && (
        <ErrorOverlay
          title={fatalError.title}
          message={fatalError.message}
          isNetwork={fatalError.isNetwork}
          onRetry={() => { setFatalError(null); startSession(); }}
          onGoHome={() => router.push("/")}
        />
      )}

      {/* Toast */}
      {toastError && (
        <div
          className="fixed z-50 flex items-start gap-3 rounded-xl shadow-lg"
          style={{
            top: 24,
            right: 24,
            background: "var(--color-surface)",
            border: "1px solid var(--color-border)",
            maxWidth: 360,
            overflow: "hidden",
          }}
        >
          <div
            className="w-1 self-stretch flex-shrink-0"
            style={{ background: toastError.severity === "warning" ? "#F59E0B" : "#F04444" }}
          />
          <div className="flex items-start gap-3 p-4 pr-5">
            <div
              className="w-5 h-5 rounded-full flex-shrink-0 mt-0.5 flex items-center justify-center"
              style={{ background: `${toastError.severity === "warning" ? "#F59E0B" : "#F04444"}26` }}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path
                  d="M6 1.5a4.5 4.5 0 100 9 4.5 4.5 0 000-9zM6 8.25a.75.75 0 110-1.5.75.75 0 010 1.5zm.5-3.25a.5.5 0 01-1 0V3.5a.5.5 0 011 0V5z"
                  fill={toastError.severity === "warning" ? "#F59E0B" : "#F04444"}
                />
              </svg>
            </div>
            <div className="flex flex-col gap-1 flex-1">
              <p className="text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>
                {toastError.title}
              </p>
              <p className="text-xs leading-relaxed" style={{ color: "var(--color-text-secondary)" }}>
                {toastError.message}
              </p>
            </div>
            <button
              onClick={() => setToastError(null)}
              className="text-xs flex-shrink-0 mt-0.5"
              style={{ color: "var(--color-text-secondary)" }}
            >
              ×
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
            stream={micStream}
            currentQuestion={currentQuestion}
            questionIndex={questionIndex}
            totalQuestions={0}
            isCompleted={isCompleted}
            answerSummary={answerSummary}
            onEndSession={handleEndSession}
            onNextQuestion={handleNextQuestion}
            onStartSession={startSession}
            elapsedSeconds={elapsedSeconds}
            mode={mode}
            evalProvider={provider}
            isMuted={isMuted}
            onMuteToggle={handleMuteToggle}
            transcripts={transcripts}
            micStatus={micStatus}
            onSubmitAnswer={handleSubmitAnswer}
            isSubmitting={isSubmitting}
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
