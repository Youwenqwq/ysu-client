import { describe, expect, it } from "vitest";
import { md5Hex } from "./md5";
import { makeSign, type SignEntry } from "./sign";
import fixtures from "./sign-fixtures.json";

describe("md5", () => {
  it("matches RFC 1321 test vectors", () => {
    const enc = new TextEncoder();
    expect(md5Hex(enc.encode(""))).toBe("d41d8cd98f00b204e9800998ecf8427e");
    expect(md5Hex(enc.encode("abc"))).toBe("900150983cd24fb0d6963f7d28e17f72");
    expect(md5Hex(enc.encode("message digest"))).toBe("f96b697d7cb7938d525a2f31aaf161d0");
    expect(md5Hex(enc.encode("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"))).toBe(
      "d174ab98d277d9f5a5611c2c9f419d9f",
    );
  });
});

describe("makeSign", () => {
  // 真实 2.6.0 native 库（libAesNew.so）的 oracle 值，来自 purepy/selftest.py
  const ORACLES: Array<[SignEntry[], string]> = [
    [
      [
        ["randnum__", "A"],
        ["timestamp__", "B"],
      ],
      "32BFE5C80C3C124B06220EE35925B574",
    ],
    [
      [
        ["randnum__", "AA"],
        ["timestamp__", "BB"],
      ],
      "0223540EFF1734F98651A7D0C5A0C10F",
    ],
    [
      [
        ["randnum__", "A"],
        ["timestamp__", "B"],
        ["x", "1"],
      ],
      "7FC18AB42844F98EAC9F9756FC5DAE16",
    ],
    [
      [
        ["randnum__", "A"],
        ["timestamp__", "B"],
        ["x", "1"],
        ["y", "2"],
      ],
      "13E2F62F58E57EA096C0D1B89488E0F2",
    ],
  ];

  it.each(ORACLES)("matches native oracle %o", (entries, expected) => {
    expect(makeSign(entries)).toBe(expected);
  });

  it.each(fixtures.map((f, i) => [i, f] as const))("replays captured signature #%i", (_i, f) => {
    // JSON fixture 类型为 string[][]，逐项收敛为二元组
    const entries: SignEntry[] = f.entries.map((e) => {
      if (e.length !== 2) throw new Error("malformed sign fixture entry");
      return [e[0]!, e[1]!];
    });
    expect(makeSign(entries)).toBe(f.expected);
  });
});
