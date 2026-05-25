"use client";

interface ErrorOverlayProps {
  title: string;
  message: string;
  isNetwork: boolean;
  onRetry: () => void;
  onGoHome: () => void;
}

export default function ErrorOverlay({ title, message, isNetwork, onRetry, onGoHome }: ErrorOverlayProps) {
  const iconColor = isNetwork ? "#F59E0B" : "#F04444";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(15,17,23,0.95)" }}
    >
      <div
        className="rounded-2xl p-8 flex flex-col gap-5 items-center text-center max-w-sm w-full mx-4"
        style={{ background: "var(--color-surface)" }}
      >
        {/* Icon */}
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center"
          style={{ background: `${iconColor}26` }}
        >
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
            {isNetwork ? (
              <path
                d="M16 4C9.373 4 4 9.373 4 16s5.373 12 12 12 12-5.373 12-12S22.627 4 16 4zm0 18a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm1-6.5a1 1 0 01-2 0v-5a1 1 0 012 0v5z"
                fill={iconColor}
              />
            ) : (
              <path
                d="M16 4C9.373 4 4 9.373 4 16s5.373 12 12 12 12-5.373 12-12S22.627 4 16 4zm0 18a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm1-6.5a1 1 0 01-2 0v-5a1 1 0 012 0v5z"
                fill={iconColor}
              />
            )}
          </svg>
        </div>

        {/* Status badge */}
        <span
          className="text-xs font-semibold px-3 py-1 rounded-full"
          style={{ background: `${iconColor}26`, color: iconColor }}
        >
          {isNetwork ? "連線錯誤" : "系統錯誤"}
        </span>

        {/* Title + message */}
        <div className="flex flex-col gap-2">
          <h2 className="font-semibold text-xl" style={{ color: "var(--color-text-primary)" }}>
            {title}
          </h2>
          <p className="text-sm leading-relaxed" style={{ color: "var(--color-text-secondary)" }}>
            {message}
          </p>
        </div>

        {/* Divider */}
        <div className="w-full h-px" style={{ background: "var(--color-border)" }} />

        {/* Buttons */}
        <div className="flex gap-3 w-full">
          <button
            onClick={onGoHome}
            className="flex-1 py-3 rounded-xl font-semibold text-sm transition-opacity"
            style={{
              background: "var(--color-surface-elevated)",
              color: "var(--color-text-primary)",
              border: "1px solid var(--color-border)",
            }}
          >
            返回首頁
          </button>
          <button
            onClick={onRetry}
            className="flex-1 py-3 rounded-xl font-semibold text-sm text-white transition-opacity"
            style={{ background: "var(--color-primary)" }}
          >
            重試
          </button>
        </div>
      </div>
    </div>
  );
}
