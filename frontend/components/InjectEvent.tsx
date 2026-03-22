"use client";

import { useState } from "react";
import { injectEvent } from "@/lib/api";

interface InjectEventProps {
  sessionId: string;
  disabled?: boolean;
}

export default function InjectEvent({ sessionId, disabled }: InjectEventProps) {
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!content.trim() || sending) return;

    setSending(true);
    try {
      await injectEvent(sessionId, content.trim());
      setContent("");
    } catch {
      // Silently fail — event feed will show if it worked
    } finally {
      setSending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2 px-4 py-3 border-t border-b-DEFAULT bg-surface-1">
      <input
        type="text"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Inject world event..."
        disabled={disabled || sending}
        className="flex-1 h-9 px-3 bg-void border border-b-DEFAULT text-detail text-white normal-case tracking-normal focus:border-primary focus:outline-none hover:border-b-hover transition-colors disabled:opacity-30"
      />
      <button
        type="submit"
        disabled={disabled || sending || !content.trim()}
        className="h-9 px-4 text-micro tracking-wider border border-b-DEFAULT text-t-muted hover:border-primary hover:text-primary transition-colors disabled:opacity-30 disabled:pointer-events-none"
      >
        {sending ? "..." : "Inject"}
      </button>
    </form>
  );
}
