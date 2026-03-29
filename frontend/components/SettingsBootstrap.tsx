"use client";

import { useEffect } from "react";
import { loadSettingsProfiles } from "@/lib/api";

export default function SettingsBootstrap() {
  useEffect(() => {
    loadSettingsProfiles();
  }, []);

  return null;
}
