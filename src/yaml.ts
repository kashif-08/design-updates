// A small YAML reader for watchlist.yaml, so the project needs no npm packages.
// Supports: nested mappings, "- " sequences (of scalars or mappings), [a, b] and { k: v } inline
// collections, quoted strings, numbers, booleans, null and # comments. Not anchors, tags or multi-line strings.

type Line = { indent: number; text: string; no: number };

export class YamlError extends Error {
  constructor(message: string, line?: number) {
    super(line ? `watchlist.yaml line ${line}: ${message}` : message);
    this.name = 'YamlError';
  }
}

export function parseYaml(src: string): unknown {
  const lines: Line[] = [];
  src.split(/\r?\n/).forEach((raw, idx) => {
    if (/^\s*\t/.test(raw)) throw new YamlError('use spaces for indentation, not tabs', idx + 1);
    const text = stripComment(raw).trimEnd();
    if (!text.trim()) return;
    lines.push({ indent: text.length - text.trimStart().length, text: text.trim(), no: idx + 1 });
  });
  if (!lines.length) return null;
  const state = { lines, i: 0 };
  const value = parseBlock(state, lines[0].indent);
  if (state.i < lines.length) throw new YamlError('unexpected indentation', lines[state.i].no);
  return value;
}

function stripComment(line: string): string {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(0, i);
    }
  }
  return line;
}

type State = { lines: Line[]; i: number };

const isSeqItem = (t: string) => t === '-' || t.startsWith('- ');

function parseBlock(s: State, indent: number): unknown {
  const line = s.lines[s.i];
  return isSeqItem(line.text) ? parseSeq(s, indent) : parseMap(s, indent);
}

function parseSeq(s: State, indent: number): unknown[] {
  const out: unknown[] = [];
  while (s.i < s.lines.length) {
    const line = s.lines[s.i];
    if (line.indent !== indent || !isSeqItem(line.text)) break;
    const rest = line.text.slice(1).trim();
    if (!rest) {
      s.i++;
      out.push(s.i < s.lines.length && s.lines[s.i].indent > indent ? parseBlock(s, s.lines[s.i].indent) : null);
    } else if (splitKey(rest)) {
      // "- key: value" starts a mapping whose keys sit two columns in.
      const childIndent = indent + (line.text.length - rest.length);
      s.lines[s.i] = { indent: childIndent, text: rest, no: line.no };
      out.push(parseMap(s, childIndent));
    } else {
      out.push(parseScalar(rest, line.no));
      s.i++;
    }
  }
  return out;
}

function parseMap(s: State, indent: number): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  while (s.i < s.lines.length) {
    const line = s.lines[s.i];
    if (line.indent < indent) break;
    if (line.indent > indent) throw new YamlError('unexpected indentation', line.no);
    if (isSeqItem(line.text)) break;
    const kv = splitKey(line.text);
    if (!kv) throw new YamlError(`expected "key: value", got "${line.text}"`, line.no);
    const [key, value] = kv;
    s.i++;
    if (value !== '') {
      out[key] = parseScalar(value, line.no);
      continue;
    }
    const next = s.lines[s.i];
    if (next && (next.indent > indent || (next.indent === indent && isSeqItem(next.text)))) {
      out[key] = parseBlock(s, next.indent);
    } else {
      out[key] = null;
    }
  }
  return out;
}

/** Splits "key: value" at the first colon that is followed by a space or the end, outside quotes and brackets. */
function splitKey(text: string): [string, string] | null {
  let quote: string | null = null;
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') depth--;
    else if (c === ':' && depth === 0 && (i === text.length - 1 || text[i + 1] === ' ')) {
      if (i === 0) return null;
      return [unquote(text.slice(0, i).trim()), text.slice(i + 1).trim()];
    }
  }
  return null;
}

function unquote(t: string): string {
  if (t.length >= 2 && ((t[0] === '"' && t.at(-1) === '"') || (t[0] === "'" && t.at(-1) === "'"))) {
    const inner = t.slice(1, -1);
    return t[0] === '"' ? inner.replace(/\\(["\\nt])/g, (_, c) => ({ n: '\n', t: '\t' })[c as 'n' | 't'] ?? c) : inner.replace(/''/g, "'");
  }
  return t;
}

function parseScalar(raw: string, no: number): unknown {
  const t = raw.trim();
  if (t[0] === '[' || t[0] === '{') {
    const p = { s: t, i: 0, no };
    const v = parseFlow(p);
    skipWs(p);
    if (p.i !== t.length) throw new YamlError(`unexpected "${t.slice(p.i)}"`, no);
    return v;
  }
  if (t[0] === '"' || t[0] === "'") return unquote(t);
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (t === 'null' || t === '~') return null;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  return t;
}

type Flow = { s: string; i: number; no: number };

function skipWs(p: Flow) {
  while (p.i < p.s.length && /\s/.test(p.s[p.i])) p.i++;
}

function parseFlow(p: Flow): unknown {
  skipWs(p);
  const c = p.s[p.i];
  if (c === '[') {
    p.i++;
    const out: unknown[] = [];
    for (;;) {
      skipWs(p);
      if (p.s[p.i] === ']') {
        p.i++;
        return out;
      }
      out.push(parseFlow(p));
      skipWs(p);
      if (p.s[p.i] === ',') p.i++;
      else if (p.s[p.i] !== ']') throw new YamlError('expected "," or "]"', p.no);
    }
  }
  if (c === '{') {
    p.i++;
    const out: Record<string, unknown> = {};
    for (;;) {
      skipWs(p);
      if (p.s[p.i] === '}') {
        p.i++;
        return out;
      }
      const key = readFlowToken(p, ':');
      if (p.s[p.i] !== ':') throw new YamlError('expected ":" in { }', p.no);
      p.i++;
      out[unquote(key)] = parseFlow(p);
      skipWs(p);
      if (p.s[p.i] === ',') p.i++;
      else if (p.s[p.i] !== '}') throw new YamlError('expected "," or "}"', p.no);
    }
  }
  return parseScalar(readFlowToken(p, ''), p.no);
}

function readFlowToken(p: Flow, extraStop: string): string {
  skipWs(p);
  const start = p.i;
  const q = p.s[p.i];
  if (q === '"' || q === "'") {
    p.i++;
    while (p.i < p.s.length && p.s[p.i] !== q) p.i++;
    p.i++;
    return p.s.slice(start, p.i);
  }
  while (p.i < p.s.length && !`,]}${extraStop}`.includes(p.s[p.i])) p.i++;
  return p.s.slice(start, p.i).trim();
}
