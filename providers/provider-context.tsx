"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useSettingsStore } from "@/lib/stores/settings";
import type { AcademicProvider } from "./types";
import { getActiveProvider, setActiveProviderSchool } from "./provider-service";

export interface ProviderContextValue {
  provider: AcademicProvider;
  isReady: boolean;
  error: Error | undefined;
  markProviderInitializing(): void;
  markProviderReady(provider: AcademicProvider): void;
  markProviderError(error: unknown): void;
}

const ProviderContext = createContext<ProviderContextValue | null>(null);

interface ProviderProviderProps {
  children: React.ReactNode;
  schoolId?: string;
}

export function ProviderProvider({ children, schoolId }: ProviderProviderProps) {
  const selectedSchoolId = useSettingsStore((state) => state.schoolId);
  const hasHydrated = useSettingsStore((state) => state.hasHydrated);
  const effectiveSchoolId = schoolId ?? (hasHydrated ? selectedSchoolId : "ysu");
  const [provider, setProvider] = useState<AcademicProvider>(() => getActiveProvider());
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<Error | undefined>();

  useEffect(() => {
    if (!schoolId && !hasHydrated) {
      setIsReady(false);
      setError(undefined);
      return;
    }

    try {
      const nextProvider = setActiveProviderSchool(effectiveSchoolId);
      setProvider(nextProvider);
      setIsReady(false);
      setError(undefined);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      setIsReady(false);
    }
  }, [effectiveSchoolId, hasHydrated, schoolId]);

  const markProviderInitializing = useCallback(() => {
    setIsReady(false);
    setError(undefined);
  }, []);

  const markProviderReady = useCallback((provider: AcademicProvider) => {
    setProvider(provider);
    setIsReady(true);
    setError(undefined);
  }, []);

  const markProviderError = useCallback((error: unknown) => {
    setError(error instanceof Error ? error : new Error(String(error)));
    setIsReady(false);
  }, []);

  const value = useMemo<ProviderContextValue>(
    () => ({
      provider,
      isReady,
      error,
      markProviderInitializing,
      markProviderReady,
      markProviderError,
    }),
    [provider, isReady, error, markProviderInitializing, markProviderReady, markProviderError],
  );

  return <ProviderContext.Provider value={value}>{children}</ProviderContext.Provider>;
}

export function useProviderContext(): ProviderContextValue {
  const ctx = useContext(ProviderContext);
  if (ctx === null) {
    throw new Error("useProviderContext must be used within a ProviderProvider");
  }
  return ctx;
}
