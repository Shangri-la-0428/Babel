import { beforeEach, describe, expect, it } from "vitest";
import {
  createSettingsProfile,
  hasConfiguredModel,
  hasSeenModelSetupReminder,
  loadSettings,
  loadSettingsProfiles,
  markModelSetupReminderSeen,
  resetModelSetupReminder,
  saveSettings,
  saveSettingsProfiles,
} from "@/lib/api";

describe("settings profile storage", () => {
  beforeEach(() => {
    localStorage.clear();
    resetModelSetupReminder();
  });

  it("migrates legacy single-profile settings into the new store", () => {
    localStorage.setItem("babel_settings", JSON.stringify({
      apiKey: "sk-legacy",
      apiBase: "https://api.x.ai/v1",
      model: "grok-2-latest",
      tickDelay: 1.5,
    }));

    const store = loadSettingsProfiles();

    expect(store.profiles).toHaveLength(1);
    expect(store.profiles[0].name).toBe("Default");
    expect(loadSettings()).toMatchObject({
      apiKey: "sk-legacy",
      apiBase: "https://api.x.ai/v1",
      model: "grok-2-latest",
      tickDelay: 1.5,
    });
  });

  it("persists the active profile and mirrors it to the legacy key", () => {
    const openai = createSettingsProfile({
      name: "OpenAI",
      apiKey: "sk-openai",
      apiBase: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      tickDelay: 3,
    });
    const grok = createSettingsProfile({
      name: "Grok",
      apiKey: "sk-grok",
      apiBase: "https://api.x.ai/v1",
      model: "grok-3-beta",
      tickDelay: 1,
    });

    saveSettingsProfiles({
      version: 2,
      activeProfileId: grok.id,
      profiles: [openai, grok],
    });

    const rawStore = JSON.parse(localStorage.getItem("babel_settings_profiles") || "{}");
    const rawLegacy = JSON.parse(localStorage.getItem("babel_settings") || "{}");

    expect(rawStore.profiles).toHaveLength(2);
    expect(rawStore.activeProfileId).toBe(grok.id);
    expect(rawLegacy).toMatchObject({
      apiKey: "sk-grok",
      apiBase: "https://api.x.ai/v1",
      model: "grok-3-beta",
      tickDelay: 1,
    });
  });

  it("updates only the active profile when saving current settings", () => {
    const openai = createSettingsProfile({
      name: "OpenAI",
      apiKey: "sk-openai",
      apiBase: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      tickDelay: 3,
    });
    const grok = createSettingsProfile({
      name: "Grok",
      apiKey: "sk-grok",
      apiBase: "https://api.x.ai/v1",
      model: "grok-3-beta",
      tickDelay: 1,
    });

    saveSettingsProfiles({
      version: 2,
      activeProfileId: grok.id,
      profiles: [openai, grok],
    });

    saveSettings({
      apiKey: "sk-grok-new",
      apiBase: "https://api.x.ai/v1",
      model: "grok-3-fast",
      tickDelay: 2,
    });

    const store = loadSettingsProfiles();
    const savedOpenai = store.profiles.find((profile) => profile.id === openai.id);
    const savedGrok = store.profiles.find((profile) => profile.id === grok.id);

    expect(savedOpenai).toMatchObject({
      apiKey: "sk-openai",
      model: "gpt-4o-mini",
      tickDelay: 3,
    });
    expect(savedGrok).toMatchObject({
      apiKey: "sk-grok-new",
      apiBase: "https://api.x.ai/v1",
      model: "grok-3-fast",
      tickDelay: 2,
    });
  });

  it("persists cached model lists per profile", () => {
    const grok = createSettingsProfile({
      name: "Grok",
      apiKey: "sk-grok",
      apiBase: "https://api.x.ai/v1",
      model: "grok-4-1-fast-reasoning",
      tickDelay: 1,
      cachedModels: ["grok-4-1-fast-reasoning", "grok-4-1-fast-non-reasoning"],
    });

    saveSettingsProfiles({
      version: 2,
      activeProfileId: grok.id,
      profiles: [grok],
    });

    const store = loadSettingsProfiles();
    expect(store.profiles[0].cachedModels).toEqual([
      "grok-4-1-fast-reasoning",
      "grok-4-1-fast-non-reasoning",
    ]);
  });

  it("tracks whether the first model-setup reminder has been shown", () => {
    expect(hasSeenModelSetupReminder()).toBe(false);

    markModelSetupReminderSeen();

    expect(hasSeenModelSetupReminder()).toBe(true);

    resetModelSetupReminder();
    expect(hasSeenModelSetupReminder()).toBe(false);
  });

  it("treats empty API credentials as not ready for simulation", () => {
    expect(hasConfiguredModel({
      apiKey: "",
      apiBase: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      tickDelay: 3,
    })).toBe(false);

    expect(hasConfiguredModel({
      apiKey: "sk-live",
      apiBase: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      tickDelay: 3,
    })).toBe(true);
  });
});
