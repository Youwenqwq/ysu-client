import { useState, type ReactNode } from "react"
import type { DerivedComponentProps, ObservableSource, SlotComponentOwner } from "@orahako/sdk"
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
} from "@orahako/ui-primitives"
import type { ActivationDictionary } from "./dictionary"
import type { ActivationStore } from "./store"

declare module "@orahako/sdk" {
  interface SlotMap {
    "shell.gate": { kind: "chain"; owner: Record<string, never> }
  }
}

export interface ActivationGateInject {
  readonly required: boolean
  readonly verifyEndpoint: string
  readonly isNative: boolean
  readonly hooks: {
    readonly hydrated: ObservableSource<boolean>
  }
}

export type ActivationGateProps = DerivedComponentProps<
  SlotComponentOwner<"shell.gate">,
  ActivationDictionary,
  undefined,
  ActivationStore,
  ActivationGateInject
>

export async function verifyActivationToken(
  verifyEndpoint: string,
  token: string,
  fetchImpl: typeof fetch = fetch
): Promise<"ok" | "invalid" | "network"> {
  try {
    const res = await fetchImpl(verifyEndpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    })
    if (res.ok) return "ok"
    if (res.status === 401) return "invalid"
    return "network"
  } catch {
    return "network"
  }
}

export function ActivationGate(props: ActivationGateProps): ReactNode {
  const { t, children, required, verifyEndpoint, isNative, actions, useStore, useHydrated } = props
  const token = useStore((state) => state.token)
  const hydrated = useHydrated()
  const [input, setInput] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<"invalid" | "network" | null>(null)

  if (isNative || !required) {
    return <>{children}</>
  }
  if (!hydrated) {
    return null
  }
  if (token && token.length > 0) {
    return <>{children}</>
  }

  const submit = async () => {
    const value = input.trim()
    if (!value || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const outcome = await verifyActivationToken(verifyEndpoint, value)
      if (outcome === "ok") {
        actions.setToken(value)
        setInput("")
      } else {
        setError(outcome)
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{t("activation.title")}</CardTitle>
          <CardDescription>{t("activation.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault()
              void submit()
            }}
          >
            <Input
              type="password"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={t("activation.placeholder")}
              autoFocus
              autoComplete="off"
            />
            {error && (
              <p className="text-sm text-destructive">
                {error === "invalid" ? t("activation.invalid") : t("activation.networkError")}
              </p>
            )}
            <Button type="submit" disabled={submitting || !input.trim()}>
              {submitting ? t("activation.verifying") : t("activation.submit")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
