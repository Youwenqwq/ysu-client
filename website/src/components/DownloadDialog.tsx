import { useState, useEffect } from "react"
import { Download, AlertTriangle, X } from "lucide-react"

interface DownloadDialogProps {
  downloadText: string
  disclaimerTitle: string
  disclaimerContent: string
  agreeText: string
  cancelText: string
}

export default function DownloadDialog({
  downloadText,
  disclaimerTitle,
  disclaimerContent,
  agreeText,
  cancelText,
}: DownloadDialogProps) {
  const [open, setOpen] = useState(false)
  const [visible, setVisible] = useState(false)
  const [animate, setAnimate] = useState(false)

  useEffect(() => {
    if (open) {
      setAnimate(false)
      setVisible(true)
      const timer = setTimeout(() => setAnimate(true), 20)
      return () => clearTimeout(timer)
    } else {
      setAnimate(false)
      const timer = setTimeout(() => setVisible(false), 200)
      return () => clearTimeout(timer)
    }
  }, [open])

  const handleOpen = () => {
    setOpen(true)
  }

  const handleClose = () => {
    setOpen(false)
  }

  const handleAgree = () => {
    setOpen(false)
    window.open("/updates/app-release.apk", "_blank")
  }

  return (
    <>
      <button
        onClick={handleOpen}
        className="inline-flex items-center gap-2 rounded-xl bg-primary px-8 py-4 text-base font-medium text-primary-foreground shadow-lg shadow-primary/25 transition-all hover:scale-105 hover:shadow-xl"
      >
        <Download className="h-5 w-5" />
        {downloadText}
      </button>

      {visible && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className={`absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-200 ${animate ? "opacity-100" : "opacity-0"}`}
            onClick={handleClose}
          />
          <div
            className={`relative w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-2xl transition-all duration-200 ease-out ${animate ? "translate-y-0 scale-100 opacity-100" : "translate-y-2 scale-95 opacity-0"}`}
          >
            <button
              onClick={handleClose}
              className="absolute top-4 right-4 rounded-lg p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 dark:bg-amber-900/40">
                <AlertTriangle className="h-5 w-5 text-amber-700 dark:text-amber-400" />
              </div>
              <h3 className="text-lg font-semibold">{disclaimerTitle}</h3>
            </div>

            <div className="mt-4 max-h-64 overflow-y-auto rounded-xl border border-border bg-muted/50 p-4">
              <p className="text-sm leading-relaxed whitespace-pre-line text-muted-foreground">
                {disclaimerContent}
              </p>
            </div>

            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                onClick={handleClose}
                className="inline-flex items-center justify-center rounded-xl border border-border bg-card px-6 py-3 text-sm font-medium text-card-foreground transition-colors hover:bg-muted"
              >
                {cancelText}
              </button>
              {/* <button
                onClick={handleAgree}
                className="inline-flex items-center justify-center rounded-xl bg-primary px-6 py-3 text-sm font-medium text-primary-foreground shadow-lg shadow-primary/25 transition-all hover:scale-105 hover:shadow-xl"
              >
                <Download className="w-4 h-4 mr-2" />
                {agreeText}
              </button> */}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
