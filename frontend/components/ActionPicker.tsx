"use client";

import { useState, useMemo, useCallback } from "react";
import { useLocale } from "@/lib/locale-context";
import type { HumanWaitingContext } from "@/lib/api";

const EXIT_MS = 150;

const ACTION_TYPES = [
  { key: "speak", icon: "\u{1F4AC}", needsTarget: true, needsContent: true, targetType: "agent" },
  { key: "move", icon: "\u2192", needsTarget: true, needsContent: false, targetType: "location" },
  { key: "trade", icon: "\u{1F91D}", needsTarget: true, needsContent: true, targetType: "agent" },
  { key: "use_item", icon: "\u26A1", needsTarget: true, needsContent: false, targetType: "item" },
  { key: "observe", icon: "\u{1F441}", needsTarget: false, needsContent: false },
  { key: "wait", icon: "\u23F8", needsTarget: false, needsContent: false },
] as const;

type ActionKey = typeof ACTION_TYPES[number]["key"];

interface ActionPickerProps {
  context: HumanWaitingContext;
  onSubmit: (actionType: string, target: string, content: string) => void;
  onCancel: () => void;
}

export default function ActionPicker({ context, onSubmit, onCancel }: ActionPickerProps) {
  const { t } = useLocale();
  const [selectedAction, setSelectedAction] = useState<ActionKey | null>(null);
  const [target, setTarget] = useState("");
  const [content, setContent] = useState("");
  const [closing, setClosing] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const startClose = useCallback(() => {
    if (closing) return;
    setClosing(true);
    setTimeout(onCancel, EXIT_MS);
  }, [closing, onCancel]);

  const actionDef = useMemo(
    () => ACTION_TYPES.find((a) => a.key === selectedAction),
    [selectedAction],
  );

  const sameLocAgents = useMemo(
    () => context.visible_agents.filter((a) => a.location === context.location),
    [context],
  );

  const otherLocations = useMemo(
    () => context.reachable_locations.filter((l) => l !== context.location),
    [context],
  );

  function handleSelectAction(key: ActionKey) {
    setSelectedAction(key);
    setTarget("");
    setContent("");
    // Auto-select target if only one option
    const def = ACTION_TYPES.find((a) => a.key === key);
    if (!def || !("targetType" in def)) return;
    if (def.targetType === "agent" && sameLocAgents.length === 1) {
      setTarget(sameLocAgents[0].id);
    } else if (def.targetType === "location" && otherLocations.length === 1) {
      setTarget(otherLocations[0]);
    } else if (def.targetType === "item" && context.inventory.length === 1) {
      setTarget(context.inventory[0]);
    }
  }

  function handleSubmit() {
    if (!selectedAction || submitted) return;
    setSubmitted(true);
    setTimeout(() => onSubmit(selectedAction, target, content), 400);
  }

  const canSubmit = selectedAction && (
    !actionDef?.needsTarget || target
  );

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center pointer-events-none">
      {/* Backdrop */}
      <div
        className={`absolute inset-0 bg-void/60 pointer-events-auto ${
          closing ? "animate-[fade-out_150ms_ease_both]" : "animate-[fade-in_100ms_ease]"
        }`}
        onClick={startClose}
      />

      {/* Panel */}
      <div className={`relative w-full max-w-[720px] mb-16 mx-4 pointer-events-auto ${
        closing
          ? "animate-[modal-exit_150ms_ease_both]"
          : "animate-[slide-up_200ms_cubic-bezier(0.16,1,0.3,1)]"
      }`}>
        <div className="relative border border-b-DEFAULT bg-void overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-b-DEFAULT">
            <div className="flex items-center gap-3">
              <span className="w-2 h-2 bg-primary animate-[pulse-glow_2s_infinite]" />
              <span className="text-micro text-primary tracking-widest font-medium">
                {t("waiting_for_action")}
              </span>
            </div>
            <span className="text-micro text-t-dim tracking-wider">
              {context.agent_name}
            </span>
          </div>

          {/* Context strip */}
          <div className="flex gap-px bg-b-DEFAULT border-b border-b-DEFAULT">
            <div className="flex-1 bg-void px-3 py-2">
              <div className="text-[10px] text-t-dim tracking-widest mb-0.5">{t("you_are_here")}</div>
              <div className="text-detail text-t-secondary normal-case tracking-normal">{context.location}</div>
            </div>
            <div className="flex-1 bg-void px-3 py-2">
              <div className="text-[10px] text-t-dim tracking-widest mb-0.5">{t("your_inventory")}</div>
              <div className="text-detail text-t-secondary normal-case tracking-normal truncate">
                {context.inventory.length > 0 ? context.inventory.join(", ") : "---"}
              </div>
            </div>
            <div className="flex-1 bg-void px-3 py-2">
              <div className="text-[10px] text-t-dim tracking-widest mb-0.5">{t("nearby_agents")}</div>
              <div className="text-detail text-t-secondary normal-case tracking-normal truncate">
                {sameLocAgents.length > 0 ? sameLocAgents.map((a) => a.name).join(", ") : "---"}
              </div>
            </div>
            <div className="flex-1 bg-void px-3 py-2">
              <div className="text-[10px] text-t-dim tracking-widest mb-0.5">{t("reachable")}</div>
              <div className="text-detail text-t-secondary normal-case tracking-normal truncate">
                {otherLocations.length > 0 ? otherLocations.join(", ") : "---"}
              </div>
            </div>
          </div>

          {/* Action grid */}
          <div className="grid grid-cols-6 gap-px bg-b-DEFAULT">
            {ACTION_TYPES.map((action) => {
              const isSelected = selectedAction === action.key;
              const ttype = "targetType" in action ? action.targetType : null;
              const isDisabled =
                (ttype === "agent" && sameLocAgents.length === 0) ||
                (ttype === "location" && otherLocations.length === 0) ||
                (ttype === "item" && context.inventory.length === 0);

              return (
                <button
                  key={action.key}
                  onClick={() => !isDisabled && handleSelectAction(action.key)}
                  disabled={isDisabled}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  aria-label={t(`action_${action.key}` as any)}
                  className={`bg-void py-3 flex flex-col items-center gap-1.5 transition-colors ${
                    isSelected
                      ? "text-primary shadow-[inset_0_-2px_0_var(--color-primary)]"
                      : isDisabled
                      ? "text-t-dim opacity-30 cursor-not-allowed"
                      : "text-t-muted hover:text-t-DEFAULT hover:bg-surface-1"
                  }`}
                >
                  <span className="text-body" aria-hidden="true">{action.icon}</span>
                  <span className="text-[10px] tracking-widest font-medium">
                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                    {t(`action_${action.key}` as any)}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Target & content inputs */}
          {selectedAction && actionDef && (actionDef.needsTarget || actionDef.needsContent) && (
            <div className="flex gap-px bg-b-DEFAULT border-t border-b-DEFAULT">
              {/* Target selector */}
              {actionDef.needsTarget && (
                <div className="flex-1 bg-void px-3 py-2">
                  <label className="text-[10px] text-t-dim tracking-widest mb-1 block">
                    {t("action_target")}
                  </label>
                  <select
                    value={target}
                    onChange={(e) => setTarget(e.target.value)}
                    className="w-full h-9 px-3 bg-void border border-b-DEFAULT text-detail text-t-DEFAULT normal-case tracking-normal focus:border-primary focus:outline-none hover:border-b-hover transition-colors"
                  >
                    <option value="">---</option>
                    {"targetType" in actionDef && actionDef.targetType === "agent" &&
                      sameLocAgents.map((a) => (
                        <option key={a.id} value={a.id}>{a.name}</option>
                      ))}
                    {"targetType" in actionDef && actionDef.targetType === "location" &&
                      otherLocations.map((loc) => (
                        <option key={loc} value={loc}>{loc}</option>
                      ))}
                    {"targetType" in actionDef && actionDef.targetType === "item" &&
                      context.inventory.map((item) => (
                        <option key={item} value={item}>{item}</option>
                      ))}
                  </select>
                </div>
              )}

              {/* Content input */}
              {actionDef.needsContent && (
                <div className="flex-1 bg-void px-3 py-2">
                  <label className="text-[10px] text-t-dim tracking-widest mb-1 block">
                    {t("action_content")}
                  </label>
                  <input
                    type="text"
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    placeholder="..."
                    className="w-full h-9 px-3 bg-void border border-b-DEFAULT text-detail text-t-DEFAULT normal-case tracking-normal focus:border-primary focus:outline-none hover:border-b-hover transition-colors"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && canSubmit) handleSubmit();
                    }}
                  />
                </div>
              )}
            </div>
          )}

          {/* Submit row */}
          <div className="flex items-center gap-2 px-4 py-3">
            <button
              onClick={handleSubmit}
              disabled={!canSubmit || submitted}
              className="h-9 px-6 text-micro tracking-wider font-medium bg-primary text-void border border-primary hover:bg-transparent hover:text-primary hover:shadow-[0_0_16px_var(--color-primary-glow-strong)] active:scale-[0.97] disabled:opacity-30 disabled:hover:bg-primary disabled:hover:text-void disabled:hover:shadow-none transition-[colors,box-shadow,transform]"
            >
              {t("action_submit")}
            </button>
            <button
              onClick={startClose}
              className="h-9 px-4 text-micro tracking-wider border border-b-DEFAULT text-t-muted hover:border-primary hover:text-primary active:scale-[0.97] transition-[colors,transform]"
            >
              {t("action_cancel")}
            </button>
          </div>

          {/* Transmission sweep on submit */}
          {submitted && (
            <span className="absolute inset-0 bg-gradient-to-r from-transparent via-primary/10 to-transparent animate-[transmission-sweep_400ms_cubic-bezier(0.16,1,0.3,1)_both] pointer-events-none" aria-hidden="true" />
          )}
        </div>
      </div>
    </div>
  );
}
