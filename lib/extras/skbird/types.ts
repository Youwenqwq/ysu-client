/**
 * 森空鸟领域模型。
 * 原始字段见 API 文档「帖子字段」；此处为归一化后的应用侧模型。
 * 服务端字段在列表/详情端点间有差异（l_count vs like_num 等），映射层兼容两种形态。
 */

export interface SkbirdThread {
  threadId: string
  cateId: number
  cateName: string
  title: string
  content: string
  imgPaths: string[]
  commentCount: number
  viewCount: number
  /** 全局点赞数（l_count / like_num） */
  likeCount: number
  /** 全局马住数（mark_num，仅详情有） */
  markCount: number
  /** 相对时间文本，如 "3分钟前" */
  postTimeText: string
  /** 秒级时间戳（p_time） */
  postTime: number
  /** "0" 普通帖 / "10" 认证帖（详情/搜索/最新流中 title/content 被服务端裁剪为空） */
  certShow: string
  nickname: string
  avatarUrl: string
  userLevel: number
  userLevelTitle: string
  isMine: boolean
  /** 我是否已点赞（like_has / l_has） */
  likeHas: boolean
  /** 我是否已马住（mark_has，未马住时服务端缺省 false） */
  markHas: boolean
}

/** 认证帖（需认证用户可见，未认证时正文被裁剪） */
export function isCertThread(t: Pick<SkbirdThread, "certShow">): boolean {
  return t.certShow === "10"
}

// ─── raw JSON → 领域模型 ─────────────────────────────────────────────── //

function rawStr(v: unknown): string {
  if (typeof v === "string") return v
  if (typeof v === "number") return String(v)
  return ""
}

function rawNum(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

export function toThread(raw: unknown): SkbirdThread {
  // typeof 检查后收敛为索引签名，读取外部 JSON 的既定模式
  const r = (raw !== null && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  return {
    threadId: rawStr(r.thread_id ?? r.id),
    cateId: rawNum(r.cate_id),
    cateName: rawStr(r.cate_name),
    title: rawStr(r.title),
    content: rawStr(r.content),
    imgPaths: Array.isArray(r.img_paths) ? r.img_paths.map(rawStr) : [],
    commentCount: rawNum(r.c_count),
    viewCount: rawNum(r.view_count),
    likeCount: rawNum(r.l_count ?? r.like_num),
    markCount: rawNum(r.mark_num),
    postTimeText: rawStr(r.post_time),
    postTime: rawNum(r.p_time),
    certShow: rawStr(r.cert_show) || "0",
    nickname: rawStr(r.nickname),
    avatarUrl: rawStr(r.headimgurl),
    userLevel: rawNum(r.user_level),
    userLevelTitle: rawStr(r.user_level_title),
    isMine: r.is_mine === true || r.is_mine === 1,
    likeHas: Boolean(r.like_has ?? r.l_has),
    markHas: Boolean(r.mark_has),
  }
}

export function toThreadList(data: unknown): SkbirdThread[] {
  const d = (data !== null && typeof data === "object" ? data : {}) as Record<string, unknown>
  return Array.isArray(d.list) ? d.list.map(toThread) : []
}

// ─── 评论 ────────────────────────────────────────────────────────────── //

export interface SkbirdComment {
  commentId: string
  /** 根评论 id（楼中楼归属） */
  rootCommentId: string
  /** 回复目标评论 id */
  replyCommentId: string
  content: string
  postTimeText: string
  likeCount: number
  nickname: string
  avatarUrl: string
  userLevelTitle: string
  /** 是否楼主 */
  isAuthor: boolean
  isMine: boolean
  /** 我是否已赞过这条评论（like_has） */
  likeHas: boolean
  /** 楼主是否赞过（author_liked） */
  authorLiked: boolean
  /** 楼中楼回复（reply_list，服务端嵌套下发） */
  replies: SkbirdComment[]
}

export function toComment(raw: unknown): SkbirdComment {
  const r = (raw !== null && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  return {
    commentId: rawStr(r.comment_id),
    rootCommentId: rawStr(r.root_comment_id),
    replyCommentId: rawStr(r.reply_comment_id),
    content: rawStr(r.content),
    postTimeText: rawStr(r.post_time_text),
    likeCount: rawNum(r.like_num),
    nickname: rawStr(r.nickname),
    avatarUrl: rawStr(r.headimgurl),
    userLevelTitle: rawStr(r.user_level_title),
    isAuthor: Boolean(r.is_author),
    isMine: Boolean(r.is_mine),
    likeHas: Boolean(r.like_has),
    authorLiked: Boolean(r.author_liked),
    replies: Array.isArray(r.reply_list) ? r.reply_list.map(toComment) : [],
  }
}

export function toCommentList(data: unknown): SkbirdComment[] {
  const d = (data !== null && typeof data === "object" ? data : {}) as Record<string, unknown>
  return Array.isArray(d.list) ? d.list.map(toComment) : []
}

// ─── 分类 ────────────────────────────────────────────────────────────── //

export interface SkbirdCategory {
  cateId: string
  name: string
  summary: string
  iconPath: string
}

export function toCategoryList(data: unknown): SkbirdCategory[] {
  const d = (data !== null && typeof data === "object" ? data : {}) as Record<string, unknown>
  const list = d.cate_list
  if (!Array.isArray(list)) return []
  return list.map((raw) => {
    const r = (raw !== null && typeof raw === "object" ? raw : {}) as Record<string, unknown>
    return {
      cateId: rawStr(r.cate_id),
      name: rawStr(r.name),
      summary: rawStr(r.summary),
      iconPath: rawStr(r.icon_path),
    }
  })
}

// ─── 用户 ────────────────────────────────────────────────────────────── //

/** /user/info → data.user_info（抓包 rec_309 实测结构） */
export interface SkbirdUser {
  nickname: string
  avatarUrl: string
  level: number
  levelTitle: string
  exp: number
  nextLevelExp: number
  nextLevelTitle: string
  /** "no" = 未认证；其余值视为已认证 */
  certStatus: string
  regDays: number
}

export function toUser(data: unknown): SkbirdUser {
  const d = (data !== null && typeof data === "object" ? data : {}) as Record<string, unknown>
  const u = (d.user_info !== null && typeof d.user_info === "object" ? d.user_info : d) as Record<
    string,
    unknown
  >
  const next = (
    u.next_level_info !== null && typeof u.next_level_info === "object" ? u.next_level_info : {}
  ) as Record<string, unknown>
  return {
    nickname: rawStr(u.nickname),
    avatarUrl: rawStr(u.headimgurl),
    level: rawNum(u.user_level),
    levelTitle: rawStr(u.user_level_title),
    exp: rawNum(u.user_exp),
    nextLevelExp: rawNum(next.exp),
    nextLevelTitle: rawStr(next.title),
    certStatus: rawStr(u.cert_status),
    regDays: rawNum(u.reg_days),
  }
}

/** /user/statinfo：{ thread_count, user_coin } */
export interface SkbirdUserStats {
  threadCount: number
  userCoin: number
}

export function toUserStats(data: unknown): SkbirdUserStats {
  const d = (data !== null && typeof data === "object" ? data : {}) as Record<string, unknown>
  return { threadCount: rawNum(d.thread_count), userCoin: rawNum(d.user_coin) }
}

// ─── 消息 ────────────────────────────────────────────────────────────── //

/** 消息项。抓包中 msg/list 为空，字段名为防御性推断（多候选回退）。 */
export interface SkbirdMessage {
  id: string
  title: string
  content: string
  nickname: string
  avatarUrl: string
  timeText: string
  /** 秒时间戳（分页游标 from_time 用） */
  time: number
}

export function toMessage(raw: unknown): SkbirdMessage {
  const r = (raw !== null && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  return {
    id: rawStr(r.msg_id ?? r.id ?? r.notify_id),
    title: rawStr(r.title),
    content: rawStr(r.content ?? r.msg),
    nickname: rawStr(r.nickname),
    avatarUrl: rawStr(r.headimgurl),
    timeText: rawStr(r.post_time_text ?? r.time_text ?? r.post_time),
    time: rawNum(r.p_time ?? r.post_time),
  }
}

export function toMessageList(data: unknown): SkbirdMessage[] {
  const d = (data !== null && typeof data === "object" ? data : {}) as Record<string, unknown>
  return Array.isArray(d.list) ? d.list.map(toMessage) : []
}

/** /msg/unum：{ im_count, count, mark_count } */
export interface SkbirdUnread {
  imCount: number
  count: number
  markCount: number
}

export function toUnread(data: unknown): SkbirdUnread {
  const d = (data !== null && typeof data === "object" ? data : {}) as Record<string, unknown>
  return {
    imCount: rawNum(d.im_count),
    count: rawNum(d.count),
    markCount: rawNum(d.mark_count),
  }
}

/** /msg/like/stat：{ chat_show, like_num, new_like_num } */
export interface SkbirdLikeStat {
  likeNum: number
  newLikeNum: number
}

export function toLikeStat(data: unknown): SkbirdLikeStat {
  const d = (data !== null && typeof data === "object" ? data : {}) as Record<string, unknown>
  return { likeNum: rawNum(d.like_num), newLikeNum: rawNum(d.new_like_num) }
}
