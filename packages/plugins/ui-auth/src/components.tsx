import { useState } from "react"
import { ArrowLeftRight, ChevronRight, CloudOff, LogIn, LogOut, TriangleAlert } from "lucide-react"
import type {
  ProviderRuntimeSnapshot,
  QueryActivitySnapshot,
  QuerySnapshot,
  SessionSnapshot,
  StudentInfo,
} from "@orahako/academic-sdk"
import type { DerivedComponentProps, ObservableSource, SlotComponent } from "@orahako/sdk"
import {
  Alert,
  AlertTitle,
  Avatar,
  AvatarFallback,
  Badge,
  Button,
  Card,
  CardContent,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Skeleton,
  Spinner,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@orahako/ui-primitives"
import type { AuthUiDictionary } from "./dictionary"
import type { AuthSchoolChoice } from "./login-page"

export function RefreshIndicator({
  count,
  label,
  className,
}: {
  readonly count: number
  readonly label: string
  readonly className?: string
}) {
  if (count <= 0) return null
  return <Spinner className={cn("size-4 text-muted-foreground", className)} aria-label={label} />
}

export function StaleIndicator({
  count,
  tooltip,
  className,
}: {
  readonly count: number
  readonly tooltip: string
  readonly className?: string
}) {
  if (count <= 0) return null
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "inline-flex items-center justify-center rounded-md p-1 text-muted-foreground",
            className
          )}
          aria-label={tooltip}
        >
          <CloudOff className="size-4" />
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <p>{tooltip}</p>
      </TooltipContent>
    </Tooltip>
  )
}

export interface QueryActivityInject {
  readonly hooks: {
    readonly activity: ObservableSource<QueryActivitySnapshot>
  }
}

export type QueryActivityIndicatorsProps = DerivedComponentProps<
  Record<string, never>,
  AuthUiDictionary,
  undefined,
  undefined,
  QueryActivityInject
>

export const QueryActivityIndicators: SlotComponent<QueryActivityIndicatorsProps> = (props) => {
  const activity = props.useActivity()
  if (activity.refreshingCount <= 0 && activity.staleCount <= 0) return null

  return (
    <span data-query-activity="" className="inline-flex items-center gap-1.5">
      <RefreshIndicator count={activity.refreshingCount} label={props.t("activity.refreshing")} />
      <StaleIndicator count={activity.staleCount} tooltip={props.t("activity.staleTooltip")} />
    </span>
  )
}

export interface SessionExpiredBannerInject {
  readonly hooks: {
    readonly session: ObservableSource<SessionSnapshot>
  }
  readonly relogin: () => Promise<void>
}

export type SessionExpiredBannerProps = DerivedComponentProps<
  Record<string, never>,
  AuthUiDictionary,
  undefined,
  undefined,
  SessionExpiredBannerInject
>

export const SessionExpiredBanner: SlotComponent<SessionExpiredBannerProps> = (props) => {
  const session = props.useSession()
  const [loading, setLoading] = useState(false)

  if (!session.isAuthenticated || !session.sessionExpired) return null

  async function handleRelogin() {
    if (loading) return
    setLoading(true)
    try {
      await props.relogin()
    } finally {
      setLoading(false)
    }
  }

  return (
    <Alert
      data-session-expired-banner=""
      variant="destructive"
      className="mx-4 mt-4 w-auto md:mx-6 md:mt-6"
    >
      <TriangleAlert />
      <AlertTitle className="flex flex-wrap items-center gap-3">
        <span>{props.t("session.expired")}</span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void handleRelogin()}
          disabled={loading}
          aria-busy={loading}
        >
          {loading ? props.t("session.reloggingIn") : props.t("session.relogin")}
        </Button>
      </AlertTitle>
    </Alert>
  )
}

export interface StudentProfileHeaderInject {
  readonly hooks: {
    readonly session: ObservableSource<SessionSnapshot>
    readonly provider: ObservableSource<ProviderRuntimeSnapshot>
    readonly navigationRevision: ObservableSource<number>
    readonly student: ObservableSource<QuerySnapshot<StudentInfo>>
  }
  readonly canOpenStudentInfo: () => boolean
  readonly openStudentInfo: () => void
  readonly openLogin: () => void
}

export type StudentProfileHeaderProps = DerivedComponentProps<
  Record<string, never>,
  AuthUiDictionary,
  undefined,
  undefined,
  StudentProfileHeaderInject
>

export const StudentProfileHeader: SlotComponent<StudentProfileHeaderProps> = (props) => {
  const session = props.useSession()
  const providerSnap = props.useProvider()
  const navRevision = props.useNavigationRevision()
  const student = props.useStudent()
  void navRevision

  if (!session.isAuthenticated) {
    return (
      <Card data-profile-header="guest" className="py-0">
        <CardContent className="flex items-center justify-between gap-4 py-5">
          <div className="flex items-center gap-4">
            <Avatar className="size-14">
              <AvatarFallback className="text-lg">U</AvatarFallback>
            </Avatar>
            <div className="flex flex-col gap-0.5">
              <span className="text-base font-semibold">{props.t("session.notSignedIn")}</span>
              <span className="text-xs text-muted-foreground">
                {props.t("session.notSignedInDesc")}
              </span>
            </div>
          </div>
          <Button size="sm" onClick={props.openLogin}>
            <LogIn data-icon="inline-start" />
            {props.t("session.signIn")}
          </Button>
        </CardContent>
      </Card>
    )
  }

  const displayName = student.data?.name || session.username || props.t("profile.fallbackName")
  const initials = (student.data?.name || session.username || "U").slice(-2)
  const schoolName = providerSnap.provider?.name ?? session.activeSchoolId
  const canNavigate = props.canOpenStudentInfo()

  const body = (
    <CardContent className="flex items-center gap-4 py-5">
      <Avatar className="size-14">
        <AvatarFallback className="text-lg">{initials}</AvatarFallback>
      </Avatar>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {student.isLoading && !student.data ? (
          <>
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-4 w-32" />
          </>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <span className="truncate text-base font-semibold">{displayName}</span>
              {schoolName && (
                <Badge variant="secondary" className="shrink-0 text-[11px]">
                  {schoolName}
                </Badge>
              )}
            </div>
            {(student.data?.studentId ?? session.username) && (
              <span className="truncate text-sm text-muted-foreground">
                {student.data?.studentId ?? session.username}
              </span>
            )}
            {(student.data?.department || student.data?.major) && (
              <span className="truncate text-xs text-muted-foreground">
                {[student.data.department, student.data.major].filter(Boolean).join(" · ")}
              </span>
            )}
          </>
        )}
      </div>
      {canNavigate && <ChevronRight className="size-5 shrink-0 text-muted-foreground" />}
    </CardContent>
  )

  if (canNavigate) {
    return (
      <button
        type="button"
        data-profile-header="authenticated"
        onClick={props.openStudentInfo}
        className="block w-full text-left"
      >
        <Card className="py-0 transition-colors hover:bg-muted/40 active:bg-muted/60">{body}</Card>
      </button>
    )
  }

  return (
    <Card data-profile-header="authenticated" className="py-0">
      {body}
    </Card>
  )
}

export interface AccountActionsInject {
  readonly hooks: {
    readonly session: ObservableSource<SessionSnapshot>
    readonly providersRevision: ObservableSource<number>
  }
  readonly showLogoutConfirm: boolean
  readonly listSchools: () => readonly AuthSchoolChoice[]
  readonly relogin: () => Promise<void>
  readonly switchSchool: (schoolId?: string) => void
  readonly logout: () => Promise<void>
  readonly openLogin: () => void
}

export type AccountActionsProps = DerivedComponentProps<
  Record<string, never>,
  AuthUiDictionary,
  undefined,
  undefined,
  AccountActionsInject
>

export const AccountActions: SlotComponent<AccountActionsProps> = (props) => {
  const session = props.useSession()
  const providersRevision = props.useProvidersRevision()
  void providersRevision

  const [reloginBusy, setReloginBusy] = useState(false)
  const [logoutDialogOpen, setLogoutDialogOpen] = useState(false)
  const [schoolDialogOpen, setSchoolDialogOpen] = useState(false)

  const schools = props.listSchools()

  if (!session.isAuthenticated) {
    return (
      <button
        type="button"
        onClick={props.openLogin}
        className="flex items-center gap-3 py-3 transition-colors active:bg-muted/60"
      >
        <LogIn className="size-5 shrink-0 text-muted-foreground" />
        <span className="flex-1 text-left text-sm">{props.t("session.signIn")}</span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
      </button>
    )
  }

  async function handleRelogin() {
    if (reloginBusy) return
    setReloginBusy(true)
    try {
      await props.relogin()
    } finally {
      setReloginBusy(false)
    }
  }

  async function handleLogoutConfirm() {
    setLogoutDialogOpen(false)
    await props.logout()
  }

  function handleSwitchClick() {
    if (schools.length > 1) {
      setSchoolDialogOpen(true)
      return
    }
    props.switchSchool()
  }

  return (
    <>
      <button
        type="button"
        disabled={reloginBusy}
        onClick={() => void handleRelogin()}
        className="flex items-center gap-3 py-3 transition-colors active:bg-muted/60 disabled:opacity-50"
      >
        <LogIn className="size-5 shrink-0 text-muted-foreground" />
        <span className="flex-1 text-left text-sm">
          {reloginBusy ? props.t("session.reloggingIn") : props.t("session.relogin")}
        </span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
      </button>

      <button
        type="button"
        onClick={handleSwitchClick}
        className="flex items-center gap-3 py-3 transition-colors active:bg-muted/60"
      >
        <ArrowLeftRight className="size-5 shrink-0 text-muted-foreground" />
        <span className="flex-1 text-left text-sm">{props.t("session.switchSchool")}</span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
      </button>

      <button
        type="button"
        onClick={() => {
          if (props.showLogoutConfirm) {
            setLogoutDialogOpen(true)
          } else {
            void handleLogoutConfirm()
          }
        }}
        className="flex items-center gap-3 py-3 text-destructive transition-colors active:bg-destructive/10"
      >
        <LogOut className="size-5 shrink-0" />
        <span className="flex-1 text-left text-sm">{props.t("session.logout")}</span>
      </button>

      <Dialog open={schoolDialogOpen} onOpenChange={setSchoolDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{props.t("session.switchSchool")}</DialogTitle>
            <DialogDescription>{props.t("session.switchSchoolDesc")}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            {schools.map((school) => (
              <Button
                key={school.id}
                variant={school.id === session.activeSchoolId ? "secondary" : "outline"}
                className="justify-between"
                onClick={() => {
                  setSchoolDialogOpen(false)
                  props.switchSchool(school.id)
                }}
              >
                <span>{props.locale === "en" && school.nameEn ? school.nameEn : school.name}</span>
                <span className="font-mono text-xs text-muted-foreground">{school.id}</span>
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={logoutDialogOpen} onOpenChange={setLogoutDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{props.t("session.logout")}</DialogTitle>
            <DialogDescription>{props.t("session.logoutConfirm")}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setLogoutDialogOpen(false)}>
              {props.t("session.cancel")}
            </Button>
            <Button variant="destructive" onClick={() => void handleLogoutConfirm()}>
              {props.t("session.logout")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
