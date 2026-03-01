"use client";

import { FC, useEffect, useState, useCallback, createContext, useContext, useRef } from "react";

// ─── Types ──────────────────────────────────────────────────────────────────

export type ToastType = "error" | "warning" | "success" | "info";

export interface ToastItem {
  id: number;
  type: ToastType;
  title: string;
  message: string;
  suggestion?: string;
  duration?: number; // ms, 0 = manual dismiss
}

interface ToastContextValue {
  addToast: (toast: Omit<ToastItem, "id">) => void;
  removeToast: (id: number) => void;
}

// ─── Context ────────────────────────────────────────────────────────────────

const ToastContext = createContext<ToastContextValue | null>(null);

export const useToast = () => {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be inside <ToastProvider>");
  return ctx;
};

// ─── Provider ───────────────────────────────────────────────────────────────

export const ToastProvider: FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const addToast = useCallback((t: Omit<ToastItem, "id">) => {
    const id = nextId.current++;
    setToasts((prev) => [...prev, { ...t, id }]);
  }, []);

  const removeToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ addToast, removeToast }}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={removeToast} />
    </ToastContext.Provider>
  );
};

// ─── Container ──────────────────────────────────────────────────────────────

const ToastContainer: FC<{ toasts: ToastItem[]; onDismiss: (id: number) => void }> = ({
  toasts,
  onDismiss,
}) => (
  <div className="fixed top-5 right-5 z-[9999] flex flex-col gap-3 max-w-sm w-full pointer-events-none">
    {toasts.map((t) => (
      <ToastCard key={t.id} toast={t} onDismiss={onDismiss} />
    ))}
  </div>
);

// ─── Individual toast card ──────────────────────────────────────────────────

const THEME: Record<ToastType, { border: string; icon: string; iconBg: string; titleColor: string; glow: string }> = {
  error: {
    border: "rgba(239,68,68,0.45)",
    icon: "✕",
    iconBg: "rgba(239,68,68,0.18)",
    titleColor: "#f87171",
    glow: "0 0 30px rgba(239,68,68,0.12)",
  },
  warning: {
    border: "rgba(245,158,11,0.45)",
    icon: "⚠",
    iconBg: "rgba(245,158,11,0.18)",
    titleColor: "#fbbf24",
    glow: "0 0 30px rgba(245,158,11,0.12)",
  },
  success: {
    border: "rgba(34,197,94,0.45)",
    icon: "✓",
    iconBg: "rgba(34,197,94,0.18)",
    titleColor: "#4ade80",
    glow: "0 0 30px rgba(34,197,94,0.12)",
  },
  info: {
    border: "rgba(96,165,250,0.45)",
    icon: "ℹ",
    iconBg: "rgba(96,165,250,0.18)",
    titleColor: "#93c5fd",
    glow: "0 0 30px rgba(96,165,250,0.12)",
  },
};

const ToastCard: FC<{ toast: ToastItem; onDismiss: (id: number) => void }> = ({
  toast,
  onDismiss,
}) => {
  const [exiting, setExiting] = useState(false);
  const theme = THEME[toast.type];
  const duration = toast.duration ?? 8000;

  useEffect(() => {
    if (duration <= 0) return;
    const t = setTimeout(() => setExiting(true), duration);
    return () => clearTimeout(t);
  }, [duration]);

  useEffect(() => {
    if (!exiting) return;
    const t = setTimeout(() => onDismiss(toast.id), 350);
    return () => clearTimeout(t);
  }, [exiting, onDismiss, toast.id]);

  return (
    <div
      className="pointer-events-auto rounded-xl p-4 backdrop-blur-lg transition-all"
      style={{
        background: "rgba(10,10,18,0.92)",
        border: `1px solid ${theme.border}`,
        boxShadow: theme.glow,
        animation: exiting
          ? "toast-out 0.35s ease forwards"
          : "toast-in 0.35s ease forwards",
      }}
    >
      <div className="flex gap-3">
        {/* Icon */}
        <div
          className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold"
          style={{ background: theme.iconBg, color: theme.titleColor }}
        >
          {theme.icon}
        </div>

        <div className="flex-1 min-w-0">
          {/* Title */}
          <p className="text-sm font-bold mb-0.5" style={{ color: theme.titleColor }}>
            {toast.title}
          </p>

          {/* Message */}
          <p className="text-xs text-gray-400 leading-relaxed">{toast.message}</p>

          {/* Suggestion */}
          {toast.suggestion && (
            <div
              className="mt-2 px-2.5 py-1.5 rounded-lg text-xs font-medium"
              style={{
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.08)",
                color: "#d1d5db",
              }}
            >
              💡 {toast.suggestion}
            </div>
          )}
        </div>

        {/* Dismiss */}
        <button
          onClick={() => setExiting(true)}
          className="flex-shrink-0 text-gray-600 hover:text-gray-300 transition-colors text-xs mt-0.5"
        >
          ✕
        </button>
      </div>

      {/* Progress bar */}
      {duration > 0 && (
        <div className="mt-3 h-px rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
          <div
            className="h-full rounded-full"
            style={{
              background: theme.titleColor,
              opacity: 0.5,
              animation: `toast-progress ${duration}ms linear forwards`,
            }}
          />
        </div>
      )}
    </div>
  );
};
