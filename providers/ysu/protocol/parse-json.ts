
/**
 * 解析“宽松 JSON”（key 不带引号，形如 {D:{root:""}}）。
 * 金智系站点（jwxt/emap/epay）后端常返回非标准 JSON，严格 JSON.parse
 * 会失败；先给未加引号的 key 补上引号再解析。
 *
 * 加固：设置最大输入长度，防止超大/恶意 payload 造成解析压力。
 */
const LOOSE_JSON_MAX_LEN = 2 * 1024 * 1024 // 2 MiB

export function parseLooseJson(input: string): unknown {
  if (typeof input !== "string" || input.length > LOOSE_JSON_MAX_LEN) {
    throw new Error("parseLooseJson: input too large or not a string")
  }
  // Skip quoted strings as whole tokens: key-like text inside a value is data.
  const pre = input.replace(
    /"(?:[^"\\]|\\[\s\S])*"|([{\[,]\s*)([A-Za-z_$][\w$]*)(\s*:)/g,
    (token, prefix: string | undefined, key: string, colon: string) =>
      prefix === undefined ? token : `${prefix}"${key}"${colon}`
  )
  return JSON.parse(pre)
}

