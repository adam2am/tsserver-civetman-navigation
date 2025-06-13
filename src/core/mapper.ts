// Lightweight utilities to map text-spans in the generated .ts/.tsx back to the original .civet file
// and to cache parsed TraceMaps so we avoid reparsing on every language-service call.

import fs from 'fs';
import path from 'path';
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';

// ---------------------------------------------------------------------------
// tiny LRU cache for parsed TraceMaps
// ---------------------------------------------------------------------------
class Lru<K, V> {
  private max: number;
  private map: Map<K, V>;
  constructor(max = 40) {
    this.max = max;
    this.map = new Map();
  }
  get(key: K): V | undefined {
    const val = this.map.get(key);
    if (val !== undefined) {
      // re-insert to mark as recently used
      this.map.delete(key);
      this.map.set(key, val);
    }
    return val;
  }
  set(key: K, val: V) {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, val);
    if (this.map.size > this.max) {
      // delete oldest
      const [first] = this.map.keys();
      this.map.delete(first);
    }
  }
}

const traceMapCache = new Lru<string, TraceMap | null>(40);

// ---------------------------------------------------------------------------
// helpers to load & cache source-maps
// ---------------------------------------------------------------------------
export function getTraceMap(tsFile: string, log: (m: string) => void): TraceMap | null {
  const cached = traceMapCache.get(tsFile);
  if (cached !== undefined) return cached;

  const code = fs.existsSync(tsFile) ? fs.readFileSync(tsFile, 'utf8') : '';
  const m = /sourceMappingURL=([^\s]+)/.exec(code);

  const tryRead = (p: string) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null);

  let raw: string | null = null;
  if (m) {
    const url = m[1].trim();
    if (url.startsWith('data:')) {
      const idx = url.indexOf(',');
      if (idx >= 0) {
        try {
          raw = Buffer.from(url.slice(idx + 1), 'base64').toString('utf8');
        } catch {}
      }
    } else {
      raw = tryRead(path.resolve(path.dirname(tsFile), url));
    }
  }
  if (!raw) raw = tryRead(tsFile + '.map');

  if (!raw) {
    log(`[SMAP] miss for ${path.basename(tsFile)}`);
    traceMapCache.set(tsFile, null);
    return null;
  }

  try {
    const tm = new TraceMap(JSON.parse(raw));
    traceMapCache.set(tsFile, tm);
    return tm;
  } catch (e) {
    log(`sourcemap parse error ${e}`);
    traceMapCache.set(tsFile, null);
    return null;
  }
}

// ---------------------------------------------------------------------------
// generic span mapping helpers
// ---------------------------------------------------------------------------
function lineStarts(text: string) {
  const arr: number[] = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) arr.push(i + 1);
  return arr;
}
function offsetToLc(text: string, off: number) {
  const ls = lineStarts(text);
  let l = 0;
  while (l + 1 < ls.length && ls[l + 1] <= off) l++;
  return { line: l + 1, column: off - ls[l] };
}
function lcToOffset(text: string, line: number, col: number) {
  const ls = lineStarts(text);
  return (line - 1 < ls.length ? ls[line - 1] : 0) + col;
}

// ---------------------------------------------------------------------------
// walk & patch any object/array containing `{ fileName, textSpan }`
// ---------------------------------------------------------------------------
export function walkAndPatchSpans(
  value: any,
  log: (msg: string) => void,
  fileExists: (p: string) => boolean
): any {
  if (!value) return value;
  const seenPatch = new WeakSet<any>();

  // First pass: recursively find and patch all TS locations to Civet locations
  const patchVisit = (v: any) => {
    if (!v || typeof v !== 'object' || seenPatch.has(v)) return;
    seenPatch.add(v);

    if (Array.isArray(v)) {
      v.forEach(patchVisit);
      return;
    }

    // Patch the object itself if it's a definition-like object
    if (typeof v.fileName === 'string' && v.textSpan?.start != null) {
      const origFile = v.fileName;
      if (/\.tsx?$/.test(origFile) && !origFile.endsWith('.d.ts')) {
        const civetPath = origFile.replace(/\.tsx?$/, '.civet');
        if (fileExists(civetPath)) {
          const tm = getTraceMap(origFile, log);
          if (tm) {
            const genText = fs.readFileSync(origFile, 'utf8');
            const civText = fs.readFileSync(civetPath, 'utf8');
            const { line, column } = offsetToLc(genText, v.textSpan.start);
            const orig = originalPositionFor(tm, { line, column });

            if (orig.line != null && orig.column != null) {
              const start = lcToOffset(civText, orig.line, orig.column);
              v.fileName = civetPath;
              v.textSpan.start = start;
              if (v.contextSpan) v.contextSpan.start = start;
              if (v.originalTextSpan) v.originalTextSpan.start = start;
              log(`[MAP] ${path.basename(origFile)} ${line}:${column} -> ${orig.line}:${orig.column}`);
            }
          }
        }
      }
    }
    // After patching the object, recurse into its properties
    for (const key in v) {
      patchVisit(v[key]);
    }
  };

  // Second pass: recursively find any array that now contains a .civet definition
  // and remove any .ts definitions from that same array.
  const filterSeen = new WeakSet<any>();
  const filterVisit = (v: any) => {
    if (!v || typeof v !== 'object' || filterSeen.has(v)) return;
    filterSeen.add(v);

    if (Array.isArray(v)) {
      const hasCivet = v.some((item) => item?.fileName?.endsWith('.civet'));
      if (hasCivet) {
        let i = v.length;
        while (i--) {
          const item = v[i];
          if (item?.fileName && /\.tsx?$/.test(item.fileName) && !item.fileName.endsWith('.d.ts')) {
            v.splice(i, 1);
          }
        }
      }
    }
    // After filtering the array, recurse into all properties
    for (const key in v) {
      filterVisit(v[key]);
    }
  };

  patchVisit(value);
  filterVisit(value);
  
  return value;
} 