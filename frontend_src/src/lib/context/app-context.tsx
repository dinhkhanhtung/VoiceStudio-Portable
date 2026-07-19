"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import { Voice, checkLicenseStatus, fetchVoices, LicenseStatus } from "../api";

export type ViewType = "tts" | "translate" | "library" | "clone" | "history" | "settings";

interface AppContextType {
  license: LicenseStatus | null;
  voices: Voice[];
  selectedVoice: Voice | null;
  setSelectedVoice: (voice: Voice | null) => void;
  isLoadingVoices: boolean;
  activeView: ViewType;
  setActiveView: (view: ViewType) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [license, setLicense] = useState<LicenseStatus | null>(null);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [selectedVoice, setSelectedVoice] = useState<Voice | null>(null);
  const [isLoadingVoices, setIsLoadingVoices] = useState(true);
  const [activeView, setActiveView] = useState<ViewType>("tts");

  useEffect(() => {
    async function loadData() {
      try {
        const lic = await checkLicenseStatus();
        setLicense(lic);
        if (lic.licensed) {
          const v = await fetchVoices();
          setVoices(v);
          if (v.length > 0) setSelectedVoice(v[0]);
        }
      } catch (err) {
        console.error("Failed to load initial data", err);
      } finally {
        setIsLoadingVoices(false);
      }
    }
    loadData();
  }, []);

  return (
    <AppContext.Provider
      value={{
        license,
        voices,
        selectedVoice,
        setSelectedVoice,
        isLoadingVoices,
        activeView,
        setActiveView,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext() {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error("useAppContext must be used within an AppProvider");
  }
  return context;
}
