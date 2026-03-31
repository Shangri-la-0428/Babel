"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { chatWithAgent, BabelSettings } from "@/lib/api";
import { useLocale } from "@/lib/locale-context";
import Modal from "./Modal";
import { ExpandableInput } from "./ui";

interface ChatMessage {
  id: number;
  role: "user" | "agent";
  text: string;
}

interface AgentChatProps {
  sessionId: string;
  agentId: string;
  agentName: string;
  settings: BabelSettings;
  onClose: () => void;
}

export default function AgentChat({
  sessionId,
  agentId,
  agentName,
  settings,
  onClose,
}: AgentChatProps) {
  const { t, locale } = useLocale();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const msgCounter = useRef(0);

  useEffect(() => {
    // Defer scroll to after browser paint so scrollHeight includes new content
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, [messages]);

  const handleSend = useCallback(async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || loading) return;

    const userMsg = input.trim();
    setInput("");
    setMessages((prev) => [...prev, { id: ++msgCounter.current, role: "user", text: userMsg }]);
    setLoading(true);

    try {
      const res = await chatWithAgent(sessionId, agentId, userMsg, {
        model: settings.model || undefined,
        api_key: settings.apiKey || undefined,
        api_base: settings.apiBase || undefined,
        language: locale,
      });
      setMessages((prev) => [...prev, { id: ++msgCounter.current, role: "agent", text: res.reply || "..." }]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { id: ++msgCounter.current, role: "agent", text: `[${t("chat_failed")}]` },
      ]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, sessionId, agentId, settings, t, locale]);

  return (
    <Modal onClose={onClose} ariaLabel={t("chat_with", agentName)}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-b-DEFAULT bg-surface-1 shrink-0">
        <span className="text-micro text-t-muted tracking-widest">
          {t("chat_with", agentName)}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="text-micro text-t-muted hover:text-t-DEFAULT transition-colors tracking-wider"
          aria-label={t("close")}
        >
          {t("close")}
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 flex flex-col gap-3" aria-live="polite" aria-relevant="additions">
        {messages.length === 0 && (
          <div className="text-detail text-t-dim text-center py-8 normal-case tracking-normal">
            {t("chat_empty", agentName)}
          </div>
        )}
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`text-detail normal-case tracking-normal leading-relaxed animate-[fade-in_200ms_ease] ${
              msg.role === "user"
                ? "text-t-secondary ml-8 text-right"
                : "text-t-DEFAULT mr-8"
            }`}
          >
            <span className="text-micro tracking-wider text-t-dim block mb-1 truncate">
              {msg.role === "user" ? t("you") : agentName}
            </span>
            <span className="break-words">{msg.text}</span>
          </div>
        ))}
        {loading && (
          <div className="text-detail text-t-dim mr-8 normal-case tracking-normal">
            <span className="text-micro tracking-wider block mb-1 truncate">{agentName}</span>
            <span className="animate-[blink_1s_step-end_infinite]">{t("thinking")}</span>
          </div>
        )}
      </div>

      {/* Input */}
      <form onSubmit={handleSend} className="flex items-end gap-2 p-4 border-t border-b-DEFAULT shrink-0">
        <ExpandableInput
          value={input}
          onValueChange={setInput}
          placeholder={t("chat_placeholder", agentName)}
          maxLength={2000}
          disabled={loading}
          autoFocus
          aria-label={t("chat_placeholder", agentName)}
          className="flex-1 h-9 px-3 bg-void border border-b-DEFAULT text-detail text-t-DEFAULT normal-case tracking-normal focus:border-primary focus:outline-none hover:border-b-hover transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void handleSend();
            }
          }}
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="h-9 px-5 text-micro font-medium tracking-wider bg-primary text-void border border-primary hover:bg-transparent hover:text-primary hover:shadow-[0_0_16px_var(--color-primary-glow-strong)] active:scale-[0.97] disabled:opacity-30 disabled:cursor-not-allowed disabled:pointer-events-none transition-[colors,box-shadow,transform] shrink-0"
        >
          {t("send")}
        </button>
      </form>
    </Modal>
  );
}
