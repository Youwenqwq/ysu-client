/**
 * 森空鸟 X-Sc-Ah 请求签名引擎 2.6.0。
 *
 * 算法：
 *   RT     = randnum__ + timestamp__          （直接拼接，无分隔符）
 *   b64key = base64(RT, 自定义字母表 KEY)
 *   str2   = lowercase_hex(md5(b64key))
 *   mix[i] = b64key[i] + str2[i % 32] (mod 256)
 *   kv     = 全部参数按 TreeMap 序 "k=v" & 连接，跳过 key=="key"
 *   final  = kv + "&secretkey=" + std_base64(mix)
 *   X-Sc-Ah = UPPER(hex(md5(final)))
 *
 * 参数 = URL query（解码一层）+ form body（解码一层）+ randnum__ + timestamp__。
 */
import { md5Hex } from "./md5"

// libAesNew.so .bss 解密后的 64 字符自定义 base64 字母表（2.6.0）
const KEY = "HySuiITldDszAQ9ZCx2pkePtE0qgUr_JYn1KNjO-afc4b7M658BFGLRVWXhmovw3"
const STD_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

export type SignEntry = readonly [key: string, value: string]

const encoder = new TextEncoder()

function b64Encode(data: Uint8Array, alphabet: string): string {
  let out = ""
  for (let i = 0; i < data.length; i += 3) {
    const remaining = data.length - i
    const n = (data[i] << 16) | ((data[i + 1] ?? 0) << 8) | (data[i + 2] ?? 0)
    out += alphabet[(n >> 18) & 63] + alphabet[(n >> 12) & 63]
    out += remaining >= 2 ? alphabet[(n >> 6) & 63] : "="
    out += remaining >= 3 ? alphabet[n & 63] : "="
  }
  return out
}

/** 计算 X-Sc-Ah。entries 为解码后的 (key, value) 对，必须含 randnum__ / timestamp__。 */
export function makeSign(entries: SignEntry[]): string {
  let randnum = ""
  let timestamp = ""
  for (const [k, v] of entries) {
    if (k === "randnum__") randnum = v
    else if (k === "timestamp__") timestamp = v
  }

  const b64key = b64Encode(encoder.encode(randnum + timestamp), KEY)
  const b64keyBytes = encoder.encode(b64key)
  const str2 = encoder.encode(md5Hex(b64keyBytes)) // 小写 hex 的 ASCII 字节
  const mix = new Uint8Array(b64keyBytes.length)
  for (let i = 0; i < mix.length; i++) {
    mix[i] = (b64keyBytes[i] + str2[i % str2.length]) & 0xff
  }

  // TreeMap 序：key 升序，同 key 按 value 升序（与 Python sorted(tuples) 一致）
  const sorted = entries
    .filter(([k]) => k !== "key")
    .slice()
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
  const kv = sorted.map(([k, v]) => `${k}=${v}`).join("&")

  const kvBytes = encoder.encode(kv)
  const tailBytes = encoder.encode(`&secretkey=${b64Encode(mix, STD_ALPHABET)}`)
  const final = new Uint8Array(kvBytes.length + tailBytes.length)
  final.set(kvBytes)
  final.set(tailBytes, kvBytes.length)
  return md5Hex(final).toUpperCase()
}
