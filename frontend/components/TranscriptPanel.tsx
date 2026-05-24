"use client";

import { useEffect, useRef } from "react";
import type { TranscriptMessage } from "../lib/realtimeClient";

interface Props {
  messages: TranscriptMessage[];
}

export default function TranscriptPanel({ messages }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div className="flex flex-col gap-4 flex-1 overflow-y-auto pr-1">
      {messages.length === 0 && (
        <p className="text-sm text-center mt-8" style={{ color: "var(--color-text-secondary)" }}>
          對話紀錄將顯示於此...
        </p>
      )}
      {messages.map((msg, i) => (
        <div
          key={i}
          className={`flex items-start gap-2 ${msg.role === "user" ? "flex-row-reverse" : ""}`}
        >
          {msg.role === "ai" && (
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
              style={{ background: "rgba(108,99,255,0.2)", color: "var(--color-primary)" }}
            >
              AI
            </div>
          )}
          <div
            className="max-w-xs px-3 py-2 rounded-xl text-sm leading-relaxed"
            style={
              msg.role === "ai"
                ? { background: "var(--color-surface-elevated)", color: "var(--color-text-primary)" }
                : { background: "rgba(108,99,255,0.2)", color: "var(--color-text-primary)" }
            }
          >
            {msg.isTyping && msg.text === "" ? (
              <span className="opacity-60">●●●</span>
            ) : (
              msg.text
            )}
          </div>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
