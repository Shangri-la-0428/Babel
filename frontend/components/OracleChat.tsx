"use client";

import { useState, type RefObject } from "react";
import { OracleMessage } from "@/lib/api";
import { DecodeText } from "./ui";
import OracleSeedCard from "./OracleSeedCard";

type OracleMode = "narrate" | "create";

const SUGGESTIONS = [
  "oracle_suggest_summary",
  "oracle_suggest_tension",
  "oracle_suggest_inject",
  "oracle_suggest_predict",
] as const;

function isExpandableMessage(text: string): boolean {
  return text.length > 280 || text.split("\n").length > 6;
}

interface OracleChatProps {
  messages: OracleMessage[];
  loading: boolean;
  error: string | null;
  mode: OracleMode;
  historyLoaded: boolean;
  latestMsgId: string | null;
  generatedSeed: Record<string, unknown> | null;
  creatingSeed: boolean;
  scrollRef: RefObject<HTMLDivElement>;
  onSend: (text?: string) => void;
  onDismissError: () => void;
  onPrimaryAction: () => void;
  primaryActionLabel: string;
  t: (key: string, ...args: string[]) => string;
}

export default function OracleChat({
  messages,
  loading,
  error,
  mode,
  historyLoaded,
  latestMsgId,
  generatedSeed,
  creatingSeed,
  scrollRef,
  onSend,
  onDismissError,
  onPrimaryAction,
  primaryActionLabel,
  t,
}: OracleChatProps) {
  const [expandedMessages, setExpandedMessages] = useState<Record<string, boolean>>({});

  function toggleMessage(id: string) {
    setExpandedMessages((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  }

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto p-4 flex flex-col gap-4 relative z-[1]" aria-live={historyLoaded ? "polite" : "off"} aria-relevant="additions">
      {messages.length === 0 && !loading && (
        <div className="flex flex-col items-center justify-center h-full gap-5">
          {/* Signal lock label — flanked by gradient rules */}
          <div className="flex items-center gap-3 w-full max-w-[320px] opacity-0 animate-fade-in">
            <div className="flex-1 h-px bg-gradient-to-r from-transparent to-info/20" />
            <div className="text-detail text-info tracking-widest drop-shadow-[0_0_16px_rgba(14,165,233,0.45)]">
              {mode === "create" ? t("oracle_mode_create") : t("oracle_label")}
            </div>
            <div className="flex-1 h-px bg-gradient-to-r from-info/20 to-transparent" />
          </div>
          <div className="text-detail text-t-muted text-center normal-case tracking-normal max-w-[300px] opacity-0 animate-[fade-in_300ms_ease_80ms_both]">
            {mode === "create" ? t("oracle_create_empty") : t("oracle_empty")}
          </div>
          {/* Suggestion chips — only in narrate mode */}
          {mode === "narrate" && (
            <div className="flex flex-wrap justify-center gap-2 mt-1">
              {SUGGESTIONS.map((key, i) => (
                <button
                  type="button"
                  key={key}
                  onClick={() => onSend(t(key))}
                  style={{ animationDelay: `${160 + i * 60}ms` }}
                  className="text-micro tracking-wider px-3 py-2 border border-info/20 text-t-muted hover:border-info/40 hover:text-info hover:bg-info/[0.04] active:scale-[0.97] transition-[colors,transform] opacity-0 animate-[fade-in_200ms_ease_both]"
                >
                  {t(key)}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {messages.map((msg) => (
        (() => {
          const canExpand = isExpandableMessage(msg.content);
          const expanded = !!expandedMessages[msg.id];
          return (
            <div
              key={msg.id}
              className={
                msg.role === "user"
                  ? "ml-10 text-right animate-oracle-slide-right"
                  : "mr-4 border-l-2 border-l-info/30 pl-3 pr-2 py-1 bg-info/[0.05] animate-oracle-chromatic-in relative overflow-hidden"
              }
            >
              {msg.id === latestMsgId && msg.role !== "user" && (
                <span className="absolute inset-0 bg-gradient-to-r from-transparent via-info/10 to-transparent bg-[length:200%_100%] animate-[boot-sweep_600ms_cubic-bezier(0.16,1,0.3,1)_both] pointer-events-none" aria-hidden="true" />
              )}
              <span className={`text-micro tracking-wider block mb-1 ${
                msg.role === "user" ? "text-t-dim" : "text-info"
              }`}>
                {msg.role === "user" ? t("you") : t("oracle")}
              </span>
              <div className={`text-detail normal-case tracking-normal leading-relaxed whitespace-pre-wrap break-words ${
                msg.role === "user" ? "text-t-secondary" : "text-t-DEFAULT"
              } ${
                canExpand && !expanded ? "line-clamp-6" : ""
              }`}>
                {msg.id === latestMsgId ? (
                  <DecodeText text={msg.content} />
                ) : (
                  msg.content
                )}
              </div>
              {canExpand && (
                <button
                  type="button"
                  onClick={() => toggleMessage(msg.id)}
                  className={`mt-2 text-micro tracking-wider transition-colors ${
                    msg.role === "user"
                      ? "text-t-dim hover:text-t-secondary"
                      : "text-info/70 hover:text-info"
                  }`}
                >
                  {expanded ? t("collapse") : t("expand")}
                </button>
              )}
            </div>
          );
        })()
      ))}

      {/* Seed preview card — shown when creative mode generates a seed */}
      {generatedSeed && mode === "create" && (
        <OracleSeedCard
          seed={generatedSeed}
          onPrimaryAction={onPrimaryAction}
          primaryActionLabel={primaryActionLabel}
          actionPending={creatingSeed}
          t={t}
        />
      )}

      {loading && (
        <div className="mr-4 border-l-2 border-l-info/30 pl-3 pr-2 py-1 bg-info/[0.05] animate-oracle-slide-left">
          <span className="text-micro tracking-wider text-info block mb-1">{t("oracle")}</span>
          <span className="text-detail text-info/50 normal-case tracking-normal bg-gradient-to-r from-info/[0.06] via-info/[0.12] to-info/[0.06] bg-[length:200%_100%] animate-shimmer inline-block px-2 py-0.5">
            {t("oracle_thinking")}
          </span>
        </div>
      )}

      {error && (
        <div className="text-micro text-danger tracking-wider px-3 py-2 border border-danger animate-slide-down flex items-start gap-2">
          <span className="flex-1 min-w-0 whitespace-pre-wrap break-words">{error}</span>
          <button
            type="button"
            onClick={onDismissError}
            className="text-danger/50 hover:text-danger transition-colors shrink-0 leading-none min-w-[36px] min-h-[36px] flex items-center justify-center -mr-2 -my-1"
            aria-label={t("close")}
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
