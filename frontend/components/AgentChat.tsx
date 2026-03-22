"use client";

import { useState, useRef, useEffect } from "react";
import { chatWithAgent, BabelSettings } from "@/lib/api";

interface ChatMessage {
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
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [messages]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userMsg = input.trim();
    setInput("");
    setMessages((prev) => [...prev, { role: "user", text: userMsg }]);
    setLoading(true);

    try {
      const res = await chatWithAgent(sessionId, agentId, userMsg, {
        model: settings.model || undefined,
        api_key: settings.apiKey || undefined,
        api_base: settings.apiBase || undefined,
      });
      setMessages((prev) => [...prev, { role: "agent", text: res.reply }]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "agent", text: "[Failed to get response]" },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center bg-overlay">
      <div className="w-full max-w-lg bg-void border border-b-DEFAULT flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-b-DEFAULT bg-surface-1">
          <span className="text-micro text-t-muted tracking-widest">
            Chat with {agentName}
          </span>
          <button
            onClick={onClose}
            className="text-micro text-t-muted hover:text-white transition-colors tracking-wider"
          >
            Close
          </button>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
          {messages.length === 0 && (
            <div className="text-detail text-t-dim text-center py-8 normal-case tracking-normal">
              Send a message to talk with {agentName} in character.
            </div>
          )}
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`text-detail normal-case tracking-normal leading-relaxed ${
                msg.role === "user"
                  ? "text-t-secondary ml-8 text-right"
                  : "text-white mr-8"
              }`}
            >
              <span className="text-micro tracking-wider text-t-dim block mb-1">
                {msg.role === "user" ? "You" : agentName}
              </span>
              {msg.text}
            </div>
          ))}
          {loading && (
            <div className="text-detail text-t-dim mr-8 normal-case tracking-normal">
              <span className="text-micro tracking-wider block mb-1">{agentName}</span>
              <span className="animate-[blink_1s_step-end_infinite]">Thinking...</span>
            </div>
          )}
        </div>

        {/* Input */}
        <form onSubmit={handleSend} className="flex gap-2 p-4 border-t border-b-DEFAULT">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={`Say something to ${agentName}...`}
            disabled={loading}
            autoFocus
            className="flex-1 h-10 px-3 bg-surface-1 border border-b-DEFAULT text-detail text-white normal-case tracking-normal focus:border-primary focus:outline-none hover:border-b-hover transition-colors disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="h-10 px-5 text-micro tracking-wider bg-primary text-void border border-primary hover:bg-transparent hover:text-primary disabled:opacity-30 disabled:pointer-events-none transition-colors"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
