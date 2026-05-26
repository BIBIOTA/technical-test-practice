"use client";

import { createAttempt, createClientSecret, getAttemptSummary, getNextQuestion, pollAttemptResult } from "./api";
import { ApiError } from "./errors";

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
  private completedUserTranscripts: string[] = [];

  constructor(
    sessionId: string,
    mode: string,
    callbacks: RealtimeCallbacks,
    options?: { pinnedQuestionId?: string }
  ) {
    this.sessionId = sessionId;
    this.mode = mode;
    this.callbacks = callbacks;
    this.pinnedQuestionId = options?.pinnedQuestionId ?? null;
  }

  async connect(providedStream?: MediaStream): Promise<void> {
    this.callbacks.onStatusChange("connecting");

    const { client_secret } = await createClientSecret(this.sessionId);

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
      // Kick off the first AI response — gpt-realtime-2025-08-28 does not auto-start
      this.sendEvent({ type: "response.create" });
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

  private sendEvent(event: object): void {
    if (this.dc?.readyState === "open") {
      this.dc.send(JSON.stringify(event));
    }
  }

  private async handleServerEvent(event: Record<string, unknown>): Promise<void> {
    const type = event.type as string;

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

    if (type === "input_audio_buffer.speech_started") {
      this.callbacks.onTranscript({ role: "user", text: "", isTyping: true });
    }

    if (type === "conversation.item.input_audio_transcription.completed") {
      const transcript = event.transcript as string;
      if (transcript.trim()) {
        this.completedUserTranscripts.push(transcript.trim());
        this.callbacks.onTranscript({ role: "user", text: transcript });
      }
    }

    if (type === "response.function_call_arguments.done") {
      await this.handleToolCall(event);
    }
  }

  private async handleToolCall(event: Record<string, unknown>): Promise<void> {
    const callId = event.call_id as string;
    const name = event.name as string;
    const args = JSON.parse((event.arguments as string) || "{}");

    let output: unknown;

    try {
      if (name === "get_next_question") {
        const q = await getNextQuestion(
          this.sessionId,
          args.mode ?? this.mode,
          args.category,
          args.difficulty,
          this.pinnedQuestionId ?? undefined
        );
        this.pinnedQuestionId = null;
        this.currentQuestionId = q.question_id;
        this.completedUserTranscripts = [];
        this.callbacks.onQuestion({
          question_id: q.question_id,
          question_text: q.question_text,
          category: q.category,
          difficulty: q.difficulty,
        });
        output = q;
      } else if (name === "mark_answer_completed") {
        const capturedTranscript = this.completedUserTranscripts.join(" ").trim();
        const transcript = capturedTranscript || String(args.transcript ?? "").trim();
        const attempt = await createAttempt(
          this.sessionId,
          args.question_id ?? this.currentQuestionId ?? "",
          transcript
        );
        this.currentAttemptId = attempt.attempt_id;
        this.completedUserTranscripts = [];
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

    this.sendEvent({ type: "response.create" });
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
