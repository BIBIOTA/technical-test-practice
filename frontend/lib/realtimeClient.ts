"use client";

import { createAttempt, createClientSecret, getAttemptSummary, getNextQuestion, pollAttemptResult, type NextQuestion } from "./api";
import { ApiError } from "./errors";
import { buildTranscriptionPrompt } from "./transcriptionPrompt";

const DEBUG_TOKEN = process.env.NEXT_PUBLIC_INTERVIEW_TOKEN ?? process.env.INTERVIEW_TOKEN ?? "";

function sendDebugLog(event: string, data: object): void {
  console.log(`[transcript-debug] ${event}`, data);
  void fetch("/api/debug/transcript-log", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${DEBUG_TOKEN}`,
    },
    body: JSON.stringify({ event, data }),
  }).catch(() => {});
}

export interface TranscriptMessage {
  role: "ai" | "user";
  text: string;
  isTyping?: boolean;
}

export interface RealtimeCallbacks {
  onTranscript: (msg: TranscriptMessage) => void;
  onQuestion: (question: { question_id: string; question_text: string; category: string; difficulty: string }) => void;
  onEvalResult: (result: EvaluationSummary) => void;
  onStatusChange: (status: "connecting" | "connected" | "disconnected" | "error") => void;
  onError: (msg: string) => void;
}

interface EvaluationSummary {
  score: number;
  summary: string;
  missing_points: string[];
  next_focus: string[];
  ideal_answer?: string;
}

export class RealtimeClient {
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private micStream: MediaStream | null = null;
  private sessionId: string;
  private mode: string;
  private callbacks: RealtimeCallbacks;
  private currentAttemptId: string | null = null;
  private currentQuestionId: string | null = null;
  private pinnedQuestionId: string | null;
  private initialQuestion: NextQuestion | null;
  private completedUserTranscripts: string[] = [];
  private functionCallBuffers = new Map<string, string>();
  private hasSubmittedAnswer = false;
  private submitCommitAt: number | null = null;
  // Tracks that WE sent response.create, so we can cancel any response the
  // server auto-generates via VAD before the user clicks Submit.
  private pendingResponseCreate = false;

  constructor(
    sessionId: string,
    mode: string,
    callbacks: RealtimeCallbacks,
    options?: { pinnedQuestionId?: string; initialQuestion?: NextQuestion | null }
  ) {
    this.sessionId = sessionId;
    this.mode = mode;
    this.callbacks = callbacks;
    this.pinnedQuestionId = options?.pinnedQuestionId ?? null;
    this.initialQuestion = options?.initialQuestion ?? null;
    this.currentQuestionId = this.initialQuestion?.question_id ?? null;
  }

  async connect(providedStream?: MediaStream): Promise<void> {
    this.callbacks.onStatusChange("connecting");

    sendDebugLog("session_start", {
      sessionId: this.sessionId,
      mode: this.mode,
      initialQuestionId: this.initialQuestion?.question_id ?? null,
    });

    const { client_secret } = await createClientSecret(
      this.sessionId,
      this.pinnedQuestionId ?? undefined,
    );

    this.pc = new RTCPeerConnection();

    // Audio output
    const audioEl = document.createElement("audio");
    audioEl.autoplay = true;
    this.pc.ontrack = (e) => {
      audioEl.srcObject = e.streams[0];
    };

    // Microphone input - reuse provided stream to share mute control with the caller
    this.micStream = providedStream ?? await navigator.mediaDevices.getUserMedia({ audio: true });
    this.micStream.getTracks().forEach((track) => this.pc!.addTrack(track, this.micStream!));

    // Data channel for events
    this.dc = this.pc.createDataChannel("oai-events");
    this.dc.onopen = () => {
      console.log("[RT] data channel open");
      this.callbacks.onStatusChange("connected");
      // gpt-realtime-2025-08-28 defaults to semantic_vad and ignores
      // turn_detection:null (treats it as "use default"). Configure semantic_vad
      // explicitly with create_response:false so VAD detection still works but
      // the model never auto-creates a response — only our sendResponseCreate()
      // calls trigger responses.
      this.sendEvent({
        type: "session.update",
        session: {
          turn_detection: {
            type: "semantic_vad",
            eagerness: "low",
            create_response: false,
            interrupt_response: false,
          },
        },
      });
      if (this.initialQuestion) {
        this.sendEvent({
          type: "conversation.item.create",
          item: {
            type: "message",
            role: "user",
            content: [{
              type: "input_text",
              text: [
                "系統已指定本次 single mode 題目。",
                "請直接朗讀以下題目，不要呼叫 get_next_question，不要自行替換或改寫題目：",
                this.initialQuestion.question_text,
              ].join("\n"),
            }],
          },
        });
      }
      // Kick off the first AI response — gpt-realtime-2025-08-28 does not auto-start
      this.sendResponseCreate();
    };
    this.dc.onmessage = (e) => {
      const evt = JSON.parse(e.data) as Record<string, unknown>;
      console.log("[RT]", evt.type, evt);
      this.handleServerEvent(evt);
    };

    // WebRTC offer/answer
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);

    const sdpRes = await fetch(
      "https://api.openai.com/v1/realtime/calls",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${client_secret}`,
          "Content-Type": "application/sdp",
          "Accept": "application/sdp",
        },
        body: offer.sdp,
      }
    );

    if (!sdpRes.ok) {
      throw new ApiError(sdpRes.status, `HTTP_${sdpRes.status}`, `OpenAI WebRTC error: ${sdpRes.status}`);
    }

    const answer: RTCSessionDescriptionInit = {
      type: "answer",
      sdp: await sdpRes.text(),
    };
    await this.pc.setRemoteDescription(answer);
    // Note: onStatusChange("connected") is now called from dc.onopen after ICE completes
  }

  disconnect(): void {
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.micStream = null;
    this.dc?.close();
    this.pc?.close();
    this.pc = null;
    this.dc = null;
    this.callbacks.onStatusChange("disconnected");
  }

  requestNextQuestion(): void {
    this.sendEvent({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "請繼續下一題" }],
      },
    });
    this.sendResponseCreate();
  }

  submitAnswer(): void {
    if (this.hasSubmittedAnswer) return;
    this.hasSubmittedAnswer = true;
    // Do NOT flush raw transcripts here — the cleaned transcript is surfaced
    // to the UI after createAttempt resolves in mark_answer_completed.
    this.sendEvent({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "（送出答案）" }],
      },
    });
    this.sendEvent({ type: "input_audio_buffer.commit" });
    this.submitCommitAt = Date.now();
    sendDebugLog("submit/commit", {
      sessionId: this.sessionId,
      at: this.submitCommitAt,
      chunksAtCommit: this.completedUserTranscripts.length,
      charsAtCommit: this.completedUserTranscripts.join("").length,
      bufferAtCommit: [...this.completedUserTranscripts],
    });
    this.sendResponseCreate();
  }

  private sendEvent(event: object): void {
    if (this.dc?.readyState === "open") {
      this.dc.send(JSON.stringify(event));
    }
  }

  private sendResponseCreate(): void {
    this.pendingResponseCreate = true;
    this.sendEvent({ type: "response.create" });
  }

  private updateTranscriptionKeywords(keywords: string[]): void {
    const prompt = buildTranscriptionPrompt(keywords);
    this.sendEvent({
      type: "session.update",
      session: {
        audio: {
          input: {
            transcription: {
              model: "gpt-4o-transcribe",
              language: "zh",
              prompt,
            },
          },
        },
      },
    });
  }

  private async handleServerEvent(event: Record<string, unknown>): Promise<void> {
    const type = event.type as string;

    // Guard: cancel any response the server auto-created via VAD before the user
    // clicked Submit. We only allow responses that we explicitly requested via
    // sendResponseCreate() or that follow a user submission.
    if (type === "response.created") {
      if (this.pendingResponseCreate || this.hasSubmittedAnswer) {
        this.pendingResponseCreate = false; // consume the tracked request
      } else {
        // VAD triggered this response without our instruction — cancel immediately.
        this.sendEvent({ type: "response.cancel" });
      }
      return;
    }

    if (type === "response.output_audio_transcript.delta" || type === "response.audio_transcript.delta") {
      const delta = event.delta as string;
      this.callbacks.onTranscript({ role: "ai", text: delta, isTyping: true });
    }

    if (type === "response.output_audio_transcript.done" || type === "response.audio_transcript.done") {
      const transcript = event.transcript as string;
      this.callbacks.onTranscript({ role: "ai", text: transcript });
    }

    if (type === "response.output_text.delta") {
      const delta = event.delta as string;
      this.callbacks.onTranscript({ role: "ai", text: delta, isTyping: true });
    }

    if (type === "response.output_text.done") {
      const text = (event.text ?? event.transcript) as string;
      this.callbacks.onTranscript({ role: "ai", text });
    }

    if (type === "conversation.item.input_audio_transcription.completed") {
      const transcript = event.transcript as string;
      const trimmed = transcript.trim();
      const msSinceCommit = this.submitCommitAt ? Date.now() - this.submitCommitAt : null;
      sendDebugLog("transcription.completed", {
        sessionId: this.sessionId,
        chunkIndex: this.completedUserTranscripts.length,
        text: trimmed,
        chars: trimmed.length,
        msSinceCommit,
      });
      if (trimmed) {
        this.completedUserTranscripts.push(trimmed);
      }
    }

    if (type === "response.function_call_arguments.delta") {
      const callId = event.call_id as string;
      const delta = event.delta as string;
      this.functionCallBuffers.set(callId, (this.functionCallBuffers.get(callId) ?? "") + delta);
    }

    if (type === "response.function_call_arguments.done") {
      const callId = event.call_id as string;
      const accumulated = this.functionCallBuffers.get(callId) ?? (event.arguments as string);
      this.functionCallBuffers.delete(callId);
      await this.handleToolCall({ ...event, arguments: accumulated });
    }
  }

  private async handleToolCall(event: Record<string, unknown>): Promise<void> {
    const callId = event.call_id as string;
    const name = event.name as string;
    const args = JSON.parse((event.arguments as string) || "{}");

    let output: unknown;

    try {
      if (name === "get_next_question") {
        const q = this.initialQuestion ?? (await getNextQuestion(
            this.sessionId,
            args.mode ?? this.mode,
            args.category,
            args.difficulty,
            this.pinnedQuestionId ?? undefined
          ));
        this.pinnedQuestionId = null;
        this.currentQuestionId = q.question_id;
        this.completedUserTranscripts = [];
        this.hasSubmittedAnswer = false;
        this.submitCommitAt = null;
        this.updateTranscriptionKeywords(q.transcription_keywords ?? []);
        if (!this.initialQuestion) {
          this.callbacks.onQuestion({
            question_id: q.question_id,
            question_text: q.question_text,
            category: q.category,
            difficulty: q.difficulty,
          });
        }
        output = q;
      } else if (name === "mark_answer_completed") {
        const localTranscript = this.completedUserTranscripts.join(" ").trim();
        const aiTranscript = String(args.transcript ?? "").trim();
        const transcript = aiTranscript.length > localTranscript.length
          ? aiTranscript
          : (localTranscript || aiTranscript);
        const usingSource = transcript === aiTranscript && aiTranscript.length > 0
          ? (localTranscript.length > 0 ? "ai (longer)" : "ai (only)")
          : "local";
        sendDebugLog("mark_answer_completed", {
          sessionId: this.sessionId,
          msSinceCommit: this.submitCommitAt ? Date.now() - this.submitCommitAt : null,
          localChunks: this.completedUserTranscripts.length,
          localChars: localTranscript.length,
          localText: localTranscript,
          aiChars: aiTranscript.length,
          aiText: aiTranscript,
          using: usingSource,
        });
        const attempt = await createAttempt(
          this.sessionId,
          this.currentQuestionId ?? args.question_id ?? "",
          transcript
        );
        sendDebugLog("backend_response", {
          sessionId: this.sessionId,
          sentChars: transcript.length,
          receivedChars: (attempt.transcript ?? "").length,
          delta: (attempt.transcript ?? "").length - transcript.length,
          sentText: transcript,
          receivedText: attempt.transcript,
        });
        this.currentAttemptId = attempt.attempt_id;
        this.completedUserTranscripts = [];
        this.submitCommitAt = null;
        if (attempt.transcript) {
          this.callbacks.onTranscript({ role: "user", text: attempt.transcript });
        }
        output = attempt;
      } else if (name === "get_evaluation_summary") {
        const attemptId = args.attempt_id ?? this.currentAttemptId;
        if (!attemptId) {
          output = { error: "No attempt_id available" };
        } else {
          const result = await pollAttemptResult(attemptId);
          if (result.status === "completed") {
            const summary = await getAttemptSummary(attemptId);
            this.callbacks.onEvalResult(summary);
            this.callbacks.onTranscript({ role: "ai", text: formatEvaluationFeedback(summary) });
            output = summary;
          } else {
            output = { error: "Evaluation failed" };
          }
        }
      }
    } catch (err) {
      output = { error: String(err) };
      this.callbacks.onError(String(err));
    }

    this.sendEvent({
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: callId,
        output: JSON.stringify(output),
      },
    });

    this.sendResponseCreate();
  }
}

function formatEvaluationFeedback(summary: EvaluationSummary): string {
  const parts = [`評分 ${summary.score} 分。${summary.summary}`];
  if (summary.missing_points.length > 0) {
    parts.push(`可補強：${summary.missing_points.join("、")}`);
  }
  if (summary.next_focus.length > 0) {
    parts.push(`下一步：${summary.next_focus.join("、")}`);
  }
  if (summary.ideal_answer?.trim()) {
    parts.push(`參考答案：${summary.ideal_answer.trim()}`);
  }
  return parts.join("\n");
}
