import { beforeEach, describe, expect, it, vi } from "vitest"
import type { HttpRequest, HttpResponse } from "@/lib/cookie"
import { makeSign, type SignEntry } from "./sign"

const sendMock = vi.fn<(req: HttpRequest) => Promise<HttpResponse>>()

vi.mock("@/lib/cookie", () => ({
  fetchStateless: (req: HttpRequest) => sendMock(req),
}))

import { SkbirdClient, SkbirdError, generateDeviceId, skbirdImageUrl } from "./client"

const CONFIG = { token: "TOKEN", deviceId: "DEVICE", alias: "ysu" }

function okResponse(data: unknown): HttpResponse {
  return {
    status: 200,
    headers: {},
    url: "",
    text: async () => JSON.stringify({ errno: 0, errmsg: "", data }),
    arrayBuffer: async () => new ArrayBuffer(0),
  }
}

/** 从捕获的请求还原签名参数集（query 解码一层 + body 解码一层 + td/nd），重算签名 */
function resignFromCaptured(req: HttpRequest): string {
  const url = new URL(req.url)
  const headers = req.headers ?? {}
  const params: SignEntry[] = []
  for (const [k, v] of url.searchParams) params.push([k, v]) // URLSearchParams 迭代即解码一层
  if (typeof req.body === "string") {
    for (const [k, v] of new URLSearchParams(req.body)) params.push([k, v])
  }
  params.push(["randnum__", headers["X-Sc-Nd"] ?? ""])
  params.push(["timestamp__", headers["X-Sc-Td"] ?? ""])
  return makeSign(params)
}

beforeEach(() => {
  sendMock.mockReset()
})

describe("skbirdImageUrl", () => {
  it("相对路径补前导斜杠（img_paths 实测为 upload/xx.jpg 形态）", () => {
    // 线上事故回归：不带 "/" 的路径曾拼出 b1.cdn.zanao.comupload
    expect(skbirdImageUrl("upload/a/b.jpg")).toBe(
      "https://b1.cdn.zanao.com/upload/a/b.jpg@!sm_w400"
    )
    expect(skbirdImageUrl("/upload/a/b.jpg")).toBe(
      "https://b1.cdn.zanao.com/upload/a/b.jpg@!sm_w400"
    )
  })

  it("完整 URL 原样返回", () => {
    expect(skbirdImageUrl("http://b2.cdn.zanao.com/x.jpg")).toBe("http://b2.cdn.zanao.com/x.jpg")
  })

  it("缩放档位后缀；original 走 @!common 原图", () => {
    expect(skbirdImageUrl("upload/a.jpg", { w: 200, h: 200 })).toBe(
      "https://b1.cdn.zanao.com/upload/a.jpg@!sm_w200_h200"
    )
    expect(skbirdImageUrl("upload/a.jpg", { w: 400 })).toBe(
      "https://b1.cdn.zanao.com/upload/a.jpg@!sm_w400"
    )
    expect(skbirdImageUrl("upload/a.jpg", "original")).toBe(
      "https://b1.cdn.zanao.com/upload/a.jpg@!common"
    )
  })
})

describe("generateDeviceId", () => {
  it("生成 8-4-4-4-12-16 hex 段格式，且每次不同", () => {
    const a = generateDeviceId()
    const b = generateDeviceId()
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[0-9a-f]{16}$/)
    expect(a).not.toBe(b)
  })
})

describe("SkbirdClient 请求契约", () => {
  it("GET：query 参数并入签名，头部齐全", async () => {
    sendMock.mockResolvedValue(okResponse({ list: [] }))
    await new SkbirdClient(CONFIG).latest()

    const req = sendMock.mock.calls[0]![0]
    expect(req.method).toBe("GET")
    expect(req.url).toMatch(/^http:\/\/api\.app\.zanao\.com\/thread\/v2\/list\?/)
    const h = req.headers ?? {}
    expect(h["X-Sc-Token"]).toBe("TOKEN")
    expect(h["X-Sc-Device"]).toBe("DEVICE")
    expect(h["X-Sc-Alias"]).toBe("ysu")
    expect(h["X-Sc-Version"]).toBe("2.6.0")
    expect(h["X-Sc-Td"]).toMatch(/^\d+$/)
    expect(h["X-Sc-Nd"]).toMatch(/^\d{20}$/)
    // 关键契约：GET 的 query 参数必须参与签名（漏掉即 errno=6）
    expect(resignFromCaptured(req)).toBe(h["X-Sc-Ah"])
  })

  it("POST：form body 参数并入签名", async () => {
    sendMock.mockResolvedValue(okResponse({ detail: {} }))
    await new SkbirdClient(CONFIG).thread("123")

    const req = sendMock.mock.calls[0]![0]
    expect(req.method).toBe("POST")
    expect(req.url).toBe("http://api.app.zanao.com/thread/info")
    expect(req.headers?.["Content-Type"]).toBe("application/x-www-form-urlencoded")
    expect(req.body).toBe("from=&id=123")
    expect(resignFromCaptured(req)).toBe(req.headers?.["X-Sc-Ah"])
  })

  it("errno != 0 抛出带 errno 的 SkbirdError", async () => {
    sendMock.mockResolvedValue({
      ...okResponse(null),
      text: async () => JSON.stringify({ errno: 10, errmsg: "用户本地网络异常" }),
    })
    const err = await new SkbirdClient(CONFIG).hot().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SkbirdError)
    expect((err as SkbirdError).errno).toBe(10)
  })

  it("thread()：返回详情与评论签名（data.t_sign）", async () => {
    sendMock.mockResolvedValue(
      okResponse({
        detail: { thread_id: 123, title: "t" },
        t_sign: "SIGN+BLOB==",
      })
    )
    const d = await new SkbirdClient(CONFIG).thread("123")
    expect(d.thread.threadId).toBe("123")
    expect(d.thread.title).toBe("t")
    expect(d.commentSign).toBe("SIGN+BLOB==")
  })

  it("comments()：t_sign 作为 sign 参数并入签名", async () => {
    sendMock.mockResolvedValue(okResponse({ list: [{ comment_id: 1, content: "hi" }] }))
    const list = await new SkbirdClient(CONFIG).comments("123", "SIGN+BLOB==")

    expect(list).toHaveLength(1)
    expect(list[0]!.content).toBe("hi")
    const req = sendMock.mock.calls[0]![0]
    expect(req.method).toBe("GET")
    expect(req.url).toContain("/comment/list?")
    // sign 值必须经 URL 编码传输（含 +/= 的 blob 原样会断签）
    expect(req.url).toContain(`sign=${encodeURIComponent("SIGN+BLOB==")}`)
    // 关键契约：sign 参数参与 X-Sc-Ah 计算
    expect(resignFromCaptured(req)).toBe(req.headers?.["X-Sc-Ah"])
  })

  it("comments()：无 t_sign 时直接返回空，不发请求", async () => {
    await expect(new SkbirdClient(CONFIG).comments("123", "")).resolves.toEqual([])
    expect(sendMock).not.toHaveBeenCalled()
  })

  it("categories()：解析 cate_list", async () => {
    sendMock.mockResolvedValue(
      okResponse({
        cate_list: [
          {
            cate_id: "101",
            name: "二手闲置",
            summary: "本校线下交易",
            icon_path: "upload/x.png",
          },
        ],
      })
    )
    const list = await new SkbirdClient(CONFIG).categories()
    expect(list).toEqual([
      {
        cateId: "101",
        name: "二手闲置",
        summary: "本校线下交易",
        iconPath: "upload/x.png",
      },
    ])
  })

  it("latest()：cateId 与 from_time 游标并入签名", async () => {
    sendMock.mockResolvedValue(okResponse({ list: [] }))
    await new SkbirdClient(CONFIG).latest("1787378674", "101")
    const req = sendMock.mock.calls[0]![0]
    expect(req.url).toContain("cate_id=101")
    expect(req.url).toContain("from_time=1787378674")
    expect(resignFromCaptured(req)).toBe(req.headers?.["X-Sc-Ah"])
  })

  it("rewardList()：正确路径与游标参数", async () => {
    sendMock.mockResolvedValue(okResponse({ list: [] }))
    await new SkbirdClient(CONFIG).rewardList("1787378674")
    const req = sendMock.mock.calls[0]![0]
    expect(req.url).toMatch(/\/thread\/rewardlist\?/)
    expect(req.url).toContain("from_time=1787378674")
    expect(resignFromCaptured(req)).toBe(req.headers?.["X-Sc-Ah"])
  })

  it("like()：评论点赞携带 comment_id", async () => {
    sendMock.mockResolvedValue(okResponse({}))
    await new SkbirdClient(CONFIG).like("123", 1, "456")
    const req = sendMock.mock.calls[0]![0]
    expect(req.body).toBe("action=1&id=123&comment_id=456")
    expect(resignFromCaptured(req)).toBe(req.headers?.["X-Sc-Ah"])
  })

  it("messages()/unreadNum()/likeStat()/userStats()：字段映射", async () => {
    const client = new SkbirdClient(CONFIG)
    sendMock.mockResolvedValueOnce(
      okResponse({
        list: [{ msg_id: "1", content: "c", nickname: "n", p_time: 1787378674 }],
      })
    )
    const msgs = await client.messages()
    expect(msgs[0]).toMatchObject({
      id: "1",
      content: "c",
      nickname: "n",
      time: 1787378674,
    })
    expect(sendMock.mock.calls[0]![0].url).toContain("from_time=0")

    sendMock.mockResolvedValueOnce(okResponse({ im_count: 1, count: 2, mark_count: 3 }))
    await expect(client.unreadNum()).resolves.toEqual({
      imCount: 1,
      count: 2,
      markCount: 3,
    })

    sendMock.mockResolvedValueOnce(okResponse({ chat_show: false, like_num: "9", new_like_num: 4 }))
    await expect(client.likeStat()).resolves.toEqual({
      likeNum: 9,
      newLikeNum: 4,
    })

    sendMock.mockResolvedValueOnce(okResponse({ thread_count: 7, user_coin: 42 }))
    await expect(client.userStats()).resolves.toEqual({
      threadCount: 7,
      userCoin: 42,
    })
  })

  it("评论映射：reply_list 递归为 replies", async () => {
    sendMock.mockResolvedValue(
      okResponse({
        list: [
          {
            comment_id: "1",
            content: "root",
            like_has: true,
            author_liked: false,
            reply_list: [{ comment_id: "2", content: "sub", like_num: "3" }],
          },
        ],
      })
    )
    const list = await new SkbirdClient(CONFIG).comments("123", "S")
    expect(list[0]!.likeHas).toBe(true)
    expect(list[0]!.replies).toHaveLength(1)
    expect(list[0]!.replies[0]).toMatchObject({
      commentId: "2",
      content: "sub",
      likeCount: 3,
    })
  })

  it("unlockThread()：帖在热榜时直接取全文+图片，不走 mark 链", async () => {
    sendMock.mockResolvedValueOnce(
      okResponse({
        list: [
          {
            thread_id: "9",
            title: "认证帖标题",
            content: "全文",
            img_paths: ["upload/x.jpg"],
            cert_show: "10",
          },
        ],
      })
    )
    const t = await new SkbirdClient(CONFIG).unlockThread("9")
    expect(t).toMatchObject({
      threadId: "9",
      title: "认证帖标题",
      imgPaths: ["upload/x.jpg"],
    })
    // 只调用了 /thread/hot，未触发 mark/post
    expect(sendMock).toHaveBeenCalledTimes(1)
    expect(sendMock.mock.calls[0]![0].url).toContain("/thread/hot")
  })

  it("unlockThread()：热榜/悬赏都未命中时走 mark→mark/list→unmark（纯文字）", async () => {
    sendMock
      .mockResolvedValueOnce(okResponse({ list: [] })) // hot 未命中
      .mockResolvedValueOnce(okResponse({ list: [] })) // rewardlist 未命中
      .mockResolvedValueOnce(okResponse({})) // mark 1
      .mockResolvedValueOnce(
        okResponse({
          list: [{ thread_id: "9", title: "全文标题", content: "全文" }],
        })
      ) // mark/list
      .mockResolvedValueOnce(okResponse({})) // mark 2
    const t = await new SkbirdClient(CONFIG).unlockThread("9")
    expect(t).toMatchObject({ threadId: "9", title: "全文标题", imgPaths: [] })
    const paths = sendMock.mock.calls.map((c) => c[0].url)
    expect(paths[1]).toContain("/thread/rewardlist")
    expect(paths[2]).toContain("/thread/mark/post")
    expect(paths[3]).toContain("/thread/mark/list")
    expect(paths[4]).toContain("/thread/mark/post")
    // unmark: 最后一个请求 body action=2
    expect(sendMock.mock.calls[4]![0].body).toBe("action=2&id=9")
  })

  it("unlockThread()：帖在悬赏流时取全文+图片，不走 mark 链", async () => {
    sendMock
      .mockResolvedValueOnce(okResponse({ list: [] })) // hot 未命中
      .mockResolvedValueOnce(
        okResponse({
          list: [
            {
              thread_id: "9",
              title: "悬赏认证帖",
              content: "全文",
              img_paths: ["upload/r.jpg"],
            },
          ],
        })
      ) // rewardlist 命中
    const t = await new SkbirdClient(CONFIG).unlockThread("9")
    expect(t).toMatchObject({ threadId: "9", imgPaths: ["upload/r.jpg"] })
    expect(sendMock).toHaveBeenCalledTimes(2)
  })

  it("search()：cate_id=10 实时帖不带 range；cate_id=20 历史帖 range 生效", async () => {
    const client = new SkbirdClient(CONFIG)
    sendMock.mockResolvedValue(okResponse({ list: [] }))

    await client.search("肯德基", 1, "")
    let req = sendMock.mock.calls[0]![0]
    expect(req.body).toBe("cate_id=10&cur_page=1&wd=%E8%82%AF%E5%BE%B7%E5%9F%BA")
    expect(resignFromCaptured(req)).toBe(req.headers?.["X-Sc-Ah"])

    await client.search("肯德基", 2, "1m")
    req = sendMock.mock.calls[1]![0]
    expect(req.body).toBe("cate_id=20&range=1m&cur_page=2&wd=%E8%82%AF%E5%BE%B7%E5%9F%BA")
    expect(resignFromCaptured(req)).toBe(req.headers?.["X-Sc-Ah"])
  })

  it("userInfo()：解析 data.user_info 嵌套结构", async () => {
    sendMock.mockResolvedValueOnce(
      okResponse({
        group_info: {},
        user_info: {
          nickname: "邮文",
          headimgurl: "https://thirdwx.qlogo.cn/mmopen/x/132",
          user_exp: "57",
          cert_status: "no",
          user_level: 2,
          user_level_title: "小学生",
          next_level_info: { exp: 100, title: "初中生" },
          reg_days: 763,
        },
      })
    )
    const u = await new SkbirdClient(CONFIG).userInfo()
    expect(u).toEqual({
      nickname: "邮文",
      avatarUrl: "https://thirdwx.qlogo.cn/mmopen/x/132",
      level: 2,
      levelTitle: "小学生",
      exp: 57,
      nextLevelExp: 100,
      nextLevelTitle: "初中生",
      certStatus: "no",
      regDays: 763,
    })
  })
})
