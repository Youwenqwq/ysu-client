/**
 * 服务端渲染 HTML 表格的最小抽取器（移植自 ysu-sdk 的 _table.py，零依赖）。
 *
 * 先极科技的两套系统（ldxt 劳动教育 / ysu_xf 双创学分）都是 ASP.NET MVC
 * 服务端渲染，数据直接嵌在页面的 <table> 里，故以 HTML 表格为准。
 *
 * 设计要点（与 SDK 一致）：
 * - 只收集顶层 <table>——主表单元格里嵌套了详情小表，嵌套表内容一律忽略；
 * - 活动名单元格内可能有 <span class="m-badge"> 徽标，单独收集到 badges；
 * - 单元格文本压缩空白。
 */

export interface TableData {
  headers: string[];
  rows: string[][];
  /** 与 rows 对齐：每行各单元格内的徽标文本（多数单元格为空数组）。 */
  badges: string[][][];
}

const WS_RE = /\s+/g;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|\w+);/g, (match, body: string) => {
    if (body.startsWith('#')) {
      const isHex = body[1] === 'x' || body[1] === 'X';
      const code = parseInt(body.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      if (Number.isNaN(code)) return match;
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    return NAMED_ENTITIES[body] ?? match;
  });
}

interface Token {
  type: 'start' | 'end' | 'text';
  name?: string;
  attrs?: Record<string, string>;
  data?: string;
}

function tokenize(html: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = html.length;

  while (i < n) {
    const lt = html.indexOf('<', i);
    if (lt === -1) {
      const text = decodeEntities(html.slice(i));
      if (text) tokens.push({ type: 'text', data: text });
      break;
    }
    if (lt > i) {
      const text = decodeEntities(html.slice(i, lt));
      if (text) tokens.push({ type: 'text', data: text });
    }

    // 注释与声明：<!-- ... -->、<!DOCTYPE ...>、<?...?>
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      i = end === -1 ? n : end + 3;
      continue;
    }
    if (html.startsWith('<!', lt) || html.startsWith('<?', lt)) {
      const end = html.indexOf('>', lt + 2);
      i = end === -1 ? n : end + 1;
      continue;
    }

    const isEnd = html[lt + 1] === '/';
    let j = lt + (isEnd ? 2 : 1);
    const nameStart = j;
    while (j < n && /[a-zA-Z0-9-]/.test(html[j]!)) j++;
    const name = html.slice(nameStart, j).toLowerCase();

    // 扫描到标签结束，跳过引号内的 '>'
    let gt = j;
    let quote: string | null = null;
    while (gt < n) {
      const ch = html[gt]!;
      if (quote) {
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === '>') {
        break;
      }
      gt++;
    }

    if (isEnd) {
      tokens.push({ type: 'end', name });
    } else {
      const attrText = html.slice(j, gt);
      const attrs: Record<string, string> = {};
      const attrRe = /([\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|[^\s>]+))?/g;
      let m: RegExpExecArray | null;
      while ((m = attrRe.exec(attrText)) !== null) {
        const key = m[1]!.toLowerCase();
        if (key === '/') continue;
        let value = m[2] ?? m[3] ?? '';
        if (!value && m[0].includes('=')) {
          value = m[0].slice(m[0].indexOf('=') + 1).trim();
        }
        attrs[key] = decodeEntities(value);
      }
      tokens.push({ type: 'start', name, attrs });
    }
    i = gt + 1;
  }

  return tokens;
}

class TableExtractor {
  readonly tables: TableData[] = [];
  private tableDepth = 0;
  private cur: TableData | null = null;
  private inHeader = false;
  private curRow: string[] | null = null;
  private curBadges: string[][] | null = null;
  private cellText: string[] | null = null;
  private cellBadges: string[] | null = null;
  private inBadge = false;

  handleStart(name: string, attrs: Record<string, string>): void {
    if (name === 'table') {
      this.tableDepth += 1;
      if (this.tableDepth === 1) {
        this.cur = { headers: [], rows: [], badges: [] };
      }
      return;
    }
    if (this.tableDepth !== 1 || this.cur === null) return;
    if (name === 'tr') {
      this.curRow = [];
      this.curBadges = [];
    } else if (name === 'th' || name === 'td') {
      this.cellText = [];
      this.cellBadges = [];
      this.inHeader = name === 'th';
    } else if (name === 'span' && this.cellText !== null) {
      if ((attrs['class'] ?? '').includes('m-badge')) {
        this.inBadge = true;
      }
    }
  }

  handleData(data: string): void {
    if (this.tableDepth !== 1 || this.cellText === null) return;
    if (this.inBadge) {
      this.cellBadges!.push(data);
    } else {
      this.cellText.push(data);
    }
  }

  handleEnd(name: string): void {
    if (name === 'table') {
      if (this.tableDepth === 1 && this.cur !== null) {
        this.tables.push(this.cur);
        this.cur = null;
      }
      this.tableDepth = Math.max(0, this.tableDepth - 1);
      return;
    }
    if (this.tableDepth !== 1 || this.cur === null) return;
    if (name === 'span') {
      this.inBadge = false;
    } else if ((name === 'th' || name === 'td') && this.cellText !== null) {
      let text = this.cellText.join('').replace(WS_RE, ' ').trim();
      const badges = (this.cellBadges ?? [])
        .map((b) => b.replace(WS_RE, ' ').trim())
        .filter((b) => b);
      // 有的单元格整体就是一个徽标（如审核状态），此时以徽标文本为准
      if (!text && badges.length > 0) {
        text = badges.join(' ');
      }
      if (this.inHeader) {
        this.cur.headers.push(text);
      } else if (this.curRow !== null) {
        this.curRow.push(text);
        this.curBadges!.push(badges);
      }
      this.cellText = null;
      this.cellBadges = null;
    } else if (name === 'tr' && this.curRow !== null) {
      if (this.curRow.some((cell) => cell)) {
        this.cur.rows.push(this.curRow);
        this.cur.badges.push(this.curBadges ?? []);
      }
      this.curRow = null;
      this.curBadges = null;
    }
  }
}

/** 抽取页面中的全部顶层表格。 */
export function parseTables(html: string): TableData[] {
  const extractor = new TableExtractor();
  for (const token of tokenize(html)) {
    if (token.type === 'start') {
      extractor.handleStart(token.name!, token.attrs!);
    } else if (token.type === 'end') {
      extractor.handleEnd(token.name!);
    } else {
      extractor.handleData(token.data!);
    }
  }
  return extractor.tables;
}
