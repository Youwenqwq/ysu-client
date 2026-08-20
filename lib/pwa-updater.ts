import { isCapacitor } from "./native/platform";

const CONTROLLER_CHANGE_TIMEOUT_MS = 1500;
const REGISTRATION_READY_TIMEOUT_MS = 1500;

export function isPwaSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext &&
    "serviceWorker" in navigator &&
    !isCapacitor()
  );
}

function getPwaScope(): string {
  const basePath = process.env.NEXT_PUBLIC_APP_BASE_PATH || "";
  const normalizedBasePath = basePath.replace(/\/$/, "");
  return new URL(`${normalizedBasePath}/`, window.location.origin).href;
}

export async function getPwaRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!isPwaSupported()) return null;

  const registration = await navigator.serviceWorker.getRegistration(getPwaScope());
  if (registration) return registration;

  return Promise.race([
    navigator.serviceWorker.ready.catch(() => null),
    new Promise<null>((resolve) =>
      window.setTimeout(() => resolve(null), REGISTRATION_READY_TIMEOUT_MS),
    ),
  ]);
}

export async function prepareWebUpdate(): Promise<ServiceWorkerRegistration | null> {
  try {
    const registration = await getPwaRegistration();
    await registration?.update();
    return registration;
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
