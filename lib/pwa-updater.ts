import { isCapacitor } from "./native/platform";
import { usePwaUpdateStore } from "./stores/pwa-update";

const CONTROLLER_CHANGE_TIMEOUT_MS = 1500;
const REGISTRATION_READY_TIMEOUT_MS = 1500;

let watchedRegistration: ServiceWorkerRegistration | null = null;

export function isPwaSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext &&
    "serviceWorker" in navigator &&
    !isCapacitor()
  );
}

function markWaitingUpdate(registration: ServiceWorkerRegistration): void {
  if (registration.waiting && navigator.serviceWorker.controller) {
    usePwaUpdateStore.getState().setUpdateAvailable(true);
  }
}

export function watchPwaRegistration(
  registration: ServiceWorkerRegistration,
): void {
  if (watchedRegistration === registration) {
    markWaitingUpdate(registration);
    return;
  }

  watchedRegistration = registration;
  markWaitingUpdate(registration);
  registration.addEventListener("updatefound", () => {
    const worker = registration.installing;
    if (!worker) return;

    worker.addEventListener("statechange", () => {
      if (worker.state === "installed" && navigator.serviceWorker.controller) {
        usePwaUpdateStore.getState().setUpdateAvailable(true);
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

export async function prepareWebUpdate(
  registration?: ServiceWorkerRegistration | null,
): Promise<ServiceWorkerRegistration | null> {
  try {
    const target = registration ?? await getPwaRegistration();
    if (!target) return null;

    watchPwaRegistration(target);
    await target.update();
    markWaitingUpdate(target);
    return target;
  } catch {
    return null;
  }
}

export async function applyWebUpdate(): Promise<void> {
  let registration: ServiceWorkerRegistration | null = null;
  try {
    registration = await getPwaRegistration();
  } catch {
    // The HTML navigation can still pick up the new release without an updated SW.
  }

  const waitingWorker = registration?.waiting;
  if (!waitingWorker) {
    window.location.reload();
    return;
  }

  await new Promise<void>((resolve) => {
    const finish = () => {
      window.clearTimeout(timeoutId);
      navigator.serviceWorker.removeEventListener("controllerchange", finish);
      resolve();
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
  });

  window.location.reload();
}
