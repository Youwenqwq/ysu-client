import { describe, expect, it } from "vitest"
import {
  readSkbirdFeedSnapshot,
  SKBIRD_FEED_STATE_KEY,
  type SkbirdFeedSnapshot,
  writeSkbirdFeedSnapshot,
} from "./feed-state"

function makeStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  }
}

const SNAPSHOT: SkbirdFeedSnapshot = {
  version: 1,
  tab: "latest",
  wd: "考试",
  submittedWd: "考试",
  cateId: "101",
  range: "7d",
  threads: [],
  hasMore: true,
  cursor: "1700000000",
  searchPage: 3,
  searchOpen: true,
  scrollY: 640,
  mainScrollTop: 1280,
}

describe("skbird feed state", () => {
  it("保存并恢复列表筛选、分页和滚动状态", () => {
    const storage = makeStorage()

    writeSkbirdFeedSnapshot(SNAPSHOT, storage)

    expect(readSkbirdFeedSnapshot(storage)).toEqual(SNAPSHOT)
  })

  it("忽略旧版本或损坏的快照，避免阻断列表加载", () => {
    const storage = makeStorage()
    storage.setItem(
      SKBIRD_FEED_STATE_KEY,
      JSON.stringify({ ...SNAPSHOT, version: 0, threads: "invalid" })
    )

    expect(readSkbirdFeedSnapshot(storage)).toBeNull()
  })
})
