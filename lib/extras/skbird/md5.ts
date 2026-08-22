/**
 * MD5 (RFC 1321) — vendored, zero-dependency.
 * 森空鸟签名引擎需要 MD5；浏览器 crypto.subtle 无 MD5，故自带实现。
 * 输入字节，输出小写 hex。
 */

const K = new Int32Array(64).map(
  (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) | 0,
);

// 每轮循环左移位数（RFC 1321 §3.4）
// prettier-ignore
const S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

const HEX = "0123456789abcdef";

export function md5Hex(input: Uint8Array): string {
  const bitLen = input.length * 8;
  // 附加 0x80 + 填充至 ≡56 (mod 64) + 8 字节小端位长度
  const paddedLen = (((input.length + 8) >> 6) + 1) << 6;
  const buf = new Uint8Array(paddedLen);
  buf.set(input);
  buf[input.length] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(paddedLen - 8, bitLen >>> 0, true);
  dv.setUint32(paddedLen - 4, Math.floor(bitLen / 4294967296), true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89 | 0;
  let c0 = 0x98badcfe | 0;
  let d0 = 0x10325476;

  for (let off = 0; off < paddedLen; off += 64) {
    const M = new Int32Array(16);
    for (let i = 0; i < 16; i++) M[i] = dv.getUint32(off + i * 4, true) | 0;

    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;
    for (let i = 0; i < 64; i++) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      const tmp = d;
      d = c;
      c = b;
      const sum = (a + f + K[i] + M[g]) | 0;
      b = (b + ((sum << S[i]) | (sum >>> (32 - S[i])))) | 0;
      a = tmp;
    }
    a0 = (a0 + a) | 0;
    b0 = (b0 + b) | 0;
    c0 = (c0 + c) | 0;
    d0 = (d0 + d) | 0;
  }

  let out = "";
  for (const word of [a0, b0, c0, d0]) {
    for (let j = 0; j < 4; j++) {
      const byte = (word >>> (j * 8)) & 0xff; // 小端
      out += HEX[byte >> 4] + HEX[byte & 0xf];
    }
  }
  return out;
}
