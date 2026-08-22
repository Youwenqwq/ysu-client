import { isCapacitor } from "./native/platform";
import { STORAGE_KEYS } from "./storage/keys";
import { usePwaUpdateStore } from "./stores/pwa-update";

const CONTROLLER_CHANGE_TIMEOUT_MS = 1500;
const REGISTRATION_READY_TIMEOUT_MS = 1500;
const VERSION_REPLY_TIMEOUT_MS = 1000;
/** Minimum gap between sw.js update checks; every trigger shares this budget. */
export const PWA_UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000;

const LAST_CHECK_KEY = STORAGE_KEYS.pwaLastUpdateCheck;
const DISMISSED_KEY = STORAGE_KEYS.pwaDismissedUpdate;

let watchedRegistration: ServiceWorkerRegistration | null = null;

export function isPwaSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext &&
    "serviceWorker" in navigator &&
    !isCapacitor()
  );
}

/** Ask a worker for its build version. Legacy workers never reply → null. */
function askBuildVersion(worker: ServiceWorker): Promise<string | null> {
  const { promise, resolve } = Promise.withResolvers<string | null>();
  let settled = false;
  const finish = (version: string | null) => {
    if (settled) return;
    settled = true;
    window.clearTimeout(timer);
    resolve(version);
  };
  const channel = new MessageChannel();
  channel.port1.onmessage = (event) => {
    const data: unknown = event.data;
    const version =
      data && typeof data === "object" && "version" in data
        ? data.version
        : null;
    finish(typeof version === "string" ? version : null);
  };
  const timer = window.setTimeout(() => finish(null), VERSION_REPLY_TIMEOUT_MS);
  try {
    worker.postMessage({ type: "GET_VERSION" }, [channel.port2]);
  } catch {
    finish(null);
  }
  return promise;
}

// Build versions end with a build timestamp (see scripts/generate-pwa-shell.mjs).
function buildTimestamp(version: string | null): number {
  if (!version) return 0;
  const match = /-(\d{10,})$/.exec(version);
  return match ? Number(match[1]) : 0;
}

/**
 * Prompt only when the waiting worker is a genuinely newer, non-dismissed
 * build. Stale CDN edge nodes can serve an older sw.js during deploy
 * propagation; the browser installs any byte difference, so without the
 * version comparison the prompt would ping-pong between builds.
 */
async function evaluateRegistration(
  registration: ServiceWorkerRegistration,
): Promise<void> {
  const waiting = registration.waiting;
  const controller = navigator.serviceWorker.controller;
  if (!waiting || !controller) return;

  const [waitingVersion, activeVersion] = await Promise.all([
    askBuildVersion(waiting),
    askBuildVersion(controller),
  ]);
  if (
    waitingVersion &&
    activeVersion &&
    buildTimestamp(waitingVersion) <= buildTimestamp(activeVersion)
  ) {
    return; // same build re-installed, or a downgrade: never an update
  }

  const dismissed = localStorage.getItem(DISMISSED_KEY);
  if (dismissed !== null && dismissed === (waitingVersion ?? "unknown")) {
    return; // user skipped this exact build already
  }

  usePwaUpdateStore.getState().setUpdateAvailable(true);
}

export function watchPwaRegistration(
  registration: ServiceWorkerRegistration,
): void {
  if (watchedRegistration === registration) {
    void evaluateRegistration(registration);
    return;
  }

  watchedRegistration = registration;
  void evaluateRegistration(registration);
  registration.addEventListener("updatefound", () => {
    const worker = registration.installing;
    if (!worker) return;

    worker.addEventListener("statechange", () => {
      if (worker.state === "installed" && navigator.serviceWorker.controller) {
        void evaluateRegistration(registration);
      }
    });
  });
}

export async function getPwaRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!isPwaSupported()) return null;

  const basePath = (process.env.NEXT_PUBLIC_APP_BASE_PATH || "").replace(/\/$/, "");
  const registration = await navigator.serviceWorker.getRegistration(
    new URL(`${basePath}/`, window.location.origin).href,
  );
  if (registration) return registration;

  return Promise.race([
    navigator.serviceWorker.ready.catch(() => null),
    new Promise<null>((resolve) =>
      window.setTimeout(() => resolve(null), REGISTRATION_READY_TIMEOUT_MS),
    ),
  ]);
}

/**
 * Check for a new service worker. Callers may invoke this freely (page load,
 * interval, visibility change); sw.js fetches are throttled to one per
 * PWA_UPDATE_CHECK_INTERVAL_MS so a failing install cannot hammer the CDN.
 */
export async function prepareWebUpdate(
  registration?: ServiceWorkerRegistration | null,
  options?: { force?: boolean },
): Promise<ServiceWorkerRegistration | null> {
  try {
    const target = registration ?? (await getPwaRegistration());
    if (!target) return null;

    watchPwaRegistration(target);

    if (!options?.force) {
      const lastCheck = Number(localStorage.getItem(LAST_CHECK_KEY) || 0);
      if (Date.now() - lastCheck < PWA_UPDATE_CHECK_INTERVAL_MS) {
        return target;
      }
    }
    localStorage.setItem(LAST_CHECK_KEY, String(Date.now()));

    await target.update();
    await evaluateRegistration(target);
    return target;
  } catch {
    return null;
  }
}

/** Hide the prompt and remember this build so it is not offered again. */
export async function dismissWebUpdate(): Promise<void> {
  usePwaUpdateStore.getState().setUpdateAvailable(false);
  let version: string | null = null;
  try {
    const registration = await getPwaRegistration();
    if (registration?.waiting) {
      version = await askBuildVersion(registration.waiting);
    }
  } catch {
    // Fall through and record "unknown".
  }
  try {
    localStorage.setItem(DISMISSED_KEY, version ?? "unknown");
  } catch {
    // Storage unavailable; the in-memory hide still stands for this session.
  }
}

export async function applyWebUpdate(): Promise<void> {
  let registration: ServiceWorkerRegistration | null = null;
  try {
    registration = await getPwaRegistration();
  } catch {
    // The HTML navigation can still pick up the new release without an updated SW.
  }

  try {
    localStorage.removeItem(DISMISSED_KEY);
  } catch {
    // ignore storage errors
  }

  const waitingWorker = registration?.waiting;
  if (!waitingWorker) {
    window.location.reload();
    return;
  }

  const { promise: activated, resolve: finishActivation } =
    Promise.withResolvers<void>();
  const finish = () => {
    window.clearTimeout(timeoutId);
    navigator.serviceWorker.removeEventListener("controllerchange", finish);
    finishActivation();
  };
  navigator.serviceWorker.addEventListener("controllerchange", finish, {
    once: true,
  });
  const timeoutId = window.setTimeout(finish, CONTROLLER_CHANGE_TIMEOUT_MS);
  try {
    waitingWorker.postMessage({ type: "SKIP_WAITING" });
  } catch {
    finish();
  }
  await activated;

  window.location.reload();
}
