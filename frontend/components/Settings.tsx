"use client";

import { useEffect, useState, useCallback } from "react";
import {
  BabelSettings,
  loadSettings,
  saveSettings,
  fetchModels,
} from "@/lib/api";
import { useLocale } from "@/lib/locale-context";

interface SettingsProps {
  onClose: () => void;
  onSave: (settings: BabelSettings) => void;
}

const EXIT_MS = 150;

export default function Settings({ onClose, onSave }: SettingsProps) {
  const { t } = useLocale();
  const [settings, setSettings] = useState<BabelSettings>(loadSettings);
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [testStatus, setTestStatus] = useState<"idle" | "ok" | "error">("idle");
  const [closing, setClosing] = useState(false);
  const [saved, setSaved] = useState(false);

  const startClose = useCallback(() => {
    if (closing) return;
    setClosing(true);
    setTimeout(onClose, EXIT_MS);
  }, [closing, onClose]);

  // Load models on mount if key + base exist
  useEffect(() => {
    if (settings.apiKey && settings.apiBase) {
      handleFetchModels();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleFetchModels() {
    if (!settings.apiKey || !settings.apiBase) return;
    setLoadingModels(true);
    setTestStatus("idle");
    try {
      const result = await fetchModels(settings.apiBase, settings.apiKey);
      setModels(result);
      setTestStatus(result.length > 0 ? "ok" : "error");
    } catch {
      setTestStatus("error");
    } finally {
      setLoadingModels(false);
    }
  }

  function handleSave() {
    saveSettings(settings);
    onSave(settings);
    setSaved(true);
    setTimeout(() => startClose(), 300);
  }

  function update(patch: Partial<BabelSettings>) {
    setSettings((prev) => ({ ...prev, ...patch }));
  }

  const inputCls =
    "w-full h-9 px-3 bg-void border border-b-DEFAULT text-detail text-t-DEFAULT focus:border-primary focus:outline-none hover:border-b-hover transition-colors normal-case tracking-normal";
  const labelCls =
    "text-micro text-t-muted tracking-widest block mb-1.5";

  return (
    <div className={`border-b bg-surface-1 overflow-hidden transition-[border-color,box-shadow] duration-300 ${
      saved
        ? "border-primary shadow-[0_0_12px_var(--color-primary-glow-strong)]"
        : "border-b-DEFAULT"
    } ${
      closing
        ? "animate-[panel-slide-up-exit_150ms_ease_both]"
        : "animate-[slide-down_0.15s_ease]"
    }`}>
      <div className="max-w-4xl mx-auto px-6 py-5">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <span className="text-micro text-t-muted tracking-widest">
            {t("llm_config")}
          </span>
          <div className="flex items-center gap-2" aria-live="polite">
            {testStatus === "ok" && (
              <span className="text-micro text-primary tracking-wider flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-primary inline-block" aria-hidden="true" />
                {t("connected_models")} · {models.length}
              </span>
            )}
            {testStatus === "error" && (
              <span className="text-micro text-danger tracking-wider">
                {t("connection_failed")}
              </span>
            )}
          </div>
        </div>

        {/* Fields */}
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_200px] gap-4 mb-4">
          <div>
            <label htmlFor="settings-api-base" className={labelCls}>{t("api_base_url")}</label>
            <input
              id="settings-api-base"
              className={inputCls}
              placeholder="https://api.openai.com/v1"
              value={settings.apiBase}
              onChange={(e) => update({ apiBase: e.target.value })}
            />
          </div>
          <div>
            <label htmlFor="settings-api-key" className={labelCls}>{t("api_key")}</label>
            <input
              id="settings-api-key"
              type="password"
              className={inputCls}
              placeholder="sk-..."
              value={settings.apiKey}
              onChange={(e) => update({ apiKey: e.target.value })}
            />
          </div>
          <div>
            <label htmlFor="settings-tick-delay" className={labelCls}>{t("tick_delay")}</label>
            <input
              id="settings-tick-delay"
              type="number"
              min={0.5}
              max={30}
              step={0.5}
              className={inputCls}
              value={settings.tickDelay}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                update({ tickDelay: Number.isFinite(val) ? Math.max(0.5, Math.min(30, val)) : 3 });
              }}
            />
          </div>
        </div>

        {/* Model selector row */}
        <div className="flex gap-4 items-end mb-5">
          <div className="flex-1">
            <label htmlFor="settings-model" className={labelCls}>{t("model")}</label>
            {models.length > 0 ? (
              <div className="relative">
                <select
                  id="settings-model"
                  className={`${inputCls} appearance-none cursor-pointer pr-8`}
                  value={settings.model}
                  onChange={(e) => update({ model: e.target.value })}
                >
                  {!models.includes(settings.model) && (
                    <option value={settings.model}>{settings.model}</option>
                  )}
                  {models.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
                <svg className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-t-muted" width="10" height="6" viewBox="0 0 10 6" fill="currentColor" aria-hidden="true">
                  <path d="M0 0l5 6 5-6z" />
                </svg>
              </div>
            ) : (
              <input
                id="settings-model"
                className={inputCls}
                placeholder="gpt-4o-mini"
                value={settings.model}
                onChange={(e) => update({ model: e.target.value })}
              />
            )}
          </div>
          <button
            onClick={handleFetchModels}
            disabled={loadingModels || !settings.apiKey || !settings.apiBase}
            className="h-9 px-5 text-micro font-medium tracking-wider border border-b-DEFAULT text-t-muted hover:border-primary hover:text-primary active:scale-[0.97] disabled:opacity-30 transition-[colors,transform] whitespace-nowrap"
          >
            {loadingModels ? t("loading") : t("fetch_models")}
          </button>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 pt-4 border-t border-b-DEFAULT">
          <button
            onClick={handleSave}
            className="h-9 px-6 text-micro font-medium tracking-wider bg-primary text-void border border-primary hover:bg-transparent hover:text-primary hover:shadow-[0_0_16px_var(--color-primary-glow-strong)] active:scale-[0.97] transition-[colors,box-shadow,transform]"
          >
            {t("save")}
          </button>
          <button
            onClick={startClose}
            className="h-9 px-4 text-micro tracking-wider text-t-muted hover:text-t-DEFAULT transition-colors"
          >
            {t("cancel")}
          </button>
          <div className="flex-1" />
        </div>
      </div>
    </div>
  );
}
