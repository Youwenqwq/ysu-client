import { useState, useEffect } from "react"

interface StatsEntry {
  ua: string
  version?: string
  viewport?: string
  screen?: string
  platform?: string
  ts: number
}

interface StatsData {
  count: number
  entries: StatsEntry[]
}

interface AnnouncementInfo {
  id: string
  title: string
  content: string
  level: "info" | "warning" | "critical"
  publishedAt: string
  submittedAt?: string
  expireAt?: string
}

export default function AdminPanel() {
  const [password, setPassword] = useState("")
  const [savedPassword, setSavedPassword] = useState("")
  const [date, setDate] = useState(new Date().toLocaleDateString("sv-SE"))
  const [type, setType] = useState<"stats" | "announcement">("stats")
  const [data, setData] = useState<StatsData | AnnouncementInfo | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    const saved = sessionStorage.getItem("admin_password")
    if (saved) setSavedPassword(saved)
  }, [])

  const [loginError, setLoginError] = useState("")

  const handleLogin = async () => {
    setLoginError("")
    try {
      const res = await fetch("/api/admin?type=list", {
        headers: { Authorization: `Bearer ${password}` },
      })
      if (!res.ok) {
        throw new Error("密码错误")
      }
      sessionStorage.setItem("admin_password", password)
      setSavedPassword(password)
    } catch (err: any) {
      setLoginError(err.message || "验证失败")
    }
  }

  const handleLogout = () => {
    sessionStorage.removeItem("admin_password")
    setSavedPassword("")
    setPassword("")
    setData(null)
  }

  const fetchData = async () => {
    setLoading(true)
    setError("")
    try {
      let url: string
      let headers: Record<string, string> = {}
      if (type === "announcement") {
        url = "/api/announcement"
      } else {
        url = `/api/admin?type=${type}&date=${date}`
        headers = { Authorization: `Bearer ${savedPassword}` }
      }
      const res = await fetch(url, { headers })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || err.message || `HTTP ${res.status}`)
      }
      const result = await res.json()
      setData(result)
    } catch (err: any) {
      setError(err.message)
      setData(null)
    } finally {
      setLoading(false)
    }
  }

  if (!savedPassword) {
    return (
      <div className="mx-auto mt-20 max-w-md rounded-xl border border-border bg-card p-6">
        <h2 className="mb-4 text-xl font-semibold text-card-foreground">管理员登录</h2>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="输入管理员密码"
          className="mb-4 w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground outline-none focus:ring-2 focus:ring-ring"
          onKeyDown={(e) => e.key === "Enter" && handleLogin()}
        />
        {loginError && (
          <div className="mb-4 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-500">
            {loginError}
          </div>
        )}
        <button
          onClick={handleLogin}
          className="w-full cursor-pointer rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground"
        >
          登录
        </button>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-5xl p-4">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">数据管理面板</h1>
        <button
          onClick={handleLogout}
          className="cursor-pointer rounded-lg border border-border px-3 py-1.5 text-muted-foreground hover:text-foreground"
        >
          退出登录
        </button>
      </div>

      <div className="mb-6 flex flex-wrap gap-3">
        {type === "stats" && (
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-lg border border-border bg-background px-3 py-2 text-foreground outline-none focus:ring-2 focus:ring-ring"
          />
        )}
        <select
          value={type}
          onChange={(e) => {
            setType(e.target.value as "stats" | "announcement")
            setData(null)
          }}
          className="rounded-lg border border-border bg-background px-3 py-2 text-foreground outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="stats">统计数据</option>
          <option value="announcement">公告管理</option>
        </select>
        <button
          onClick={fetchData}
          disabled={loading}
          className="cursor-pointer rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground disabled:opacity-50"
        >
          {loading ? "加载中..." : "查询"}
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-red-500">
          {error}
        </div>
      )}

      {data && type === "stats" && <StatsView data={data as StatsData} localDate={date} />}
      {type === "announcement" && (
        <AnnouncementView
          data={data as AnnouncementInfo | null}
          password={savedPassword}
          onRefresh={fetchData}
          loading={loading}
        />
      )}
    </div>
  )
}

function AnnouncementView({
  data,
  password,
  onRefresh,
  loading,
}: {
  data: AnnouncementInfo | null
  password: string
  onRefresh: () => void
  loading: boolean
}) {
  const [form, setForm] = useState({
    id: "",
    title: "",
    content: "",
    level: "info" as AnnouncementInfo["level"],
    publishedAt: toLocalDatetimeInput(new Date()),
    expireAt: "",
  })
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState("")
  const [sendSuccess, setSendSuccess] = useState(false)
  const [history, setHistory] = useState<AnnouncementInfo[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)

  const fetchHistory = async () => {
    setHistoryLoading(true)
    try {
      const res = await fetch("/api/announcement?history=true")
      if (res.ok) {
        const data = (await res.json()) as { entries?: AnnouncementInfo[] }
        setHistory(data.entries || [])
      }
    } catch {
      // ignore
    } finally {
      setHistoryLoading(false)
    }
  }

  useEffect(() => {
    fetchHistory()
  }, [])

  const handleSubmit = async () => {
    if (!form.id.trim() || !form.title.trim() || !form.content.trim()) return
    setSending(true)
    setSendError("")
    setSendSuccess(false)
    try {
      const body: Record<string, string> = {
        id: form.id.trim(),
        title: form.title.trim(),
        content: form.content.trim(),
        level: form.level,
        publishedAt: new Date(form.publishedAt).toISOString(),
      }
      if (form.expireAt.trim()) {
        body.expireAt = new Date(form.expireAt).toISOString()
      }
      const res = await fetch("/api/announcement", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${password}`,
        },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || `HTTP ${res.status}`)
      }
      setSendSuccess(true)
      setForm({
        id: "",
        title: "",
        content: "",
        level: "info",
        publishedAt: toLocalDatetimeInput(new Date()),
        expireAt: "",
      })
      onRefresh()
      fetchHistory()
    } catch (err: any) {
      setSendError(err.message)
    } finally {
      setSending(false)
    }
  }

  const levelBadge = (level: string) => {
    const colors: Record<string, string> = {
      info: "bg-blue-500/10 text-blue-600",
      warning: "bg-yellow-500/10 text-yellow-600",
      critical: "bg-red-500/10 text-red-600",
    }
    const labels: Record<string, string> = {
      info: "信息",
      warning: "警告",
      critical: "紧急",
    }
    return (
      <span className={`rounded px-2 py-0.5 text-xs font-medium ${colors[level] || colors.info}`}>
        {labels[level] || level}
      </span>
    )
  }

  return (
    <div className="space-y-6">
      {/* Current announcement */}
      <div className="rounded-xl border border-border bg-card p-4">
        <h3 className="mb-3 text-lg font-semibold text-card-foreground">当前公告</h3>
        {loading && <div className="text-sm text-muted-foreground">加载中...</div>}
        {!loading && data && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              {levelBadge(data.level)}
              <span className="font-semibold text-card-foreground">{data.title}</span>
            </div>
            <div className="text-xs text-muted-foreground">
              ID: {data.id}
              {" · "}
              计划发布 {new Date(data.publishedAt).toLocaleString("zh-CN")}
              {data.submittedAt && (
                <>
                  {" · "}提交于 {new Date(data.submittedAt).toLocaleString("zh-CN")}
                </>
              )}
              {data.expireAt && (
                <>
                  {" · "}过期于 {new Date(data.expireAt).toLocaleString("zh-CN")}
                </>
              )}
            </div>
            <div className="text-sm whitespace-pre-wrap text-card-foreground">{data.content}</div>
          </div>
        )}
        {!loading && !data && <div className="text-sm text-muted-foreground">暂无公告</div>}
      </div>

      {/* Publish form */}
      <div className="rounded-xl border border-border bg-card p-4">
        <h3 className="mb-4 text-lg font-semibold text-card-foreground">发布公告</h3>

        {sendSuccess && (
          <div className="mb-4 rounded-lg border border-green-500/20 bg-green-500/10 p-3 text-sm text-green-600">
            公告发布成功
          </div>
        )}
        {sendError && (
          <div className="mb-4 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-500">
            {sendError}
          </div>
        )}

        <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm text-muted-foreground">ID（唯一标识）</label>
            <input
              type="text"
              value={form.id}
              onChange={(e) => setForm({ ...form, id: e.target.value })}
              placeholder="例如: v0.8.0-release"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-muted-foreground">标题</label>
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="公告标题"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>

        <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-3">
          <div>
            <label className="mb-1 block text-sm text-muted-foreground">级别</label>
            <select
              value={form.level}
              onChange={(e) =>
                setForm({
                  ...form,
                  level: e.target.value as AnnouncementInfo["level"],
                })
              }
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="info">信息</option>
              <option value="warning">警告</option>
              <option value="critical">紧急</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm text-muted-foreground">发布时间</label>
            <input
              type="datetime-local"
              value={form.publishedAt}
              onChange={(e) => setForm({ ...form, publishedAt: e.target.value })}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-muted-foreground">过期时间（可选）</label>
            <input
              type="datetime-local"
              value={form.expireAt}
              onChange={(e) => setForm({ ...form, expireAt: e.target.value })}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>

        <div className="mb-4">
          <label className="mb-1 block text-sm text-muted-foreground">内容（支持 Markdown）</label>
          <textarea
            value={form.content}
            onChange={(e) => setForm({ ...form, content: e.target.value })}
            placeholder="输入公告内容..."
            rows={6}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <button
          onClick={handleSubmit}
          disabled={sending || !form.id.trim() || !form.title.trim() || !form.content.trim()}
          className="cursor-pointer rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground disabled:opacity-50"
        >
          {sending ? "发布中..." : "发布公告"}
        </button>
      </div>

      {/* History */}
      <div className="rounded-xl border border-border bg-card p-4">
        <h3 className="mb-3 text-lg font-semibold text-card-foreground">
          历史公告（最近 {history.length} 条）
        </h3>
        {historyLoading && <div className="text-sm text-muted-foreground">加载中...</div>}
        {!historyLoading && history.length === 0 && (
          <div className="text-sm text-muted-foreground">暂无历史公告</div>
        )}
        {!historyLoading && history.length > 0 && (
          <div className="space-y-3">
            {history.map((item, i) => (
              <div key={i} className="rounded-lg border border-border/50 bg-background/50 p-3">
                <div className="mb-1 flex items-center gap-2">
                  {levelBadge(item.level)}
                  <span className="text-sm font-medium text-card-foreground">{item.title}</span>
                </div>
                <div className="mb-1 text-xs text-muted-foreground">
                  ID: {item.id} · 发布于 {new Date(item.publishedAt).toLocaleString("zh-CN")}
                  {item.expireAt && (
                    <> · 过期于 {new Date(item.expireAt).toLocaleString("zh-CN")}</>
                  )}
                </div>
                <div className="line-clamp-3 text-sm whitespace-pre-wrap text-card-foreground">
                  {item.content}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function toLocalDatetimeInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function StatsView({ data, localDate }: { data: StatsData; localDate: string }) {
  const startOfDay = new Date(localDate + "T00:00:00").getTime()
  const endOfDay = new Date(localDate + "T23:59:59.999").getTime()
  const filtered = data.entries.filter((e) => e.ts >= startOfDay && e.ts <= endOfDay)

  return (
    <div>
      <div className="mb-4 rounded-xl border border-border bg-card p-4">
        <div className="text-3xl font-bold text-card-foreground">{filtered.length}</div>
        <div className="text-muted-foreground">记录数</div>
      </div>

      {filtered.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">时间</th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">UA</th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">版本</th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">平台</th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">视口</th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">屏幕</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((entry, i) => (
                <tr key={i} className="border-b border-border/50 last:border-b-0">
                  <td className="px-3 py-2 whitespace-nowrap text-card-foreground">
                    {new Date(entry.ts).toLocaleString("zh-CN")}
                  </td>
                  <td className="max-w-xs truncate px-3 py-2 text-card-foreground" title={entry.ua}>
                    {entry.ua}
                  </td>
                  <td className="px-3 py-2 text-card-foreground">{entry.version || "-"}</td>
                  <td className="px-3 py-2 text-card-foreground">{entry.platform || "-"}</td>
                  <td className="px-3 py-2 text-card-foreground">{entry.viewport || "-"}</td>
                  <td className="px-3 py-2 text-card-foreground">{entry.screen || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

