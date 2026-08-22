/**
 * 森空鸟 API 客户端。
 *
 * - 签名：每请求 X-Sc-Ah（见 sign.ts）；GET 的 query 与 POST 的 form body
 *   均须并入签名参数（解码后的明文值）。
 * - 传输：fetchStateless → native 走 CapacitorHttp 直连（明文 HTTP，已在
 *   network_security_config.xml 放行）；Web 走 /api/proxy 边缘代理。
 * - 鉴权：X-Sc-Token 手动配置（微信登录 code 无法脚本化，过期需重新抓包）。
 *
 * 参考实现：purepy/zanao.py（签名 118/118 抓包验证）。
 */
import { fetchStateless } from "@/lib/cookie";
import { makeSign, type SignEntry } from "./sign";
import {
  toCategoryList,
  toCommentList,
  toLikeStat,
  toMessageList,
  toThread,
  toThreadList,
  toUnread,
  toUser,
  toUserStats,
  type SkbirdCategory,
  type SkbirdComment,
  type SkbirdLikeStat,
  type SkbirdMessage,
  type SkbirdThread,
  type SkbirdUnread,
  type SkbirdUser,
  type SkbirdUserStats,
} from "./types";

/** errno=10：会话/token 无效（用户本地网络异常） */
export const SKBIRD_ERRNO_TOKEN_INVALID = 10;

export interface SkbirdThreadDetail {
  thread: SkbirdThread;
  /** 评论签名（/thread/info 响应的 data.t_sign），用于 comments() */
  commentSign: string;
}

export class SkbirdError extends Error {
  constructor(
    readonly errno: number,
    message: string,
  ) {
    super(message);
    this.name = "SkbirdError";
  }
}

export interface SkbirdConfig {
  token: string;
  deviceId: string;
  /** 校区别名（多租户），如 "ysu" */
  alias: string;
}

const BASE = "http://api.app.zanao.com";
// CDN 443 可用
const CDN_BASE = "https://b1.cdn.zanao.com";

/** 生成与 App 设备 ID 同格式的随机 ID（8-4-4-4-12-16 hex 段），首次启动生成后持久化 */
export function generateDeviceId(): string {
  const hex = (n: number): string => {
    const buf = new Uint8Array(Math.ceil(n / 2));
    crypto.getRandomValues(buf);
    return [...buf].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, n);
  };
  return `${hex(8)}-${hex(4)}-${hex(4)}-${hex(4)}-${hex(12)}-${hex(16)}`;
}

/**
 * 帖子图片 URL。img_paths 为 CDN 路径（可能不带前导 "/"，如 "upload/xx.jpg"）；
 * CDN 完全匿名。**必须携带变换后缀**
 * - 无后缀裸路径：403 拒绝；
 * - `@!common`：**原图**（实测 1080x2400 / 1264x2736 全分辨率），http/https 均可；
 * - 缩放档仅 5 种：`@!sm_w100_h100` / `@!sm_w200_h200` / `@!sm_w100` /
 *   `@!sm_w200` / `@!sm_w400`（w400 为缩放上限，w800+ 一律 404）；
 * - b2.cdn 与 b1 不互通（同路径 404），固定使用 b1。
 */
export function skbirdImageUrl(path: string, size?: { w: number; h?: number } | "original"): string {
  if (/^https?:\/\//.test(path)) return path;
  const p = path.startsWith("/") ? path : `/${path}`;
  if (size === "original") return `${CDN_BASE}${p}@!common`;
  if (!size) return `${CDN_BASE}${p}@!sm_w400`;
  const suffix = size.h ? `@!sm_w${size.w}_h${size.h}` : `@!sm_w${size.w}`;
  return `${CDN_BASE}${p}${suffix}`;
}

function randomNd(): string {
  // 20 位随机数字，首位非零
  const buf = new Uint8Array(20);
  crypto.getRandomValues(buf);
  let nd = String((buf[0]! % 9) + 1);
  for (let i = 1; i < 20; i++) nd += String(buf[i]! % 10);
  return nd;
}

export class SkbirdClient {
  constructor(private readonly config: SkbirdConfig) {}

  private async call(method: "GET" | "POST", path: string, params: SignEntry[] = []): Promise<unknown> {
    const td = Math.floor(Date.now() / 1000).toString();
    const nd = randomNd();
    const ah = makeSign([...params, ["randnum__", nd], ["timestamp__", td]]);
    const encoded = params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");

    const headers: Record<string, string> = {
      "User-Agent": "okhttp/4.10.0",
      "X-Requested-With": "XMLHttpRequest",
      "X-Sc-Client": "app",
      "X-Sc-Platform": "Android",
      "X-Sc-Device": this.config.deviceId,
      "X-Sc-Hb-V": "200",
      "X-Sc-Nt-V": "260",
      "X-Sc-Version": "2.6.0",
      "X-Sc-Alias": this.config.alias,
      "X-Sc-Td": td,
      "X-Sc-Nd": nd,
      "X-Sc-Ah": ah,
      "X-Sc-Token": this.config.token,
    };
    if (method === "POST") headers["Content-Type"] = "application/x-www-form-urlencoded";

    const res = await fetchStateless({
      method,
      url: method === "GET" && encoded ? `${BASE}${path}?${encoded}` : `${BASE}${path}`,
      headers,
      body: method === "POST" ? encoded : undefined,
      redirect: "manual",
    });
    if (res.status !== 200) throw new SkbirdError(-1, `HTTP ${res.status}`);
    const data: unknown = JSON.parse(await res.text());
    const d = (data !== null && typeof data === "object" ? data : {}) as Record<string, unknown>;
    const errno = Number(d.errno ?? -1);
    if (errno !== 0) throw new SkbirdError(errno, typeof d.errmsg === "string" ? d.errmsg : `errno=${errno}`);
    return d.data;
  }

  // ─── feeds ────────────────────────────────────────────────────────── //

  /** 热榜。count 固定 10：服务端对 count>10 会截断为 3 条（实测），type=3 为 App 抓包值 */
  async hot(count = 10, type = 3): Promise<SkbirdThread[]> {
    return toThreadList(
      await this.call("GET", "/thread/hot", [
        ["count", String(count)],
        ["type", String(type)],
      ]),
    );
  }

  async toplist(): Promise<SkbirdThread[]> {
    return toThreadList(await this.call("GET", "/thread/toplist"));
  }

  /**
   * 最新流。cateId="latest" 为全站，或传分类 id（如 "101"）。
   * 时间游标分页：下一页 fromTime = 本页末条 postTime；返回不足一页即到底。
   */
  async latest(fromTime = "0", cateId = "latest"): Promise<SkbirdThread[]> {
    return toThreadList(
      await this.call("GET", "/thread/v2/list", [
        ["with_reply", "true"],
        ["cate_id", cateId],
        ["from_time", fromTime],
        ["with_comment", "true"],
      ]),
    );
  }

  /** 悬赏帖列表（与 v2/list 同结构，含全文），时间游标分页同 latest() */
  async rewardList(fromTime = "0"): Promise<SkbirdThread[]> {
    return toThreadList(
      await this.call("GET", "/thread/rewardlist", [
        ["with_reply", "true"],
        ["from_time", fromTime],
        ["with_comment", "true"],
      ]),
    );
  }

  /** 全部分类（/catelist → data.cate_list） */
  async categories(): Promise<SkbirdCategory[]> {
    return toCategoryList(await this.call("GET", "/catelist"));
  }

  /** 搜索时间范围选项（range_options：1d/3d/7d/1m/6m/1y/2y） */
  async searchOptions(): Promise<string[]> {
    const data = await this.call("POST", "/thread/v2/searchoptions");
    const d = (data !== null && typeof data === "object" ? data : {}) as Record<string, unknown>;
    const opts = d.range_options;
    if (!Array.isArray(opts)) return [];
    return opts.map((o) => {
      const r = (o !== null && typeof o === "object" ? o : {}) as Record<string, unknown>;
      return typeof o === "string" ? o : String(r.value ?? r.range ?? "");
    }).filter((v) => v !== "");
  }

  /**
   * 搜索。cate_id=10 为实时帖（不带 range）；cate_id=20 为历史帖，
   * 此时 range 才生效（取值 1d/3d/7d/1m/6m/1y/2y）。
   */
  async search(wd: string, page = 1, range = ""): Promise<SkbirdThread[]> {
    const params: SignEntry[] = range
      ? [
          ["cate_id", "20"],
          ["range", range],
          ["cur_page", String(page)],
          ["wd", wd],
        ]
      : [
          ["cate_id", "10"],
          ["cur_page", String(page)],
          ["wd", wd],
        ];
    return toThreadList(await this.call("POST", "/thread/v2/search", params));
  }

  /**
   * 帖子详情 + 评论签名。t_sign 由服务端随响应签发，是 /comment/list 的入场券。
   * 认证帖的 title/content 会被服务端裁剪为空，用 unlockThread 读取全文。
   */
  async thread(id: string): Promise<SkbirdThreadDetail> {
    const d = await this.threadData(id);
    return {
      thread: toThread(d.detail ?? d),
      commentSign: typeof d.t_sign === "string" ? d.t_sign : "",
    };
  }

  private async threadData(id: string): Promise<Record<string, unknown>> {
    const data = await this.call("POST", "/thread/info", [
      ["from", ""],
      ["id", id],
    ]);
    return (data !== null && typeof data === "object" ? data : {}) as Record<string, unknown>;
  }

  // ─── 互动 ─────────────────────────────────────────────────────────── //

  /** action: 1 马住 / 2 取消 */
  async mark(id: string, action: 1 | 2): Promise<void> {
    await this.call("POST", "/thread/mark/post", [
      ["action", String(action)],
      ["id", id],
    ]);
  }

  /** action: 1 点赞 / 0 取消；commentId="0" 表示帖本身，否则为评论点赞 */
  async like(id: string, action: 0 | 1, commentId = "0"): Promise<void> {
    await this.call("POST", "/thread/like", [
      ["action", String(action)],
      ["id", id],
      ["comment_id", commentId],
    ]);
  }

  /** 马住列表。服务端对认证帖不裁剪，返回 title + content 全文。 */
  async markList(): Promise<SkbirdThread[]> {
    return toThreadList(await this.call("GET", "/thread/mark/list"));
  }

  /**
   * 解锁认证帖。热榜与悬赏帖流对认证帖不裁剪（含图片），优先从中取全文；
   * 都不在则走 mark→mark/list→unmark 链——mark/list 不含 img_paths
   * （抓包实测），此时只能解锁文字。
   */
  async unlockThread(id: string): Promise<SkbirdThread | null> {
    const findFull = (l: SkbirdThread[]) =>
      l.find((t) => t.threadId === id && (t.title || t.content));
    const inHot = await this.hot().then(findFull).catch(() => undefined);
    if (inHot) return inHot;
    const inReward = await this.rewardList().then(findFull).catch(() => undefined);
    if (inReward) return inReward;
    await this.mark(id, 1);
    try {
      const list = await this.markList();
      return list.find((t) => t.threadId === id) ?? null;
    } finally {
      await this.mark(id, 2).catch(() => {});
    }
  }

  // ─── 用户 ─────────────────────────────────────────────────────────── //

  /** 我的信息（data.user_info，抓包实测结构）；用于验证 token 有效性 */
  async userInfo(): Promise<SkbirdUser> {
    return toUser(await this.call("GET", "/user/info", [["from", "mine"]]));
  }

  /** 我的统计：{ threadCount, userCoin } */
  async userStats(): Promise<SkbirdUserStats> {
    return toUserStats(await this.call("GET", "/user/statinfo"));
  }

  // ─── 消息 ─────────────────────────────────────────────────────────── //

  /** 消息列表，时间游标分页（同 latest()） */
  async messages(fromTime = "0"): Promise<SkbirdMessage[]> {
    return toMessageList(await this.call("GET", "/msg/list", [["from_time", fromTime]]));
  }

  /** 新消息 + 未读计数 */
  async newMessages(
    fromTime = "0",
  ): Promise<{ list: SkbirdMessage[]; unreadNum: number; imCount: number; markCount: number }> {
    const data = await this.call("GET", "/msg/newlist", [["from_time", fromTime]]);
    const d = (data !== null && typeof data === "object" ? data : {}) as Record<string, unknown>;
    const n = (v: unknown) => {
      const x = Number(v);
      return Number.isFinite(x) ? x : 0;
    };
    return {
      list: toMessageList(data),
      unreadNum: n(d.unread_num),
      imCount: n(d.im_count),
      markCount: n(d.mark_count),
    };
  }

  /** 未读数：{ imCount, count, markCount } */
  async unreadNum(): Promise<SkbirdUnread> {
    return toUnread(await this.call("GET", "/msg/unum"));
  }

  /** 点赞统计：{ likeNum, newLikeNum } */
  async likeStat(): Promise<SkbirdLikeStat> {
    return toLikeStat(await this.call("GET", "/msg/like/stat"));
  }

  // ─── 评论 ─────────────────────────────────────────────────────────── //

  /**
   * 评论列表。/comment/list 需要 per-thread `sign` 参数，即 thread() 返回的
   * commentSign（服务端 data.t_sign 签发，无需本地加密）。认证帖评论可读。
   */
  async comments(id: string, commentSign: string): Promise<SkbirdComment[]> {
    if (!commentSign) return [];
    return toCommentList(
      await this.call("GET", "/comment/list", [
        ["with_hongbao", "0"],
        ["sign", commentSign],
        ["id", id],
      ]),
    );
  }
}
