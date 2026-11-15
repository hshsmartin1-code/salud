import { describe, expect, it } from 'vitest';
import { SOURCE_RANK, buildSearchIndex, normalize, searchIndex, tokenize } from './search';

interface Item {
  id: string;
  name: string;
  extra?: string;
  source: string;
}

const mk = (items: Item[]) =>
  buildSearchIndex(items, {
    text: (t) => `${t.name} ${t.extra ?? ''}`,
    name: (t) => t.name,
    rank: (t) => SOURCE_RANK[t.source] ?? 9,
  });

describe('normalize / tokenize', () => {
  it('strips accents and punctuation', () => {
    expect(normalize('Plátano  MADURO, frito')).toBe('platano maduro frito');
    expect(normalize('Piña ñame')).toBe('pina name');
    expect(normalize('  ')).toBe('');
    expect(tokenize(' Arroz-con  pollo! ')).toEqual(['arroz', 'con', 'pollo']);
    expect(tokenize('')).toEqual([]);
  });
});

describe('searchIndex', () => {
  const items: Item[] = [
    { id: '1', name: 'Plátano maduro', source: 'icbf_tcac2015' },
    { id: '2', name: 'Bananas, raw', extra: 'platano banano', source: 'usda_sr' },
    { id: '3', name: 'Arroz blanco cocido', source: 'icbf_tcac2015' },
    { id: '4', name: 'Arroz con pollo', source: 'user' },
    { id: '5', name: 'Pollo asado', source: 'off' },
    { id: '6', name: 'Papa criolla', source: 'curated' },
  ];
  const idx = mk(items);

  it('is accent-insensitive and prefix-based', () => {
    expect(searchIndex(idx, 'platano').map((i) => i.id)).toEqual(['1', '2']);
    expect(searchIndex(idx, 'PLÁT').map((i) => i.id)).toEqual(['1', '2']);
    expect(searchIndex(idx, 'latano')).toEqual([]);
  });
  it('every query token must match', () => {
    expect(searchIndex(idx, 'arroz pollo').map((i) => i.id)).toEqual(['4']);
    expect(searchIndex(idx, 'arroz zzz')).toEqual([]);
  });
  it('empty query → []', () => {
    expect(searchIndex(idx, '')).toEqual([]);
    expect(searchIndex(idx, '  ,, ')).toEqual([]);
  });
  it('lower-rank source ranks first', () => {
    const same = mk([
      { id: 'off', name: 'Leche entera', source: 'off' },
      { id: 'usda', name: 'Leche entera', source: 'usda_sr' },
      { id: 'icbf', name: 'Leche entera', source: 'icbf_tcac2015' },
    ]);
    expect(searchIndex(same, 'leche').map((i) => i.id)).toEqual(['icbf', 'usda', 'off']);
  });
  it('name-prefix bonus beats synonym-only match within the same source', () => {
    const r = mk([
      { id: 'syn', name: 'Fruta tropical', extra: 'mango', source: 'curated' },
      { id: 'name', name: 'Mango maduro', source: 'curated' },
    ]);
    expect(searchIndex(r, 'mango').map((i) => i.id)).toEqual(['name', 'syn']);
  });
  it('shorter names win ties', () => {
    const r = mk([
      { id: 'long', name: 'Pan integral con semillas', source: 'curated' },
      { id: 'short', name: 'Pan integral', source: 'curated' },
    ]);
    expect(searchIndex(r, 'pan').map((i) => i.id)).toEqual(['short', 'long']);
  });
  it('limit and filter', () => {
    expect(searchIndex(idx, 'a', { limit: 2 })).toHaveLength(2);
    expect(searchIndex(idx, 'arroz', { filter: (t) => t.source === 'user' }).map((i) => i.id)).toEqual(['4']);
  });
});

describe('SOURCE_RANK', () => {
  it('ordering', () => {
    expect(SOURCE_RANK.icbf_tcac2015).toBe(0);
    expect(SOURCE_RANK.off).toBe(5);
    expect(SOURCE_RANK.usda_foundation!).toBeLessThan(SOURCE_RANK.usda_sr!);
  });
});

describe('performance', () => {
  it('2-token query over 25 000 items is fast', () => {
    const words = ['arroz', 'pollo', 'papa', 'queso', 'leche', 'carne', 'frijol', 'yuca', 'platano', 'huevo', 'atun', 'pan'];
    const sources = Object.keys(SOURCE_RANK);
    const big: Item[] = Array.from({ length: 25_000 }, (_, i) => ({
      id: String(i),
      name: `${words[i % words.length]} ${words[(i * 7 + 3) % words.length]} tipo ${i}`,
      extra: `sinonimo${i % 100} marca${i % 50}`,
      source: sources[i % sources.length]!,
    }));
    const index = mk(big);
    searchIndex(index, 'arroz que'); // warm-up
    const t0 = performance.now();
    const r = searchIndex(index, 'arroz que');
    const dt = performance.now() - t0;
    expect(r.length).toBeGreaterThan(0);
    expect(r.length).toBeLessThanOrEqual(50);
    expect(dt).toBeLessThan(80);
  });
});
