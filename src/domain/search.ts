/** Lowercase, strip diacritics, non-alphanumerics → space, collapse, trim. */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function tokenize(s: string): string[] {
  return normalize(s)
    .split(' ')
    .filter((t) => t.length > 0);
}

export interface SearchIndex<T> {
  items: T[];
  hay: string[];
  tokens: string[][];
  rank: number[];
  nameLen: number[];
  /** Normalized display names (extra field used for ranking bonuses). */
  names: string[];
}

export function buildSearchIndex<T>(
  items: T[],
  opts: { text: (t: T) => string; name: (t: T) => string; rank: (t: T) => number },
): SearchIndex<T> {
  const hay: string[] = new Array(items.length);
  const tokens: string[][] = new Array(items.length);
  const rank: number[] = new Array(items.length);
  const nameLen: number[] = new Array(items.length);
  const names: string[] = new Array(items.length);
  for (let i = 0; i < items.length; i++) {
    const it = items[i]!;
    const h = normalize(opts.text(it));
    hay[i] = h;
    tokens[i] = h === '' ? [] : h.split(' ');
    rank[i] = opts.rank(it);
    const nm = normalize(opts.name(it));
    names[i] = nm;
    nameLen[i] = nm.length;
  }
  return { items, hay, tokens, rank, nameLen, names };
}

/**
 * Every query token must prefix-match at least one token of the item's text.
 * score = rank·100 − 50 (name starts with full query) − 20 (first query token prefixes first name token) + nameLen·0.1
 */
export function searchIndex<T>(
  index: SearchIndex<T>,
  query: string,
  opts: { limit?: number; filter?: (t: T) => boolean } = {},
): T[] {
  const q = tokenize(query);
  if (q.length === 0) return [];
  const limit = opts.limit ?? 50;
  const fullQuery = q.join(' ');
  const scored: { i: number; score: number }[] = [];
  for (let i = 0; i < index.items.length; i++) {
    const toks = index.tokens[i]!;
    let ok = true;
    for (const qt of q) {
      let found = false;
      for (let k = 0; k < toks.length; k++) {
        if (toks[k]!.startsWith(qt)) {
          found = true;
          break;
        }
      }
      if (!found) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    if (opts.filter && !opts.filter(index.items[i]!)) continue;
    const name = index.names[i]!;
    let score = index.rank[i]! * 100 + index.nameLen[i]! * 0.1;
    if (name.startsWith(fullQuery)) score -= 50;
    const firstName = name.split(' ', 1)[0] ?? '';
    if (firstName.startsWith(q[0]!)) score -= 20;
    scored.push({ i, score });
  }
  scored.sort((a, b) => a.score - b.score || a.i - b.i);
  return scored.slice(0, limit).map((s) => index.items[s.i]!);
}

export const SOURCE_RANK: Record<string, number> = {
  icbf_tcac2015: 0,
  curated: 1,
  user: 1,
  label: 1,
  recipe: 1,
  usda_foundation: 2,
  usda_sr: 3,
  usda_fndds: 4,
  off: 5,
};
