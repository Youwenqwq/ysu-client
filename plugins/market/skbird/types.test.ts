import { describe, expect, it } from "vitest"
import { mergeSkbirdThread, toThread } from "./types"

describe("mergeSkbirdThread", () => {
  it("详情缺少图片或认证标记时使用列表数据补齐", () => {
    const detail = toThread({
      thread_id: "9",
      title: "完整标题",
      content: "完整正文",
      cert_show: "0",
      img_paths: [],
    })
    const list = toThread({
      thread_id: "9",
      cert_show: "10",
      img_paths: ["upload/x.jpg"],
    })

    expect(mergeSkbirdThread(detail, list)).toMatchObject({
      title: "完整标题",
      content: "完整正文",
      certShow: "10",
      imgPaths: ["upload/x.jpg"],
    })
  })

  it("解锁接口不返回图片时不覆盖已有列表图片", () => {
    const list = toThread({
      thread_id: "9",
      cert_show: "10",
      img_paths: ["upload/x.jpg"],
    })
    const unlocked = toThread({
      thread_id: "9",
      title: "完整标题",
      content: "完整正文",
      cert_show: "10",
      img_paths: [],
    })

    expect(mergeSkbirdThread(list, unlocked)).toMatchObject({
      title: "完整标题",
      content: "完整正文",
      imgPaths: ["upload/x.jpg"],
    })
  })
})
