/**
 * AES-128-ECB（PKCS7）纯 TS 实现。
 * WebCrypto 不提供 ECB 模式，而 17wanxiao SWAEEncryptServlet 协议要求
 * ECB + 动态 key，故自带实现。仅处理该协议的小 payload，性能无关。
 *
 * state 布局遵循 FIPS-197：列优先，state[r][c] = input[4c + r]。
 */

// ─── GF(2⁸) 与 S-box 生成 ─────────────────────────────────────────────── //

function gmul(a: number, b: number): number {
  let p = 0;
  for (let i = 0; i < 8; i++) {
    if (b & 1) p ^= a;
    const hi = a & 0x80;
    a = (a << 1) & 0xff;
    if (hi) a ^= 0x1b;
    b >>= 1;
  }
  return p;
}

function rotl8(x: number, n: number): number {
  return ((x << n) | (x >>> (8 - n))) & 0xff;
}

const SBOX = new Uint8Array(256);
const INV_SBOX = new Uint8Array(256);

// S-box：乘法逆元 + 仿射变换（FIPS-197 §5.1.1），模块加载时一次性生成
for (let x = 0; x < 256; x++) {
  let inv = 0;
  if (x !== 0) {
    for (let y = 1; y < 256; y++) {
      if (gmul(x, y) === 1) {
        inv = y;
        break;
      }
    }
  }
  const s = inv ^ rotl8(inv, 1) ^ rotl8(inv, 2) ^ rotl8(inv, 3) ^ rotl8(inv, 4) ^ 0x63;
  SBOX[x] = s;
  INV_SBOX[s] = x;
}

// ─── 分组运算 ─────────────────────────────────────────────────────────── //

function expandKey(key: Uint8Array): Uint8Array {
  if (key.length !== 16) throw new Error("AES-128 key must be 16 bytes");
  const w = new Uint8Array(176);
  w.set(key);
  let rcon = 1;
  for (let i = 16; i < 176; i += 4) {
    let t0 = w[i - 4]!;
    let t1 = w[i - 3]!;
    let t2 = w[i - 2]!;
    let t3 = w[i - 1]!;
    if (i % 16 === 0) {
      // RotWord + SubWord + Rcon
      const tmp = t0;
      t0 = SBOX[t1!]! ^ rcon;
      t1 = SBOX[t2!]!;
      t2 = SBOX[t3!]!;
      t3 = SBOX[tmp]!;
      rcon = gmul(rcon, 2);
    }
    w[i] = w[i - 16]! ^ t0;
    w[i + 1] = w[i - 15]! ^ t1;
    w[i + 2] = w[i - 14]! ^ t2;
    w[i + 3] = w[i - 13]! ^ t3;
  }
  return w;
}

function addRoundKey(s: Uint8Array, w: Uint8Array, off: number): void {
  for (let i = 0; i < 16; i++) s[i]! ^= w[off + i]!;
}

function subBytes(s: Uint8Array, box: Uint8Array): void {
  for (let i = 0; i < 16; i++) s[i] = box[s[i]!]!;
}

function shiftRows(s: Uint8Array): void {
  let t = s[1]!;
  s[1] = s[5]!;
  s[5] = s[9]!;
  s[9] = s[13]!;
  s[13] = t;
  t = s[2]!;
  s[2] = s[10]!;
  s[10] = t;
  t = s[6]!;
  s[6] = s[14]!;
  s[14] = t;
  t = s[15]!;
  s[15] = s[11]!;
  s[11] = s[7]!;
  s[7] = s[3]!;
  s[3] = t;
}

function invShiftRows(s: Uint8Array): void {
  let t = s[13]!;
  s[13] = s[9]!;
  s[9] = s[5]!;
  s[5] = s[1]!;
  s[1] = t;
  t = s[2]!;
  s[2] = s[10]!;
  s[10] = t;
  t = s[6]!;
  s[6] = s[14]!;
  s[14] = t;
  t = s[3]!;
  s[3] = s[7]!;
  s[7] = s[11]!;
  s[11] = s[15]!;
  s[15] = t;
}

function mixColumns(s: Uint8Array): void {
  for (let c = 0; c < 4; c++) {
    const i = 4 * c;
    const a0 = s[i]!;
    const a1 = s[i + 1]!;
    const a2 = s[i + 2]!;
    const a3 = s[i + 3]!;
    s[i] = gmul(a0, 2) ^ gmul(a1, 3) ^ a2 ^ a3;
    s[i + 1] = a0 ^ gmul(a1, 2) ^ gmul(a2, 3) ^ a3;
    s[i + 2] = a0 ^ a1 ^ gmul(a2, 2) ^ gmul(a3, 3);
    s[i + 3] = gmul(a0, 3) ^ a1 ^ a2 ^ gmul(a3, 2);
  }
}

function invMixColumns(s: Uint8Array): void {
  for (let c = 0; c < 4; c++) {
    const i = 4 * c;
    const a0 = s[i]!;
    const a1 = s[i + 1]!;
    const a2 = s[i + 2]!;
    const a3 = s[i + 3]!;
    s[i] = gmul(a0, 14) ^ gmul(a1, 11) ^ gmul(a2, 13) ^ gmul(a3, 9);
    s[i + 1] = gmul(a0, 9) ^ gmul(a1, 14) ^ gmul(a2, 11) ^ gmul(a3, 13);
    s[i + 2] = gmul(a0, 13) ^ gmul(a1, 9) ^ gmul(a2, 14) ^ gmul(a3, 11);
    s[i + 3] = gmul(a0, 11) ^ gmul(a1, 13) ^ gmul(a2, 9) ^ gmul(a3, 14);
  }
}

function encryptBlock(block: Uint8Array, w: Uint8Array): Uint8Array {
  const s = Uint8Array.from(block);
  addRoundKey(s, w, 0);
  for (let round = 1; round <= 9; round++) {
    subBytes(s, SBOX);
    shiftRows(s);
    mixColumns(s);
    addRoundKey(s, w, round * 16);
  }
  subBytes(s, SBOX);
  shiftRows(s);
  addRoundKey(s, w, 160);
  return s;
}

function decryptBlock(block: Uint8Array, w: Uint8Array): Uint8Array {
  const s = Uint8Array.from(block);
  addRoundKey(s, w, 160);
  for (let round = 9; round >= 1; round--) {
    invShiftRows(s);
    subBytes(s, INV_SBOX);
    addRoundKey(s, w, round * 16);
    invMixColumns(s);
  }
  invShiftRows(s);
  subBytes(s, INV_SBOX);
  addRoundKey(s, w, 0);
  return s;
}

// ─── ECB + PKCS7 + base64 ─────────────────────────────────────────────── //

export function aes128EcbEncrypt(key: Uint8Array, data: Uint8Array): Uint8Array {
  const w = expandKey(key);
  const padLen = 16 - (data.length % 16);
  const padded = new Uint8Array(data.length + padLen);
  padded.set(data);
  padded.fill(padLen, data.length);
  const out = new Uint8Array(padded.length);
  for (let off = 0; off < padded.length; off += 16) {
    out.set(encryptBlock(padded.subarray(off, off + 16), w), off);
  }
  return out;
}

export function aes128EcbDecrypt(key: Uint8Array, data: Uint8Array): Uint8Array {
  if (data.length === 0 || data.length % 16 !== 0) throw new Error("invalid ECB ciphertext length");
  const w = expandKey(key);
  const out = new Uint8Array(data.length);
  for (let off = 0; off < data.length; off += 16) {
    out.set(decryptBlock(data.subarray(off, off + 16), w), off);
  }
  const padLen = out[out.length - 1]!;
  if (padLen < 1 || padLen > 16) throw new Error("invalid PKCS7 padding");
  for (let i = out.length - padLen; i < out.length; i++) {
    if (out[i] !== padLen) throw new Error("invalid PKCS7 padding");
  }
  return out.subarray(0, out.length - padLen);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
