"use client"

import { useEffect, useId, useRef, useState } from "react"
import type { ChangeEvent } from "react"
import type { Html5Qrcode } from "html5-qrcode"
import { Image as ImageIcon } from "lucide-react"
import { Button } from "@orahako/plugin-ui/components"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@orahako/plugin-ui/components"
import { parsePerlicaCode } from "../extras/scan"
import { usePluginTranslation } from "@orahako/plugin-ui/plugin"
import { PERLICA_PLUGIN_ID } from "../constants"

type QrScanner = Html5Qrcode
type ScannerError = "loadFailed" | "cameraFailed" | "imageFailed" | "invalidCode"

const CAMERA_START_TIMEOUT_MS = 8_000

const ERROR_KEYS: Record<ScannerError, string> = {
  loadFailed: "perlica.scannerLoadFailed",
  cameraFailed: "perlica.scannerCameraFailed",
  imageFailed: "perlica.scannerImageFailed",
  invalidCode: "perlica.scannerInvalidCode",
}

export interface PerlicaScannerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCode: (code: string) => void
}

function stopVideoTracks(container: HTMLDivElement) {
  for (const video of container.querySelectorAll("video")) {
    const stream = video.srcObject
    if (stream instanceof MediaStream) {
      for (const track of stream.getTracks()) track.stop()
    }
    video.srcObject = null
  }
}

async function shutdownScanner(scanner: QrScanner, container: HTMLDivElement) {
  // Stop tracks directly as well as through the library so pending/failed starts cannot leak them.
  stopVideoTracks(container)
  if (scanner.isScanning) {
    try {
      await scanner.stop()
    } catch {
      // The direct track cleanup above also covers an already-stopped or failed scanner.
    }
  }
  try {
    scanner.clear()
  } catch {
    // Clearing an already-cleared scanner is harmless.
  }
  stopVideoTracks(container)
}

export function PerlicaScanner({ open, onOpenChange, onCode }: PerlicaScannerProps) {
  const { t } = usePluginTranslation(PERLICA_PLUGIN_ID)
  const reactId = useId()
  const scannerId = `perlica-scanner-${reactId.replace(/:/g, "")}`
  const [containerElement, setContainerElement] = useState<HTMLDivElement | null>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const fileHandlerRef = useRef<((file: File) => Promise<void>) | null>(null)
  const openRef = useRef(open)
  const onOpenChangeRef = useRef(onOpenChange)
  const onCodeRef = useRef(onCode)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [cameraActive, setCameraActive] = useState(false)
  const [error, setError] = useState<ScannerError | null>(null)

  useEffect(() => {
    openRef.current = open
    onOpenChangeRef.current = onOpenChange
    onCodeRef.current = onCode
  }, [open, onOpenChange, onCode])

  useEffect(() => {
    if (!open || !containerElement) return

    const container: HTMLDivElement = containerElement

    let disposed = false
    let completed = false
    let operationBusy = false
    let cameraRunning = false
    let cameraRequest = 0
    let scanner: QrScanner | null = null

    function setOperationBusy(value: boolean) {
      operationBusy = value
      if (!disposed) setBusy(value)
    }

    async function stopCamera() {
      cameraRequest += 1
      cameraRunning = false
      if (scanner) await shutdownScanner(scanner, container)
      if (!disposed) setCameraActive(false)
    }

    async function startCamera() {
      if (!scanner || disposed || completed || !openRef.current || cameraRunning) return

      const request = ++cameraRequest
      try {
        const startPromise = scanner.start(
          { facingMode: "environment" },
          {
            fps: 10,
            qrbox: (width, height) => {
              const size = Math.floor(Math.min(width, height) * 0.72)
              return { width: size, height: size }
            },
            disableFlip: false,
          },
          (decodedText) => {
            const code = parsePerlicaCode(decodedText)
            if (!code) {
              if (!disposed && !completed) setError("invalidCode")
              return
            }
            void completeCode(code)
          },
          () => {
            // Individual unmatched frames are expected during live scanning.
          }
        )
        const startingScanner = scanner
        // Promise.race() may already have timed out or the plugin may have been
        // disabled. A late camera grant must still stop the original stream.
        void startPromise.then(
          () => {
            if (disposed || completed || !openRef.current || request !== cameraRequest) {
              return shutdownScanner(startingScanner, container)
            }
          },
          () => {}
        )
        const { promise: timeoutPromise, reject: rejectTimeout } = Promise.withResolvers<never>()
        const timeoutId = window.setTimeout(
          () => rejectTimeout(new Error("Camera start timed out")),
          CAMERA_START_TIMEOUT_MS
        )
        try {
          await Promise.race([startPromise, timeoutPromise])
        } finally {
          window.clearTimeout(timeoutId)
        }

        if (disposed || completed || !openRef.current || request !== cameraRequest) {
          await shutdownScanner(scanner, container)
          return
        }

        cameraRunning = true
        setCameraActive(true)
      } catch {
        stopVideoTracks(container)
        if (!disposed && request === cameraRequest) {
          cameraRequest += 1
          cameraRunning = false
          setCameraActive(false)
          setError("cameraFailed")
        }
      }
    }

    async function completeCode(code: string) {
      if (disposed || completed || !openRef.current) return

      completed = true
      setOperationBusy(true)
      cameraRequest += 1
      cameraRunning = false
      if (scanner) await shutdownScanner(scanner, container)
      if (disposed || !openRef.current) return

      setCameraActive(false)
      onCodeRef.current(code)
      onOpenChangeRef.current(false)
    }

    fileHandlerRef.current = async (file) => {
      if (!scanner || disposed || completed || operationBusy) return

      setOperationBusy(true)
      setError(null)
      try {
        await stopCamera()
        if (disposed || completed || !openRef.current) return

        const decodedText = await scanner.scanFile(file, false)
        if (disposed || completed || !openRef.current) return

        const code = parsePerlicaCode(decodedText)
        if (!code) {
          setError("invalidCode")
          return
        }
        await completeCode(code)
      } catch {
        if (!disposed && !completed) setError("imageFailed")
      } finally {
        if (!disposed) {
          if (!completed && openRef.current) await startCamera()
          setOperationBusy(false)
        }
      }
    }

    async function initialize() {
      setReady(false)
      setCameraActive(false)
      setError(null)
      setOperationBusy(true)

      try {
        // Keep the QR implementation out of the initial bundle and load it only for an open dialog.
        const { Html5Qrcode } = await import("html5-qrcode")
        if (disposed || !openRef.current) return

        scanner = new Html5Qrcode(scannerId, { verbose: false })
        setReady(true)
        await startCamera()
      } catch {
        if (!disposed) setError("loadFailed")
      } finally {
        setOperationBusy(false)
      }
    }

    void initialize()

    return () => {
      disposed = true
      cameraRequest += 1
      cameraRunning = false
      fileHandlerRef.current = null
      if (scanner) void shutdownScanner(scanner, container)
      else stopVideoTracks(container)
    }
  }, [open, scannerId, containerElement])

  function handleFileInput(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (file) void fileHandlerRef.current?.(file)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="fixed inset-0! top-0! left-0! flex h-dvh! w-screen! max-w-none! translate-x-0! translate-y-0! flex-col gap-0 rounded-none! border-0 bg-black p-0 text-white sm:max-w-none!"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{t("perlica.scannerTitle")}</DialogTitle>
          <DialogDescription>{t("perlica.scannerDescription")}</DialogDescription>
        </DialogHeader>

        <div className="relative min-h-0 flex-1 overflow-hidden bg-black">
          <div
            ref={setContainerElement}
            id={scannerId}
            className="absolute! inset-0 [&_video]:h-full! [&_video]:w-full! [&_video]:object-cover!"
          />
          <div className="pointer-events-none absolute top-1/2 left-1/2 aspect-square w-[min(72vw,20rem)] max-w-[70%] -translate-x-1/2 -translate-y-1/2 rounded-3xl border-2 border-white/90 shadow-[0_0_0_1px_rgb(0_0_0/0.25)]" />
          {!ready && busy ? (
            <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-sm text-white">
              {t("perlica.scannerLoading")}
            </div>
          ) : null}
          {ready && busy && !cameraActive ? (
            <div className="absolute inset-0 flex items-center justify-center bg-black/40 px-8 text-center text-sm leading-6 text-white">
              {t("perlica.scannerStarting")}
            </div>
          ) : null}
        </div>

        {error ? (
          <p
            role="alert"
            className="absolute right-24 bottom-[max(1.5rem,env(safe-area-inset-bottom,0px))] left-4 rounded-lg bg-black/75 px-3 py-2 text-sm text-red-200"
          >
            {t(ERROR_KEYS[error])}
          </p>
        ) : null}

        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileInput}
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="absolute right-5 bottom-[max(1.25rem,env(safe-area-inset-bottom,0px))] size-14 rounded-full border-white/30 bg-black/45 text-white shadow-lg backdrop-blur-md hover:bg-black/65 hover:text-white"
          disabled={!ready || busy}
          onClick={() => imageInputRef.current?.click()}
          aria-label={t("perlica.scannerChooseImage")}
          title={t("perlica.scannerChooseImage")}
        >
          <ImageIcon className="size-6" />
        </Button>
      </DialogContent>
    </Dialog>
  )
}
