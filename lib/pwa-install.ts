export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
}

export interface PwaInstallState {
  deferredPrompt: BeforeInstallPromptEvent | null;
  installed: boolean;
  isIos: boolean;
}

type Listener = () => void;

const listeners = new Set<Listener>();
let initialized = false;
let installedByEvent = false;
let standaloneQuery: MediaQueryList | null = null;
let state: PwaInstallState = {
  deferredPrompt: null,
  installed: false,
  isIos: false,
};

function detectIos(): boolean {
  const { userAgent, platform, maxTouchPoints } = navigator;
  return (
    /iPad|iPhone|iPod/.test(userAgent) ||
    (platform === "MacIntel" && maxTouchPoints > 1)
  );
}

function detectStandalone(): boolean {
  const iosStandalone = (navigator as Navigator & { standalone?: boolean })
    .standalone === true;
  return (standaloneQuery?.matches ?? false) || iosStandalone;
}

function updateState(next: Partial<PwaInstallState>) {
  const updated = { ...state, ...next };
  if (
    updated.deferredPrompt === state.deferredPrompt &&
    updated.installed === state.installed &&
    updated.isIos === state.isIos
  ) {
    return;
  }

  state = updated;
  listeners.forEach((listener) => listener());
}

export function initializePwaInstallCapture(): void {
  if (initialized || typeof window === "undefined") return;
  initialized = true;

  standaloneQuery = window.matchMedia("(display-mode: standalone)");
  updateState({
    installed: detectStandalone(),
    isIos: detectIos(),
  });

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    updateState({ deferredPrompt: event as BeforeInstallPromptEvent });
  });

  window.addEventListener("appinstalled", () => {
    installedByEvent = true;
    updateState({ deferredPrompt: null, installed: true });
  });

  standaloneQuery.addEventListener("change", (event) => {
    updateState({
      installed: event.matches || detectStandalone() || installedByEvent,
    });
  });
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getState(): PwaInstallState {
  return state;
}

export async function prompt(): Promise<
  Awaited<BeforeInstallPromptEvent["userChoice"]> | null
> {
  const deferredPrompt = state.deferredPrompt;
  if (!deferredPrompt) return null;

  try {
    await deferredPrompt.prompt();
    return await deferredPrompt.userChoice;
  } finally {
    if (state.deferredPrompt === deferredPrompt) {
      updateState({ deferredPrompt: null });
    }
  }
}
