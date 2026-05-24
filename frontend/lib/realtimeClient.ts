"use client";

import { createAttempt, createClientSecret, getAttemptSummary, getNextQuestion, pollAttemptResult } from "./api";

export interface TranscriptMessage {
  role: "ai" | "user";
  text: string;
  isTyping?: boolean;
}

export interface RealtimeCallbacks {
  onTranscript: (msg: TranscriptMessage) => void;
  onQuestion: (question: { question_id: string; question_text: string; category: string; difficulty: string }) => void;
  onEvalResult: (result: { score: number; summary: string; missing_points: string[]; next_focus: string[] }) => void;
  onStatusChange: (status: "connecting" | "connected" | "disconnected" | "error") => void;
  onError: (msg: string) => void;
}

export class RealtimeClient {
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private sessionId: string;
  private mode: string;
  private callbacks: RealtimeCallbacks;
  private currentAttemptId: string | null = null;
  private currentQuestionId: string | null = null;

  constructor(sessionId: string, mode: string, callbacks: RealtimeCallbacks) {
    this.sessionId = sessionId;
    this.mode = mode;
    this.callbacks = callbacks;
  }

  async connect(): Promise<void> {
    this.callbacks.onStatusChange("connecting");

    const { client_secret } = await createClientSecret(this.sessionId);

    this.pc = new RTCPeerConnection();

    // Audio output
    const audioEl = document.createElement("audio");
    audioEl.autoplay = true;
    this.pc.ontrack = (e) => {
      audioEl.srcObject = e.streams[0];
    };

    // Microphone input
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => this.pc!.addTrack(track, stream));

    // Data channel for events
    this.dc = this.pc.createDataChannel("oai-events");
    this.dc.onmessage = (e) => this.handleServerEvent(JSON.parse(e.data));

    // WebRTC offer/answer
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);

    const sdpRes = await fetch(
      "https://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${client_secret}`,
          "Content-Type": "application/sdp",
        },
        body: offer.sdp,
      }
    );

    if (!sdpRes.ok) {
      throw new Error(`OpenAI WebRTC error: ${sdpRes.status}`);
    }

    const answer: RTCSessionDescriptionInit = {
      type: "answer",
      sdp: await sdpRes.text(),
    };
    await this.pc.setRemoteDescription(answer);
    this.callbacks.onStatusChange("connected");
  }

  disconnect(): void {
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

    if (type === "response.audio_transcript.delta") {
      const delta = event.delta as string;
      this.callbacks.onTranscript({ role: "ai", text: delta, isTyping: true });
    }

    if (type === "response.audio_transcript.done") {
      const transcript = event.transcript as string;
      this.callbacks.onTranscript({ role: "ai", text: transcript });
    }

    if (type === "input_audio_buffer.speech_started") {
      this.callbacks.onTranscript({ role: "user", text: "", isTyping: true });
    }

    if (type === "conversation.item.input_audio_transcription.completed") {
      const transcript = event.transcript as string;
      this.callbacks.onTranscript({ role: "user", text: transcript });
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
          args.difficulty
        );
        this.currentQuestionId = q.question_id;
        this.callbacks.onQuestion({
          question_id: q.question_id,
          question_text: q.question_text,
          category: q.category,
          difficulty: q.difficulty,
        });
        output = q;
      } else if (name === "mark_answer_completed") {
        const attempt = await createAttempt(
          this.sessionId,
          args.question_id ?? this.currentQuestionId ?? "",
          args.transcript ?? ""
        );
        this.currentAttemptId = attempt.attempt_id;
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
