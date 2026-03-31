"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  BabelSettings,
  BabelSettingsProfile,
  BabelSettingsStore,
  createSettingsProfile,
  fetchModels,
  loadSettingsProfiles,
  saveSettingsProfiles,
} from "@/lib/api";
import { useLocale } from "@/lib/locale-context";
import { ExpandableInput, StatusDot } from "./ui";

interface SettingsProps {
  onClose: () => void;
  onSave: (settings: BabelSettings) => void;
}

const EXIT_MS = 150;

export default function Settings({ onClose, onSave }: SettingsProps) {
  const { t } = useLocale();
  const initialStoreRef = useRef<BabelSettingsStore>(loadSettingsProfiles());
  const [store, setStore] = useState<BabelSettingsStore>(initialStoreRef.current);
  const [selectedProfileId, setSelectedProfileId] = useState(initialStoreRef.current.activeProfileId);
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [testStatus, setTestStatus] = useState<"idle" | "ok" | "error">("idle");
  const [closing, setClosing] = useState(false);
  const [saved, setSaved] = useState(false);

  const closeTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const selectedProfileIdRef = useRef(selectedProfileId);
  const storeRef = useRef(store);
  useEffect(() => () => clearTimeout(closeTimerRef.current), []);
  useEffect(() => {
    selectedProfileIdRef.current = selectedProfileId;
  }, [selectedProfileId]);
  useEffect(() => {
    storeRef.current = store;
  }, [store]);

  const selectedProfile =
    store.profiles.find((profile) => profile.id === selectedProfileId) || store.profiles[0];
  const isSelectedActive = selectedProfileId === store.activeProfileId;

  const startClose = useCallback(() => {
    if (closing) return;
    setClosing(true);
    closeTimerRef.current = setTimeout(onClose, EXIT_MS);
  }, [closing, onClose]);

  const updateSelectedProfile = useCallback((patch: Partial<BabelSettingsProfile>) => {
    setSaved(false);
    if ("apiBase" in patch || "apiKey" in patch || "model" in patch) {
      setModels([]);
      setTestStatus("idle");
    }
    setStore((prev) => ({
      ...prev,
      profiles: prev.profiles.map((profile) =>
        profile.id === selectedProfileId
          ? { ...profile, ...patch }
          : profile
      ),
    }));
  }, [selectedProfileId]);

  const handleFetchModels = useCallback(async (profile?: BabelSettingsProfile) => {
    const targetProfile =
      profile ||
      storeRef.current.profiles.find((item) => item.id === selectedProfileIdRef.current) ||
      storeRef.current.profiles[0];
    if (!targetProfile?.apiKey || !targetProfile?.apiBase) return;

    setLoadingModels(true);
    setTestStatus("idle");
    try {
      const result = await fetchModels(targetProfile.apiBase, targetProfile.apiKey);
      if (selectedProfileIdRef.current !== targetProfile.id) return;
      setModels(result);
      setTestStatus(result.length > 0 ? "ok" : "error");
      const nextStore: BabelSettingsStore = {
        ...storeRef.current,
        profiles: storeRef.current.profiles.map((profile) =>
          profile.id === targetProfile.id
            ? { ...profile, cachedModels: result }
            : profile
        ),
      };
      storeRef.current = nextStore;
      setStore(nextStore);
      saveSettingsProfiles(nextStore);
    } catch {
      if (selectedProfileIdRef.current === targetProfile.id) {
        setTestStatus("error");
      }
    } finally {
      if (selectedProfileIdRef.current === targetProfile.id) {
        setLoadingModels(false);
      }
    }
  }, []);

  useEffect(() => {
    setModels(selectedProfile.cachedModels || []);
    setTestStatus(selectedProfile.cachedModels?.length ? "ok" : "idle");
    setLoadingModels(false);
  }, [selectedProfileId, selectedProfile.cachedModels]);

  function handleSave() {
    const nextStore: BabelSettingsStore = {
      ...store,
      activeProfileId: selectedProfileId,
    };
    saveSettingsProfiles(nextStore);
    onSave({
      apiKey: selectedProfile.apiKey,
      apiBase: selectedProfile.apiBase,
      model: selectedProfile.model,
      tickDelay: selectedProfile.tickDelay,
    });
    setSaved(true);
    setTimeout(() => startClose(), 300);
  }

  function handleAddProfile() {
    const nextProfile = createSettingsProfile({
      apiKey: "",
      apiBase: "",
      model: "",
      tickDelay: 3,
      cachedModels: [],
      name: `${t("profile_name_default")} ${store.profiles.length + 1}`,
    });
    setStore((prev) => ({
      ...prev,
      profiles: [...prev.profiles, nextProfile],
    }));
    setSelectedProfileId(nextProfile.id);
    setSaved(false);
  }

  function handleDeleteProfile() {
    if (store.profiles.length <= 1) return;

    const currentIndex = store.profiles.findIndex((profile) => profile.id === selectedProfileId);
    const remaining = store.profiles.filter((profile) => profile.id !== selectedProfileId);
    const fallbackProfile = remaining[Math.max(0, currentIndex - 1)] || remaining[0];

    setStore((prev) => ({
      ...prev,
      activeProfileId:
        prev.activeProfileId === selectedProfileId
          ? fallbackProfile.id
          : prev.activeProfileId,
      profiles: remaining,
    }));
    setSelectedProfileId(fallbackProfile.id);
    setSaved(false);
  }

  const inputCls =
    "w-full h-9 px-3 bg-void border border-b-DEFAULT text-detail text-t-DEFAULT focus:border-primary focus:outline-none hover:border-b-hover transition-colors normal-case tracking-normal";
  const labelCls =
    "text-micro text-t-muted tracking-widest block mb-1.5 transition-colors duration-150";
  const groupCls = "group";

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
          <div>
            <span className="text-micro text-t-muted tracking-widest">
              {t("llm_config")}
            </span>
            <p className="mt-1 text-detail text-t-secondary normal-case tracking-normal max-w-3xl">
              {t("profile_help")}
            </p>
          </div>
        <div className="flex items-center gap-2" aria-live="polite">
            {testStatus === "ok" && (
              <span className="text-micro text-primary tracking-wider flex items-center gap-1.5">
                <StatusDot status="primary" />
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

        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-px bg-b-DEFAULT mb-4">
          <div className="bg-void px-4 py-3">
            <div className="text-micro text-t-muted tracking-widest mb-1">
              {t("profile_flow_title")}
            </div>
            <div className="text-detail text-t-secondary normal-case tracking-normal">
              {t("profile_steps")}
            </div>
          </div>
          <div className="bg-void px-4 py-3 flex items-center sm:justify-end">
            <span className={`text-micro tracking-wider flex items-center gap-1.5 ${
              isSelectedActive ? "text-primary" : "text-warning"
            }`}>
              <StatusDot status={isSelectedActive ? "primary" : "warning"} />
              {isSelectedActive ? t("profile_active") : t("profile_activate_pending")}
            </span>
          </div>
        </div>

        {/* Fields */}
        <div className="grid grid-cols-1 sm:grid-cols-[220px_1fr_auto_auto] gap-px bg-b-DEFAULT mb-4">
          <div className={`${groupCls} bg-void p-3`}>
            <label htmlFor="settings-profile-select" className={`${labelCls} group-focus-within:text-primary`}>{t("config_profile")}</label>
            <div className="relative">
              <select
                id="settings-profile-select"
                className={`${inputCls} appearance-none cursor-pointer pr-8`}
                value={selectedProfileId}
                onChange={(e) => {
                  setSelectedProfileId(e.target.value);
                  setSaved(false);
                }}
              >
                {store.profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name}
                  </option>
                ))}
              </select>
              <svg className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-t-muted" width="10" height="6" viewBox="0 0 10 6" fill="currentColor" aria-hidden="true">
                <path d="M0 0l5 6 5-6z" />
              </svg>
            </div>
          </div>
          <div className={`${groupCls} bg-void p-3`}>
            <label htmlFor="settings-profile-name" className={`${labelCls} group-focus-within:text-primary`}>{t("profile_name")}</label>
            <ExpandableInput
              id="settings-profile-name"
              className={inputCls}
              placeholder={t("profile_name")}
              value={selectedProfile.name}
              onValueChange={(value) => updateSelectedProfile({ name: value })}
            />
          </div>
          <div className="bg-void p-3 flex items-end">
            <button
              type="button"
              onClick={handleAddProfile}
              className="h-9 w-full px-4 text-micro font-medium tracking-wider border border-b-DEFAULT text-t-muted hover:bg-surface-1 hover:border-primary hover:text-primary active:scale-[0.97] transition-[colors,transform] whitespace-nowrap"
            >
              {t("new_profile")}
            </button>
          </div>
          <div className="bg-void p-3 flex items-end">
            <button
              type="button"
              onClick={handleDeleteProfile}
              disabled={store.profiles.length <= 1}
              title={store.profiles.length <= 1 ? t("delete_profile_disabled_hint") : undefined}
              className="h-9 w-full px-4 text-micro font-medium tracking-wider border border-b-DEFAULT text-t-muted hover:bg-surface-1 hover:border-danger hover:text-danger active:scale-[0.97] disabled:opacity-30 disabled:cursor-not-allowed transition-[colors,transform] whitespace-nowrap"
            >
              {t("delete_profile")}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_200px] gap-px bg-b-DEFAULT mb-4">
          <div className={`${groupCls} bg-void p-3`}>
            <label htmlFor="settings-api-base" className={`${labelCls} group-focus-within:text-primary`}>{t("api_base_url")}</label>
            <ExpandableInput
              id="settings-api-base"
              className={inputCls}
              placeholder="https://api.openai.com/v1"
              value={selectedProfile.apiBase}
              onValueChange={(value) => updateSelectedProfile({ apiBase: value })}
            />
          </div>
          <div className={`${groupCls} bg-void p-3`}>
            <label htmlFor="settings-api-key" className={`${labelCls} group-focus-within:text-primary`}>{t("api_key")}</label>
            <input
              id="settings-api-key"
              type="password"
              className={inputCls}
              placeholder="sk-..."
              value={selectedProfile.apiKey}
              onChange={(e) => updateSelectedProfile({ apiKey: e.target.value })}
            />
          </div>
          <div className={`${groupCls} bg-void p-3`}>
            <label htmlFor="settings-tick-delay" className={`${labelCls} group-focus-within:text-primary`}>{t("tick_delay")}</label>
            <input
              id="settings-tick-delay"
              type="number"
              min={0.5}
              max={30}
              step={0.5}
              className={inputCls}
              value={selectedProfile.tickDelay}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                updateSelectedProfile({ tickDelay: Number.isFinite(val) ? Math.max(0.5, Math.min(30, val)) : 3 });
              }}
            />
          </div>
        </div>

        {/* Model selector row */}
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-px bg-b-DEFAULT mb-2">
          <div className={`bg-void p-3 ${groupCls}`}>
            <label htmlFor="settings-model" className={`${labelCls} group-focus-within:text-primary`}>{t("model")}</label>
            {models.length > 0 ? (
              <div className="relative">
                <select
                  id="settings-model"
                  className={`${inputCls} appearance-none cursor-pointer pr-8`}
                  value={selectedProfile.model}
                  onChange={(e) => updateSelectedProfile({ model: e.target.value })}
                >
                  {!models.includes(selectedProfile.model) && (
                    <option value={selectedProfile.model}>{selectedProfile.model}</option>
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
              <ExpandableInput
                id="settings-model"
                className={inputCls}
                placeholder="gpt-4o-mini"
                value={selectedProfile.model}
                onValueChange={(value) => updateSelectedProfile({ model: value })}
              />
            )}
          </div>
          <div className="bg-void p-3 flex items-end">
            <button
              type="button"
              onClick={() => void handleFetchModels()}
              disabled={loadingModels || !selectedProfile.apiKey || !selectedProfile.apiBase}
              title={!selectedProfile.apiKey || !selectedProfile.apiBase ? t("fetch_models_disabled_hint") : undefined}
              className="h-9 px-5 text-micro font-medium tracking-wider border border-b-DEFAULT text-t-muted hover:bg-surface-1 hover:border-primary hover:text-primary active:scale-[0.97] disabled:opacity-30 disabled:cursor-not-allowed transition-[colors,transform] whitespace-nowrap"
            >
              {loadingModels ? t("loading") : t("fetch_models")}
            </button>
          </div>
        </div>
        <p className="mb-5 text-detail text-t-dim normal-case tracking-normal">
          {t("fetch_models_help")}
        </p>

        {/* Actions */}
        <div className="flex items-center gap-3 pt-4 border-t border-b-DEFAULT">
          <button
            type="button"
            onClick={handleSave}
            className={`h-9 px-6 text-micro font-medium tracking-wider border active:scale-[0.97] transition-[colors,box-shadow,transform] ${
              saved
                ? "bg-primary/20 text-primary border-primary shadow-[0_0_12px_var(--color-primary-glow)]"
                : "bg-primary text-void border-primary hover:bg-transparent hover:text-primary hover:shadow-[0_0_16px_var(--color-primary-glow-strong)]"
            }`}
          >
            {saved ? t("saved") : t("save_and_activate")}
          </button>
          <button
            type="button"
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
