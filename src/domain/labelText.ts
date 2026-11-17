import { NUTRIENTS } from '../db/catalogTypes';
import type { NutrientCode, NutrientMap } from '../db/catalogTypes';
import { formatNumber, parseDecimal } from './units';

/**
 * Nutrition-label text parser (pasted text or Tesseract OCR output).
 *
 * The input is untrusted and noisy, and the result is ALWAYS reviewed by the user in a form
 * before saving: whenever an assumption is needed the value is flagged `uncertain` with a
 * Spanish note instead of being silently guessed. A nutrient that is not printed is absent
 * (never 0), percentages (%VD / %IDR) are never read as amounts, kJ and kcal are never
 * converted into each other, and columns (per 100 g / per serving / per package) are never mixed.
 */

export type LabelColumnBasis = '100g' | '100ml' | 'serving' | 'package';

export interface ParsedNutrient {
  /** Our code; `value` is already in that nutrient's unit (see NUTRIENTS). */
  code: NutrientCode;
  value: number;
  /** Column the value came from. */
  basis: LabelColumnBasis;
  /** Original line, trimmed (label + value lines joined when the label was split). */
  sourceText: string;
  /** Unit as printed ('g', 'mg', 'µg', 'mcg', 'kcal', 'cal', 'kJ'), null when none was printed. */
  sourceUnit: string | null;
  /** A unit conversion was applied (sodium 0,15 g → 150 mg; trans fat 150 mg → 0,15 g; salt → sodium). */
  converted: boolean;
  /** Some assumption was needed: the user must check this value. */
  uncertain: boolean;
  /** Spanish explanation of the assumptions / conversion. */
  note?: string;
  /** "<1 g" / "menos de 1 g" → 'lessThan' (the number is stored); "trazas" / "tr" → 'traces' (stored as 0). */
  qualifier?: 'lessThan' | 'traces';
}

export interface ParsedLabel {
  /** Detected columns in printed order, e.g. ['100g', 'serving']. */
  columns: LabelColumnBasis[];
  /** No column header was found and the basis was assumed (a warning explains which). */
  basisInferred: boolean;
  servingSize: number | null;
  servingUnit: 'g' | 'ml' | null;
  servingLabel: string | null;
  servingsPerPackage: number | null;
  servingsPerPackageApprox: boolean;
  packageSize: number | null;
  packageUnit: 'g' | 'ml' | null;
  /** Every recognised value, for every column. */
  nutrients: ParsedNutrient[];
  /** Convenience view; when a nutrient repeats in a column the first value wins (with a warning). */
  byBasis: Partial<Record<LabelColumnBasis, NutrientMap>>;
  /** Spanish, user-facing. */
  warnings: string[];
  /** Lines with numbers that were not understood (or could not be imported safely). */
  unrecognizedLines: string[];
}

// ───────────────────────────── Units ─────────────────────────────

const MAX_TEXT = 20_000;
const MAX_LINE = 400;
const SODIUM_MG_PER_G_SALT = 400;

type MassUnit = 'g' | 'mg' | 'µg';
type EnergyUnit = 'kcal' | 'kJ';
type Unit = MassUnit | EnergyUnit;

interface UnitTok {
  unit: Unit | 'bad';
  printed: string;
}

const MASS_UG: Record<MassUnit, number> = { g: 1e6, mg: 1e3, 'µg': 1 };

function isMass(u: Unit): u is MassUnit {
  return u === 'g' || u === 'mg' || u === 'µg';
}

const U_G: UnitTok = { unit: 'g', printed: 'g' };
const U_MG: UnitTok = { unit: 'mg', printed: 'mg' };
const U_UG: UnitTok = { unit: 'µg', printed: 'µg' };
const U_MCG: UnitTok = { unit: 'µg', printed: 'mcg' };
const U_KCAL: UnitTok = { unit: 'kcal', printed: 'kcal' };
const U_CAL: UnitTok = { unit: 'kcal', printed: 'cal' };
const U_KJ: UnitTok = { unit: 'kJ', printed: 'kJ' };

/** Folded word → unit. A Map (not an object) so words like "constructor" never hit the prototype. */
const UNIT_WORDS = new Map<string, UnitTok>([
  ['g', U_G],
  ['gr', U_G],
  ['grs', U_G],
  ['gramo', U_G],
  ['gramos', U_G],
  ['mg', U_MG],
  ['miligramo', U_MG],
  ['miligramos', U_MG],
  ['µg', U_UG],
  ['ug', U_UG],
  ['mcg', U_MCG],
  ['microgramo', U_UG],
  ['microgramos', U_UG],
  ['kcal', U_KCAL],
  ['kcals', U_KCAL],
  ['kilocalorias', U_KCAL],
  ['calorias', U_KCAL],
  ['cal', U_CAL],
  ['cals', U_CAL],
  ['kj', U_KJ],
  ['kilojulios', U_KJ],
  ['kilojoules', U_KJ],
  // printed but not usable for an amount: never assume
  ...['ui', 'iu', 'u', 'ufc', 'ml', 'mmol', 'meq', 'ue'].map(
    (w): [string, UnitTok] => [w, { unit: 'bad', printed: w }],
  ),
]);

const LT_WORDS = new Set(['menos', 'max', 'maximo', 'hasta', 'inferior']);
const TRACE_WORDS = new Set(['trazas', 'traza', 'tr', 'trz', 'trace', 'traces']);
/** Words that may appear in a value cell without changing its meaning. */
const FILLER = new Set([
  'de', 'del', 'la', 'el', 'los', 'las', 'en', 'a', 'o', 'y', 'x', 'l', 'i', 'n', 'd', 'nd', 'na', 'no',
  'vd', 'idr', 'vdr', 'cdr', 'ir', 'vrn', 'ri', 'rd', 'er', 're', 'rae', 'ear', 'eq', 'et', 'te', 'ate',
  'eat', 'dfe', 'efd', 'alfa', 'aprox', 'aproximadamente', 'valor', 'valores', 'diario', 'diarios',
  'total', 'totales', 'equivalentes', 'retinol', 'tocoferol', 'contiene', 'aporta', 'cantidad',
]);

const UNIT_BY_CODE = new Map<NutrientCode, Unit>(
  NUTRIENTS.map((n) => [
    n.code,
    n.unit === 'kcal' || n.unit === 'kJ' || n.unit === 'g' || n.unit === 'mg' ? n.unit : 'µg',
  ]),
);
const ES_BY_CODE = new Map<NutrientCode, string>(NUTRIENTS.map((n) => [n.code, n.es]));

const BASIS_ES: Record<LabelColumnBasis, string> = {
  '100g': 'por 100 g',
  '100ml': 'por 100 ml',
  serving: 'por porción',
  package: 'por envase',
};

const fmt = (n: number): string => formatNumber(n, 3);
/** Removes float noise from conversions (0.15 * 1000 etc.). */
const tidy = (n: number): number => Number(n.toPrecision(12));

// ─────────────────────────── Nutrient labels ───────────────────────────

type DefKey = NutrientCode | 'energy' | 'salt';

interface LabelDef {
  key: DefKey;
  /** Anchored, applied to folded text (lowercase, no accents). */
  re: RegExp;
  /** Unit implied by the label itself ("Calorías" → kcal). */
  implied?: EnergyUnit;
  /** "Carbohidratos" / "Hidratos de carbono" without total/disponibles. */
  plainCarbs?: boolean;
  /** Micronutrients: never assume a unit. */
  needsUnit?: boolean;
}

const FATTY = '(?:(?:grasas?|acidos?\\s*grasos?|lipidos?)\\s*)?';
const CARB = '(?:carbohidratos?|carbohidr\\.?|hidratos\\s*de\\s*carbono|glucidos?)';
const VIT = 'vit(?:amina|\\.)?\\s*';

// Order matters: specific labels before the generic ones they start with.
const DEFS: LabelDef[] = [
  { key: 'energy', re: /^(?:valor\s*energetico|contenido\s*energetico|valor\s*calorico|energia(?:\s*total)?)(?![a-z])/ },
  { key: 'energy', re: /^energy(?![a-z])/ },
  { key: 'energy', re: /^(?:calorias(?:\s*totales)?|kilocalorias|kcal|cal)(?![a-z])/, implied: 'kcal' },
  { key: 'energy', re: /^(?:kj|kilojulios)(?![a-z])/, implied: 'kJ' },
  { key: 'transFat', re: new RegExp(`^${FATTY}trans(?:\\s*totale?s?)?(?![a-z])`) },
  { key: 'satFat', re: new RegExp(`^${FATTY}saturad[oa]s?(?:\\s*totale?s?)?(?![a-z])`) },
  { key: 'monoFat', re: new RegExp(`^${FATTY}mono\\s*-?\\s*insaturad[oa]s?(?:\\s*totale?s?)?(?![a-z])`) },
  { key: 'polyFat', re: new RegExp(`^${FATTY}poli\\s*-?\\s*insaturad[oa]s?(?:\\s*totale?s?)?(?![a-z])`) },
  { key: 'fat', re: /^(?:grasas?(?:\s*totale?s?)?|total\s*de\s*grasas?|lipidos?(?:\s*totale?s?)?|materia\s*grasa)(?![a-z])/ },
  { key: 'fat', re: /^(?:total\s*fat|fat)(?![a-z])/ },
  { key: 'carbsAvail', re: new RegExp(`^${CARB}\\s*(?:disponibles?|asimilables?)(?![a-z])`) },
  { key: 'carbs', re: new RegExp(`^(?:${CARB}\\s*totale?s?|total\\s*de\\s*${CARB})(?![a-z])`) },
  { key: 'carbs', re: new RegExp(`^${CARB}(?![a-z])`), plainCarbs: true },
  { key: 'carbs', re: /^(?:total\s*carbohydrates?|carbohydrates?)(?![a-z])/ },
  { key: 'fiber', re: /^fibras?(?:\s*(?:dietari[ao]s?|dieteticas?|alimentari[ao]s?|totale?s?))*(?![a-z])/ },
  { key: 'addedSugars', re: /^azucar(?:es)?\s*(?:anadidos?|adicionados?|agregados?)(?![a-z])/ },
  { key: 'sugars', re: /^(?:azucar(?:es)?(?:\s*totale?s?)?|total\s*de\s*azucares)(?![a-z])/ },
  { key: 'protein', re: /^proteinas?(?:\s*totale?s?)?(?![a-z])/ },
  { key: 'protein', re: /^protein(?![a-z])/ },
  { key: 'sodium', re: /^sodio(?![a-z])/ },
  { key: 'sodium', re: /^sodium(?![a-z])/ },
  { key: 'salt', re: /^sal(?![a-z])/ },
  { key: 'cholesterol', re: /^colesterol(?:\s*total)?(?![a-z])/ },
  { key: 'potassium', re: /^potasio(?![a-z])/, needsUnit: true },
  { key: 'calcium', re: /^calcio(?![a-z])/, needsUnit: true },
  { key: 'iron', re: /^hierro(?![a-z])/, needsUnit: true },
  { key: 'magnesium', re: /^magnesio(?![a-z])/, needsUnit: true },
  { key: 'phosphorus', re: /^fosforo(?![a-z])/, needsUnit: true },
  { key: 'zinc', re: /^(?:zinc|cinc)(?![a-z])/, needsUnit: true },
  { key: 'vitA', re: new RegExp(`^${VIT}a(?![a-z0-9])`), needsUnit: true },
  { key: 'vitC', re: new RegExp(`^(?:${VIT}c|acido\\s*ascorbico)(?![a-z0-9])`), needsUnit: true },
  { key: 'vitD', re: new RegExp(`^${VIT}d(?:3(?![\\d.,]))?(?![a-z0-9])`), needsUnit: true },
  { key: 'vitE', re: new RegExp(`^${VIT}e(?![a-z0-9])`), needsUnit: true },
  { key: 'vitB12', re: new RegExp(`^(?:${VIT}b\\s*-?\\s*12|cobalamina|cianocobalamina)(?![a-z0-9])`), needsUnit: true },
  { key: 'folate', re: new RegExp(`^(?:folatos?|acido\\s*folico|folacina|${VIT}b\\s*-?\\s*9)(?![a-z0-9])`), needsUnit: true },
  { key: 'water', re: /^(?:agua|humedad)(?![a-z])/ },
];
const ADDED_SUGARS_DEF = DEFS.find((d) => d.key === 'addedSugars')!;

/** Leading OCR junk / table leaders. */
const LEAD_RE = /^[\s|¦:;.,\-–—_*•·>~=+"'`´]+/;
/** EU / sub-row prefixes ("de las cuales", "incluye"…). */
const SUBROW_RE =
  /^(?:de\s*(?:los|las)\s*cuales|del\s*cual|de\s*la\s*cual|de\s*ell[oa]s|de\s*est[oa]s|de\s*los\s*que|de\s*las\s*que|incluye|incluyendo|contiene|entre\s*ell[oa]s)(?![a-z])\s*[:,-]?\s*/;
const INCLUDED_ADDED_RE = /^(.*?)(?:\s*de)?\s*azucar(?:es)?\s*(?:anadidos?|adicionados?|agregados?)(?![a-z])(.*)$/;
/** Footnotes and non-nutrition lines that often carry numbers. */
const IGNORE_LINE_RE =
  /dieta\s*(?:de|diaria)|basad[oa]s?\s*en|le\s*indica\s*cuanto|ingestas?\s*de\s*referencia\s*(?:de|para)\s*un\s*adulto|necesidades\s*energeticas|asesoria\s*general|^(?:ingredientes|registro|rsa|lote|fecha|vence|vencimiento|elaborado|fabricado|importado|distribuido|conservese|consumase|www|https?)(?![a-z])/;
const IGNORE_ROW_RE = /^calorias\s*(?:de|provenientes\s*de|de\s*la)\s*(?:la\s*)?grasas?(?![a-z])/;

// ─────────────────────────── Text helpers ───────────────────────────

const SPACE_CHARS = new Set(['\u00a0', '\u2007', '\u2009', '\u202f', '\u2002', '\u2003']);

/** Lowercase + strip accents, ONE char per char (indices stay aligned with the original). */
function fold(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (c === 'µ' || c === '\u03bc' || c === '\u039c') out += 'µ';
    else if (SPACE_CHARS.has(c)) out += ' ';
    else out += c.normalize('NFD').charAt(0).toLowerCase().charAt(0);
  }
  return out;
}

/**
 * OCR look-alikes inside numbers: "1O" → "10", "O,5" → "0,5"; with `letters`, also "l5"/"I5" → "15".
 * Length-preserving; `changed[i]` tells which characters were replaced.
 */
function fixOcrDigits(s: string, letters: boolean): { text: string; changed: boolean[] } {
  const changed = new Array<boolean>(s.length).fill(false);
  const mark =
    (to: string) =>
    (m: string, off: number): string => {
      for (let i = 0; i < m.length; i++) changed[off + i] = true;
      return to.repeat(m.length);
    };
  let text = s.replace(/(?<=\d)o+|(?<![a-z])o+(?=[.,]?\d)/g, mark('0'));
  if (letters) text = text.replace(/(?<=\d)[il](?![a-z])|(?<![a-z])[il](?=[.,]?\d)/g, mark('1'));
  return { text, changed };
}

// ─────────────────────────── Value cells ───────────────────────────

interface Amount {
  /** Digits as printed (after OCR fixes), e.g. "2,5", "1.250", "1 250". */
  raw: string;
  unit: UnitTok | null;
  lessThan: boolean;
  trace: boolean;
  ocr: boolean;
  /** Directly preceded (single space at most) by another number: candidate for the "15 9" fix. */
  adjNum: boolean;
  nine?: boolean;
}

interface ValueInfo {
  amounts: Amount[];
  /** Units printed before the first number ("Grasa total (g) 3", "Energía (kJ/kcal) …"). */
  headerUnits: UnitTok[];
  /** An unknown word before the first number: the label match was wrong. */
  unknownBefore: boolean;
  /** An unknown word after the numbers. */
  noise: boolean;
  /** Percentages skipped (%VD / %IDR). */
  pct: number;
  /** Words other than units (filler included). */
  words: number;
}

type Tok =
  | { k: 'num'; raw: string; s: number; e: number }
  | { k: 'unit'; u: UnitTok }
  | { k: 'word'; known: boolean }
  | { k: 'pct' | 'lt' | 'trace' | 'sep' | 'gap' };

/** "1 250 kJ": space thousands only when a unit with big magnitudes follows directly. */
const SPACE_THOUSANDS_RE = /\d{1,3}(?: \d{3})+(?![\d.,])(?=\s*(?:mg|µg|ug|mcg|kj|kcal|cal)(?![a-z]))/y;
const NUM_RE = /\d+(?:[.,]\d+)*/y;
const WORD_RE = /[a-zµ]+/y;

function scan(t: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < t.length) {
    const c = t[i]!;
    if (c === ' ') {
      let j = i;
      while (t[j] === ' ') j++;
      if (j - i >= 2) toks.push({ k: 'gap' });
      i = j;
    } else if (c === '\t') {
      toks.push({ k: 'gap' });
      i++;
    } else if (c >= '0' && c <= '9') {
      SPACE_THOUSANDS_RE.lastIndex = i;
      let m = SPACE_THOUSANDS_RE.exec(t);
      if (!m) {
        NUM_RE.lastIndex = i;
        m = NUM_RE.exec(t);
      }
      const raw = m ? m[0] : c;
      toks.push({ k: 'num', raw, s: i, e: i + raw.length });
      i += raw.length;
    } else if (c === '%') {
      toks.push({ k: 'pct' });
      i++;
    } else if (c === '<' || c === '\u2264' || c === '\uff1c') {
      toks.push({ k: 'lt' });
      i++;
      if (t[i] === '=') i++;
    } else if (/[a-zµ]/.test(c)) {
      WORD_RE.lastIndex = i;
      const w = WORD_RE.exec(t)?.[0] ?? c;
      i += w.length;
      if (t[i] === '.') i++; // abbreviation: "aprox.", "tr.", "mg."
      const u = UNIT_WORDS.get(w);
      if (u) toks.push({ k: 'unit', u });
      else if (LT_WORDS.has(w)) toks.push({ k: 'lt' });
      else if (TRACE_WORDS.has(w)) toks.push({ k: 'trace' });
      else toks.push({ k: 'word', known: FILLER.has(w) });
    } else {
      toks.push({ k: 'sep' });
      i++;
    }
  }
  return toks;
}

function analyzeValue(v: string): ValueInfo {
  const fx = fixOcrDigits(v, true);
  const toks = scan(fx.text);
  const info: ValueInfo = { amounts: [], headerUnits: [], unknownBefore: false, noise: false, pct: 0, words: 0 };
  let pendingLt = false;
  let seen = false;
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k]!;
    const prev = toks[k - 1];
    switch (t.k) {
      case 'num': {
        const nx = toks[k + 1];
        const pctNext = nx?.k === 'pct' ? 1 : nx?.k === 'gap' && toks[k + 2]?.k === 'pct' ? 2 : 0;
        seen = true;
        if (pctNext > 0) {
          info.pct++;
          k += pctNext;
          pendingLt = false;
          break;
        }
        info.amounts.push({
          raw: t.raw,
          unit: null,
          lessThan: pendingLt,
          trace: false,
          ocr: fx.changed.slice(t.s, t.e).some(Boolean),
          adjNum: prev?.k === 'num',
        });
        pendingLt = false;
        break;
      }
      case 'trace':
        seen = true;
        info.amounts.push({ raw: '0', unit: null, lessThan: false, trace: true, ocr: false, adjNum: false });
        pendingLt = false;
        break;
      case 'unit': {
        const last = info.amounts[info.amounts.length - 1];
        const attach =
          prev?.k === 'num' || prev?.k === 'trace' || (prev?.k === 'gap' && toks[k - 2]?.k === 'num');
        if (last && last.unit === null && attach) last.unit = t.u;
        else if (!seen) info.headerUnits.push(t.u);
        break;
      }
      case 'lt':
        pendingLt = true;
        break;
      case 'word':
        info.words++;
        if (!t.known) {
          if (seen) info.noise = true;
          else info.unknownBefore = true;
        }
        break;
      default:
        break;
    }
  }
  return info;
}

/**
 * Reads a printed number. A single separator followed by exactly 3 digits is a thousands
 * separator for mg/µg/kJ/kcal; with g it is ambiguous and the decimal reading (≤ 100 g) wins.
 */
function readNumber(
  raw: string,
  unit: Unit,
): { value: number; ambiguousG: number | null; thousandsSep: ',' | '.' | null } | null {
  // Printed labels have an explicit space-thousands token (unlike manual fields).
  if (unit !== 'g' && /^\d{1,3}( \d{3})+$/.test(raw)) {
    return { value: Number(raw.replace(/ /g, '')), ambiguousG: null, thousandsSep: null };
  }
  const m = /^(\d{1,3})([.,])(\d{3})$/.exec(raw);
  if (m && Number(m[1]) !== 0) {
    const thousands = Number(m[1]) * 1000 + Number(m[3]);
    if (unit !== 'g') return { value: thousands, ambiguousG: null, thousandsSep: m[2] === ',' ? ',' : '.' };
    return { value: Number(`${m[1]}.${m[3]}`), ambiguousG: thousands, thousandsSep: null };
  }
  const v = parseDecimal(raw);
  return v === null ? null : { value: v, ambiguousG: null, thousandsSep: null };
}

// ─────────────────────────── Line segments ───────────────────────────

type SegResult =
  | { kind: 'row' | 'labelOnly'; def: LabelDef; info: ValueInfo; inline: LabelColumnBasis | null }
  | { kind: 'values'; info: ValueInfo }
  | { kind: 'ignored' | 'none' | 'unknown' };

const INLINE_BASIS_RE =
  /(?<![a-z])(?:por|x|cada|\/)\s*(?:(100)\s*(g|gr|gramos|ml|mililitros)|(envase|paquete|empaque)|porcion|racion|servicio|unidad)(?![a-z0-9])(?:\s*(?:de\s*)?\(?\s*\d+(?:[.,]\d+)?\s*(?:g|gr|ml)(?![a-z])\s*\)?)?/;
const EU_SUB_RE = /,?\s*(?:de\s*(?:los|las)\s*cuales|del\s*cual|de\s*la\s*cual)(?![a-z])/g;

/** Splits "Vitamina D 2 µg • Calcio 260 mg" and "Grasas 10 g, de las cuales saturadas 3 g". */
function splitSegments(f: string): string[] {
  const out: string[] = [];
  for (const part of f.split(/[•●▪;]/)) {
    let start = 0;
    EU_SUB_RE.lastIndex = 0;
    for (let m = EU_SUB_RE.exec(part); m; m = EU_SUB_RE.exec(part)) {
      if (m.index > start && /\d/.test(part.slice(start, m.index))) {
        out.push(part.slice(start, m.index));
        start = m.index;
      }
    }
    out.push(part.slice(start));
  }
  return out.map((s) => s.trim()).filter((s) => s !== '');
}

function parseSegment(seg: string): SegResult {
  let s = seg.replace(LEAD_RE, '');
  const sub = SUBROW_RE.exec(s);
  const inclusive = sub !== null && /^(?:incluye|incluyendo|contiene)/.test(sub[0]);
  if (sub) s = s.slice(sub[0].length).replace(LEAD_RE, '');
  if (IGNORE_ROW_RE.test(s)) return { kind: 'ignored' };
  for (const def of DEFS) {
    const m = def.re.exec(s);
    if (!m) continue;
    let rest = s.slice(m[0].length);
    // "Calorías por porción 120": the row declares its own basis
    const ib = INLINE_BASIS_RE.exec(rest);
    const inline: LabelColumnBasis | null = ib
      ? ib[1]
        ? /^m/.test(ib[2]!) ? '100ml' : '100g'
        : ib[3]
          ? 'package'
          : 'serving'
      : null;
    if (ib) rest = `${rest.slice(0, ib.index)}  ${rest.slice(ib.index + ib[0].length)}`;
    const info = analyzeValue(rest);
    if (info.unknownBefore) continue; // e.g. "grasa insaturada": not "grasa"
    if (info.amounts.length > 0 || info.pct > 0) return { kind: 'row', def, info, inline };
    if (info.words === 0) return { kind: 'labelOnly', def, info, inline };
    return { kind: 'none' }; // "No contiene", "N.D.": declared without a value
  }
  if (inclusive) {
    // "Incluye 10 g de azúcares añadidos"
    const m = INCLUDED_ADDED_RE.exec(s);
    if (m) {
      const info = analyzeValue(`${m[1]} ${m[2]}`);
      if (!info.unknownBefore && info.amounts.length > 0) {
        return { kind: 'row', def: ADDED_SUGARS_DEF, info, inline: null };
      }
    }
  }
  if (!/\d/.test(s)) return { kind: 'none' };
  const info = analyzeValue(s);
  if (info.unknownBefore || info.noise) return { kind: 'unknown' };
  if (info.amounts.length > 0) return { kind: 'values', info };
  return { kind: 'none' }; // only percentages
}

// ─────────────────────────── Headers & metadata ───────────────────────────

interface ColumnSpec {
  basis: LabelColumnBasis;
  /** "Por 100 g o 100 ml": resolved at the end from the serving/package unit. */
  gml?: boolean;
}

interface Size {
  size: number;
  unit: 'g' | 'ml';
  ocr: boolean;
  ambiguous: boolean;
}

interface HeaderInfo {
  cols: ColumnSpec[];
  serving: Size | null;
  pkg: Size | null;
  perUnit: boolean;
}

const DESC_RE =
  /(?<![a-z0-9])(?:(?:por|per|x|cada|en)\s*|\/\s*)?(?:(100)\s*(g|gr|grs|gramos|ml|mililitros|cc)(?:\s*(?:o|\/|u|y)\s*(?:100\s*)?(g|gr|gramos|ml|mililitros))?(?![a-z0-9])|(porcion|racion|servicio|serving)(?![a-z])|(envase|paquete|empaque|bolsa|caja|botella|lata|recipiente|contenedor|package)(?![a-z])|(unidad)(?![a-z]))/g;
const HEADER_WORDS = new Set([
  'informacion', 'nutricional', 'nutrimental', 'nutricion', 'datos', 'de', 'del', 'la', 'el', 'los', 'las',
  'valores', 'valor', 'medios', 'medio', 'promedio', 'promedios', 'cantidad', 'cantidades', 'contenido',
  'aporte', 'nutriente', 'nutrientes', 'componente', 'componentes', 'tabla', 'por', 'en', 'cada', 'vd',
  'idr', 'vdr', 'ir', 'vrn', 'diario', 'nutrition', 'facts', 'y', 'o', '%',
]);
const HAS100_RE = /(?<![\d.,])100\s*(?:g|gr|gramos|ml|mililitros|cc)(?![a-z0-9])/;
const SIZE_RE =
  /(\d+(?:[.,]\d+)*)\s*(kg|kilos?|gramos?|grs?|g|mililitros?|ml|cc|cm3|litros?|lt|l)(?![a-z0-9])/g;

function readSizes(f: string, preferThousands: boolean): (Size & { index: number; inParens: boolean })[] {
  const fx = fixOcrDigits(f, false);
  const out: (Size & { index: number; inParens: boolean })[] = [];
  SIZE_RE.lastIndex = 0;
  for (let m = SIZE_RE.exec(fx.text); m; m = SIZE_RE.exec(fx.text)) {
    const raw = m[1]!;
    const unitWord = m[2]!;
    const grp = /^(\d{1,3})[.,](\d{3})$/.exec(raw);
    let value: number | null;
    let ambiguous = false;
    if (grp && Number(grp[1]) !== 0) {
      ambiguous = true;
      value = preferThousands ? Number(grp[1]) * 1000 + Number(grp[2]) : Number(`${grp[1]}.${grp[2]}`);
    } else {
      value = parseDecimal(raw);
    }
    if (value === null || value <= 0) continue;
    const ml = /^(?:mililitros?|ml|cc|cm3|litros?|lt|l)$/.test(unitWord);
    const big = /^(?:kg|kilos?|litros?|lt|l)$/.test(unitWord);
    const before = fx.text.slice(0, m.index);
    out.push({
      size: tidy(big ? value * 1000 : value),
      unit: ml ? 'ml' : 'g',
      ocr: fx.changed.slice(m.index, m.index + m[0].length).some(Boolean),
      ambiguous,
      index: m.index,
      inParens: before.lastIndexOf('(') > before.lastIndexOf(')'),
    });
  }
  return out;
}

function parseHeader(f0: string): HeaderInfo | null {
  const f = fixOcrDigits(f0, false).text;
  const found: {
    basis: LabelColumnBasis;
    start: number;
    end: number;
    kind: 'base' | 'other';
    gml: boolean;
    unit: boolean;
  }[] = [];
  DESC_RE.lastIndex = 0;
  for (let m = DESC_RE.exec(f); m; m = DESC_RE.exec(f)) {
    const start = m.index;
    const end = m.index + m[0].length;
    if (m[1]) {
      const ml = /^(?:ml|mililitros|cc)$/.test(m[2]!);
      const gml = m[3] !== undefined && /^(?:ml|mililitros)$/.test(m[3]) !== ml;
      found.push({ basis: ml ? '100ml' : '100g', start, end, kind: 'base', gml, unit: false });
    } else if (m[4]) {
      found.push({ basis: 'serving', start, end, kind: 'other', gml: false, unit: false });
    } else if (m[5]) {
      found.push({ basis: 'package', start, end, kind: 'other', gml: false, unit: false });
    } else if (m[6] && /^(?:por|cada|x|\/)/.test(m[0])) {
      found.push({ basis: 'serving', start, end, kind: 'other', gml: false, unit: true });
    }
  }
  if (found.length === 0) return null;
  const prefixWords = f.slice(0, found[0]!.start).split(/[^a-z%]+/).filter((w) => w !== '');
  if (/\d/.test(f.slice(0, found[0]!.start)) || !prefixWords.every((w) => HEADER_WORDS.has(w))) return null;
  const info: HeaderInfo = { cols: [], serving: null, pkg: null, perUnit: false };
  for (let i = 0; i < found.length; i++) {
    const d = found[i]!;
    const span = f.slice(d.end, found[i + 1]?.start ?? f.length);
    if (d.kind === 'base') {
      if (/\d/.test(span)) return null;
    } else {
      // "Por porción: 120 kcal" is a row without a label, not a header
      if (/\d\s*(?:kcal|kj|cal|mg|mcg|ug|µg)(?![a-z])/.test(span.replace(SIZE_RE, ' '))) return null;
      const sizes = readSizes(span, d.basis === 'package');
      const sz = sizes.find((x) => x.inParens) ?? sizes[0];
      if (sz && d.basis === 'package') info.pkg ??= sz;
      else if (sz) info.serving ??= sz;
    }
    if (d.unit) info.perUnit = true;
    info.cols.push(d.gml ? { basis: d.basis, gml: true } : { basis: d.basis });
  }
  return info;
}

const SERVING_RE =
  /^(?:tamano\s*(?:de\s*la|de|por)?\s*(?:porcion|racion)|porcion|racion|una\s*porcion(?:\s*(?:es|equivale\s*a))?)(?![a-z])\s*[:.=-]?\s*/;
const SERVINGS_RE =
  /(?:porciones|raciones)\s*(?:aprox\w*\.?\s*)?(?:por|x|en\s*el|en|\/)\s*(?:envase|paquete|empaque|recipiente|contenedor|bolsa|caja|unidad)|^(?:numero|no\.?|n\.?|cantidad)\s*de\s*(?:porciones|raciones)|^contiene\s*(?:aprox\w*\.?\s*|~\s*)?\d[\d.,]*\s*(?:porciones|raciones)/;
const APPROX_RE = /aprox|~|\u2248|cerca\s*de|alrededor\s*de|mas\s*o\s*menos/;
const PACKAGE_RE = /(?:contenido|cont\.?|peso|volumen)\s*net[oa]?s?\.?(?![a-z])|^contenido\s*:/;

// ─────────────────────────── Building values ───────────────────────────

interface RowRec {
  def: LabelDef;
  amounts: Amount[];
  headerUnits: UnitTok[];
  noise: boolean;
  pct: number;
  source: string;
  cols: ColumnSpec[] | null;
  /** Basis printed in the row itself ("Calorías por porción 120"). */
  inline: LabelColumnBasis | null;
  skip: boolean;
}

interface Meta {
  servingSize: number | null;
  servingUnit: 'g' | 'ml' | null;
  servingLabel: string | null;
  servingsPerPackage: number | null;
  servingsPerPackageApprox: boolean;
  packageSize: number | null;
  packageUnit: 'g' | 'ml' | null;
}

interface Ctx {
  servingSize: number | null;
  servingUnit: 'g' | 'ml' | null;
  packageSize: number | null;
  packageUnit: 'g' | 'ml' | null;
  commaDecimal: boolean;
  dotDecimal: boolean;
}

interface Draft {
  value: number;
  sourceUnit: string | null;
  converted: boolean;
  uncertain: boolean;
  notes: string[];
  qualifier?: 'lessThan' | 'traces';
}

interface SaltRec {
  basis: LabelColumnBasis;
  grams: number;
  draft: Draft;
  source: string;
}

type BuildOut =
  | { kind: 'error'; message: string }
  | { kind: 'pctOnly' }
  | { kind: 'ok'; nutrients: ParsedNutrient[]; salts: SaltRec[] };

const NOTE_OCR = 'Se corrigió un posible error de OCR en el número; verifícalo.';
const NOTE_NINE = 'Se leyó «9» como la unidad «g» (posible error de OCR); verifícalo.';
const NOTE_NOISE = 'La fila tiene texto que no se reconoció; verifica el valor.';
const NOTE_TRACES = 'Declarado como trazas; se guardó 0.';
const NOTE_PLAIN_CARBS =
  'La etiqueta no indica si son carbohidratos totales o disponibles (las etiquetas europeas declaran los disponibles); se guardaron como totales.';

function baseAmount(basis: LabelColumnBasis, ctx: Ctx): { amount: number; ml: boolean } | null {
  if (basis === '100g') return { amount: 100, ml: false };
  if (basis === '100ml') return { amount: 100, ml: true };
  if (basis === 'serving') return ctx.servingSize ? { amount: ctx.servingSize, ml: ctx.servingUnit === 'ml' } : null;
  return ctx.packageSize ? { amount: ctx.packageSize, ml: ctx.packageUnit === 'ml' } : null;
}

/** More mass than the base itself, or more than ~9 kcal per gram. */
function implausible(value: number, unit: Unit, basis: LabelColumnBasis, ctx: Ctx): boolean {
  const base = baseAmount(basis, ctx);
  if (!base) return false;
  const slack = base.ml ? 1.5 : 1;
  if (isMass(unit)) return (value * MASS_UG[unit]) / 1e6 > base.amount * slack + 0.5;
  const kcal = unit === 'kcal' ? value : value / 4.184;
  return kcal > base.amount * 9 * slack + 5;
}

function makeValue(
  a: Amount,
  tok: UnitTok | null,
  fallback: { unit: Unit; note: string | null } | null,
  target: Unit,
  basis: LabelColumnBasis,
  ctx: Ctx,
): Draft | string {
  const notes: string[] = [];
  let uncertain = false;
  let unit: Unit;
  if (tok) {
    if (tok.unit === 'bad') return `unidad «${tok.printed}» no compatible`;
    unit = tok.unit;
  } else if (fallback) {
    unit = fallback.unit;
    if (fallback.note) {
      uncertain = true;
      notes.push(fallback.note);
    }
  } else {
    return 'falta la unidad';
  }
  if (isMass(unit) !== isMass(target) || (!isMass(unit) && unit !== target)) {
    return `la unidad «${tok?.printed ?? unit}» no corresponde a este nutriente`;
  }
  let value: number;
  let qualifier: Draft['qualifier'];
  if (a.trace) {
    value = 0;
    uncertain = true;
    qualifier = 'traces';
    notes.push(NOTE_TRACES);
  } else {
    const num = readNumber(a.raw, unit);
    if (!num) return `no se pudo leer el número «${a.raw}»`;
    value = num.value;
    if (num.ambiguousG !== null) {
      uncertain = true;
      notes.push(`Separador ambiguo en «${a.raw} g»: se leyó ${fmt(value)} g y no ${fmt(num.ambiguousG)} g.`);
    }
    // "1,200" with a comma: the label (often an English-format import) means 1200, but in a manual field
    // the app's rule reads a comma as decimal (1,2). The two readings differ, so the person confirms it.
    if (num.thousandsSep === ',' && !ctx.commaDecimal) {
      uncertain = true;
      notes.push(`Se leyó «${a.raw}» como ${fmt(value)} (coma como separador de miles); en la app la coma es decimal (${a.raw} = ${fmt(Number(a.raw.replace(',', '.')))}). Confírmalo.`);
    }
    if ((num.thousandsSep === ',' && ctx.commaDecimal) || (num.thousandsSep === '.' && ctx.dotDecimal)) {
      uncertain = true;
      notes.push(
        `Se leyó «${a.raw}» como ${fmt(value)} (separador de miles), pero la etiqueta usa ${num.thousandsSep === ',' ? 'coma' : 'punto'} decimal en otros valores; verifícalo.`,
      );
    }
    if (a.lessThan) {
      uncertain = true;
      qualifier = 'lessThan';
      notes.push(`Valor declarado como menor que ${fmt(value)} ${unit}; se guardó ${fmt(value)}.`);
    }
  }
  if (a.ocr) {
    uncertain = true;
    notes.push(a.nine ? NOTE_NINE : NOTE_OCR);
  }
  let out = value;
  let converted = false;
  if (isMass(unit) && isMass(target) && unit !== target) {
    out = tidy((value * MASS_UG[unit]) / MASS_UG[target]);
    converted = true;
    notes.push(`Convertido de ${fmt(value)} ${tok?.printed ?? unit} a ${fmt(out)} ${target}.`);
  }
  if (implausible(out, target, basis, ctx)) {
    uncertain = true;
    notes.push(`El valor parece demasiado alto para ${BASIS_ES[basis]}; revisa la unidad y la columna.`);
  }
  const d: Draft = { value: out, sourceUnit: tok ? tok.printed : null, converted, uncertain, notes };
  if (qualifier) d.qualifier = qualifier;
  return d;
}

function toNutrient(code: NutrientCode, d: Draft, basis: LabelColumnBasis, source: string): ParsedNutrient {
  const n: ParsedNutrient = {
    code,
    value: d.value,
    basis,
    sourceText: source,
    sourceUnit: d.sourceUnit,
    converted: d.converted,
    uncertain: d.uncertain,
  };
  if (d.notes.length > 0) n.note = d.notes.join(' ');
  if (d.qualifier) n.qualifier = d.qualifier;
  return n;
}

/** "Proteína (g) 15 9": the trailing "9" is an OCR'd "g", only when the row header says g. */
function applyNineFix(amounts: Amount[], header: UnitTok | undefined, n: number): Amount[] {
  if (amounts.length <= n || header?.unit !== 'g') return amounts;
  const out: Amount[] = [];
  for (const a of amounts) {
    const prev = out[out.length - 1];
    if (a.raw === '9' && a.adjNum && !a.unit && prev && !prev.unit && !prev.trace && !prev.nine) {
      out[out.length - 1] = { ...prev, unit: U_G, ocr: true, nine: true };
    } else {
      out.push(a);
    }
  }
  return out.length === n ? out : amounts;
}

function mismatch(r: RowRec, m: number, n: number): BuildOut {
  return {
    kind: 'error',
    message: `La fila «${r.source}» tiene ${m} ${m === 1 ? 'valor' : 'valores'} para ${n} ${n === 1 ? 'columna' : 'columnas'}; no se importó para no mezclar columnas.`,
  };
}

function rowError(r: RowRec, why: string): BuildOut {
  return { kind: 'error', message: `«${r.source}»: ${why}; no se importó.` };
}

function energyUnitOf(
  r: RowRec,
  a: Amount,
  idx: number,
): { tok: UnitTok | null; unit: Unit | 'bad'; assumed: boolean } {
  if (a.unit) return { tok: a.unit, unit: a.unit.unit, assumed: false };
  const eh = r.headerUnits;
  if (eh.length > 0) {
    const tok = eh[idx % eh.length]!;
    return { tok, unit: tok.unit, assumed: false };
  }
  if (r.def.implied) return { tok: null, unit: r.def.implied, assumed: false };
  return { tok: null, unit: 'kcal', assumed: true };
}

function buildEnergy(r: RowRec, cols: ColumnSpec[], ctx: Ctx): BuildOut {
  if (r.amounts.length === 0) return { kind: 'pctOnly' };
  const n = cols.length;
  const groups: Record<EnergyUnit, { a: Amount; tok: UnitTok | null; assumed: boolean }[]> = { kJ: [], kcal: [] };
  let unitless = 0;
  for (const a of r.amounts) {
    const u = energyUnitOf(r, a, unitless);
    if (!a.unit) unitless++;
    if (u.unit === 'bad') return rowError(r, `unidad «${u.tok?.printed ?? ''}» no compatible`);
    if (u.unit !== 'kcal' && u.unit !== 'kJ') return rowError(r, 'la unidad no es de energía');
    groups[u.unit].push({ a, tok: u.tok, assumed: u.assumed });
  }
  for (const g of [groups.kJ, groups.kcal]) if (g.length > 0 && g.length !== n) return mismatch(r, g.length, n);
  const nutrients: ParsedNutrient[] = [];
  for (let k = 0; k < n; k++) {
    for (const unit of ['kJ', 'kcal'] as const) {
      const it = groups[unit][k];
      if (!it) continue;
      const fallback = {
        unit,
        note: it.assumed ? 'La etiqueta no imprime la unidad; se asumió kcal (verifica que no sean kJ).' : null,
      };
      const basis = cols[k]!.basis;
      const d = makeValue(it.a, it.tok, fallback, unit, basis, ctx);
      if (typeof d === 'string') return rowError(r, d);
      if (r.noise) {
        d.uncertain = true;
        d.notes.push(NOTE_NOISE);
      }
      nutrients.push(toNutrient(unit === 'kJ' ? 'kj' : 'kcal', d, basis, r.source));
    }
  }
  return { kind: 'ok', nutrients, salts: [] };
}

function assumedNote(key: DefKey, unit: Unit): string {
  if (key === 'transFat') {
    return 'La etiqueta no imprime la unidad; se asumió g (en Colombia la grasa trans suele declararse en mg).';
  }
  return `La etiqueta no imprime la unidad; se asumió ${unit}.`;
}

function buildPlain(r: RowRec, cols: ColumnSpec[], ctx: Ctx): BuildOut {
  const n = cols.length;
  const header = r.headerUnits[0];
  if (r.headerUnits.some((u) => u.unit !== header?.unit)) return rowError(r, 'el encabezado tiene varias unidades');
  const amounts = applyNineFix(r.amounts, header, n);
  if (amounts.length === 0) return { kind: 'pctOnly' };
  if (amounts.length !== n) return mismatch(r, amounts.length, n);
  const key = r.def.key;
  const target: Unit = key === 'salt' ? 'g' : (UNIT_BY_CODE.get(key as NutrientCode) ?? 'g');
  const nutrients: ParsedNutrient[] = [];
  const salts: SaltRec[] = [];
  for (let k = 0; k < n; k++) {
    const a = amounts[k]!;
    const basis = cols[k]!.basis;
    const tok = a.unit ?? header ?? null;
    if (!tok && r.def.needsUnit) return rowError(r, 'falta la unidad (no se asume en vitaminas y minerales)');
    const d = makeValue(a, tok, { unit: target, note: assumedNote(key, target) }, target, basis, ctx);
    if (typeof d === 'string') return rowError(r, d);
    if (r.def.plainCarbs) {
      d.uncertain = true;
      d.notes.push(NOTE_PLAIN_CARBS);
    }
    if (r.noise) {
      d.uncertain = true;
      d.notes.push(NOTE_NOISE);
    }
    if (key === 'salt') salts.push({ basis, grams: d.value, draft: d, source: r.source });
    else nutrients.push(toNutrient(key as NutrientCode, d, basis, r.source));
  }
  return { kind: 'ok', nutrients, salts };
}

function valuesPerRow(r: RowRec): number {
  if (r.def.key === 'energy') {
    let unitless = 0;
    let kj = 0;
    for (const a of r.amounts) {
      if (energyUnitOf(r, a, unitless).unit === 'kJ') kj++;
      if (!a.unit) unitless++;
    }
    return Math.max(kj, r.amounts.length - kj);
  }
  return applyNineFix(r.amounts, r.headerUnits[0], 1).length;
}

function defName(def: LabelDef): string {
  if (def.key === 'energy') return 'Energía';
  if (def.key === 'salt') return 'Sal';
  return ES_BY_CODE.get(def.key) ?? def.key;
}

// ─────────────────────────────── Parser ───────────────────────────────

export function parseLabelText(text: string): ParsedLabel {
  const warnings: string[] = [];
  const unrecognizedLines: string[] = [];
  const warn = (w: string) => {
    if (!warnings.includes(w)) warnings.push(w);
  };
  const unrec = (l: string) => {
    if (!unrecognizedLines.includes(l)) unrecognizedLines.push(l);
  };

  let input = (typeof text === 'string' ? text : '').normalize('NFC');
  if (input.length > MAX_TEXT) {
    input = input.slice(0, MAX_TEXT);
    warn(`El texto es muy largo; solo se analizaron los primeros ${formatNumber(MAX_TEXT, 0)} caracteres.`);
  }
  const docFolded = fold(input);

  // Mutated from the helpers below: kept in an object so TS does not narrow it to `null`.
  const meta: Meta = {
    servingSize: null,
    servingUnit: null,
    servingLabel: null,
    servingsPerPackage: null,
    servingsPerPackageApprox: false,
    packageSize: null,
    packageUnit: null,
  };
  let headerServing: Size | null = null;
  let headerPackage: Size | null = null;
  let perUnit = false;

  const headerGroups: ColumnSpec[][] = [];
  const rows: RowRec[] = [];
  let cols: ColumnSpec[] | null = null;
  let rowsSinceHeader = 0;
  let prevKind: 'header' | 'row' | 'labelOnly' | 'other' = 'other';
  let pending: { def: LabelDef; info: ValueInfo; source: string; inline: LabelColumnBasis | null } | null = null;
  let lastRow: RowRec | null = null;

  const newRow = (
    def: LabelDef,
    info: ValueInfo,
    headerUnits: UnitTok[],
    source: string,
    inline: LabelColumnBasis | null,
  ): RowRec => {
    const rec: RowRec = {
      def,
      amounts: info.amounts,
      headerUnits,
      noise: info.noise,
      pct: info.pct,
      source,
      cols: inline ? [{ basis: inline }] : cols,
      inline,
      skip: false,
    };
    rows.push(rec);
    rowsSinceHeader++;
    return rec;
  };

  const sizeWarnings = (s: Size, source: string) => {
    if (s.ocr) warn(`Se corrigió un posible error de OCR en «${source}»; verifícalo.`);
    if (s.ambiguous) warn(`Separador ambiguo en «${source}»; verifica el tamaño.`);
  };

  const handleServing = (f: string, r: string, offset: number, raw: string): boolean => {
    const rest = f.slice(offset);
    const label = r
      .slice(offset)
      .replace(/^[\s:.=-]+|[\s.;:]+$/g, '')
      .trim();
    const sizes = readSizes(rest, false);
    const sz = sizes.find((x) => x.inParens) ?? sizes[0];
    if (!sz && label === '') return false;
    if (!sz) {
      meta.servingLabel ??= label;
      warn(`No se pudo leer el peso o volumen de la porción en «${raw}».`);
      return true;
    }
    sizeWarnings(sz, raw);
    if (meta.servingSize === null) {
      meta.servingSize = sz.size;
      meta.servingUnit = sz.unit;
      meta.servingLabel = label;
    } else if (meta.servingSize !== sz.size || meta.servingUnit !== sz.unit) {
      warn(
        `La etiqueta declara dos tamaños de porción (${fmt(meta.servingSize)} ${meta.servingUnit ?? ''} y ${fmt(sz.size)} ${sz.unit}); se usó el primero.`,
      );
    }
    return true;
  };

  const handleServings = (f: string, raw: string): boolean => {
    const fx = fixOcrDigits(f, false);
    const m = /\d+(?:[.,]\d+)?/.exec(fx.text.replace(SIZE_RE, (s) => ' '.repeat(s.length)));
    const n = m ? parseDecimal(m[0]) : null;
    if (n === null || n <= 0) {
      warn(`No se pudo leer el número de porciones por envase en «${raw}».`);
      return true;
    }
    if (m && fx.changed.slice(m.index, m.index + m[0].length).some(Boolean)) {
      warn(`Se corrigió un posible error de OCR en «${raw}»; verifícalo.`);
    }
    if (meta.servingsPerPackage === null) {
      meta.servingsPerPackage = n;
      meta.servingsPerPackageApprox = APPROX_RE.test(f);
    }
    return true;
  };

  const handlePackage = (f: string, raw: string): boolean => {
    if (/\d\s*[x×]\s*\d|\d+\s*(?:unidades|sobres|paquetes|bolsas)\s*(?:de|x)/.test(f)) {
      warn(`El contenido neto parece de varias unidades («${raw}»); ingrésalo a mano.`);
      return true;
    }
    const sz = readSizes(f, true)[0];
    if (!sz) return false;
    sizeWarnings(sz, raw);
    if (meta.packageSize === null) {
      meta.packageSize = sz.size;
      meta.packageUnit = sz.unit;
    }
    return true;
  };

  for (const line of input.split(/\r\n|[\r\n\u2028\u2029]/)) {
    const raw = line.trim();
    if (raw === '') continue;
    const before = prevKind;
    const pend = pending;
    prevKind = 'other';
    pending = null;
    if (raw.length > MAX_LINE) {
      if (/\d/.test(raw)) unrec(raw.slice(0, MAX_LINE));
      continue;
    }
    const f0 = fold(raw);
    const lead = LEAD_RE.exec(f0)?.[0].length ?? 0;
    const f = f0.slice(lead);
    const r = raw.slice(lead);
    if (f === '' || IGNORE_LINE_RE.test(f)) continue;

    // 1. Serving / package metadata
    if (SERVINGS_RE.test(f) && handleServings(f, raw)) continue;
    if (PACKAGE_RE.test(f) && handlePackage(f, raw)) continue;
    const sm = SERVING_RE.exec(f);
    if (sm && !HAS100_RE.test(f) && !(before === 'header' && /^(?:porcion|racion)/.test(f))) {
      if (handleServing(f, r, sm[0].length, raw)) continue;
    }

    // 2. Nutrient rows
    const segs = splitSegments(f).map(parseSegment);
    if (segs.some((x) => x.kind === 'row' || x.kind === 'labelOnly' || x.kind === 'ignored')) {
      const only = segs.length === 1 ? segs[0]! : null;
      if (only?.kind === 'labelOnly') {
        pending = { def: only.def, info: only.info, source: raw, inline: only.inline };
        prevKind = 'labelOnly';
        continue;
      }
      for (const x of segs) {
        if (x.kind === 'row') {
          lastRow = newRow(x.def, x.info, x.info.headerUnits, raw, x.inline);
          prevKind = 'row';
        }
        else if (x.kind === 'values' || x.kind === 'unknown') unrec(raw);
      }
      continue;
    }

    // 3. Column headers
    const hdr = parseHeader(f);
    if (hdr) {
      const merge = cols !== null && rowsSinceHeader === 0 && headerGroups.length > 0;
      const next: ColumnSpec[] = merge && cols ? [...cols, ...hdr.cols] : hdr.cols;
      if (merge) headerGroups[headerGroups.length - 1] = next;
      else headerGroups.push(next);
      cols = next;
      rowsSinceHeader = 0;
      if (hdr.serving) {
        sizeWarnings(hdr.serving, raw);
        headerServing ??= hdr.serving;
      }
      if (hdr.pkg) {
        sizeWarnings(hdr.pkg, raw);
        headerPackage ??= hdr.pkg;
      }
      if (hdr.perUnit) perUnit = true;
      prevKind = 'header';
      continue;
    }

    // 4. Value-only lines: second half of a split row, or the kcal line under "Energía … kJ"
    const only = segs.length === 1 ? segs[0]! : null;
    if (only?.kind === 'values') {
      const prevRow: RowRec | null = lastRow;
      if (pend) {
        const units = [...pend.info.headerUnits, ...only.info.headerUnits];
        lastRow = newRow(pend.def, only.info, units, `${pend.source} ${raw}`, pend.inline);
        prevKind = 'row';
        continue;
      }
      if (
        before === 'row' &&
        prevRow &&
        prevRow.def.key === 'energy' &&
        only.info.amounts.every((a) => a.unit?.unit === 'kcal' || a.unit?.unit === 'kJ')
      ) {
        prevRow.amounts.push(...only.info.amounts);
        prevRow.source = `${prevRow.source} ${raw}`;
        prevKind = 'row';
        continue;
      }
    }
    if (segs.some((x) => x.kind === 'values' || x.kind === 'unknown')) unrec(raw);
  }

  // ── Metadata from column headers ("Por porción de 30 g", "Por envase (250 ml)")
  if (headerServing) {
    if (meta.servingSize === null) {
      meta.servingSize = headerServing.size;
      meta.servingUnit = headerServing.unit;
      meta.servingLabel ??= `${fmt(headerServing.size)} ${headerServing.unit}`;
    } else if (meta.servingSize !== headerServing.size || meta.servingUnit !== headerServing.unit) {
      warn(
        `La etiqueta declara dos tamaños de porción (${fmt(meta.servingSize)} ${meta.servingUnit ?? ''} y ${fmt(headerServing.size)} ${headerServing.unit}); se usó el primero.`,
      );
    }
  }
  if (headerPackage && meta.packageSize === null) {
    meta.packageSize = headerPackage.size;
    meta.packageUnit = headerPackage.unit;
  }

  const mlBase = meta.servingUnit === 'ml' || meta.packageUnit === 'ml';
  for (const group of headerGroups) {
    for (const c of group) {
      if (!c.gml) continue;
      c.basis = mlBase ? '100ml' : '100g';
      warn(`El encabezado dice «100 g o 100 ml»; se tomó ${BASIS_ES[c.basis]}. Verifícalo.`);
    }
  }
  if (perUnit) warn('La columna «por unidad» se tomó como porción; confirma que una unidad equivale a una porción.');

  // ── Rows without any column header
  let basisInferred = false;
  let inferred: LabelColumnBasis | null = null;
  const headerless = rows.filter((x) => x.cols === null);
  if (headerless.some((x) => valuesPerRow(x) > 0)) {
    if (headerless.some((x) => valuesPerRow(x) > 1)) {
      for (const x of headerless) {
        x.skip = true;
        unrec(x.source);
      }
      warn(
        'Hay filas con varios valores pero no se encontró el encabezado de columnas (por 100 g, por porción…); no se importaron para no mezclar columnas.',
      );
    } else {
      inferred = meta.servingSize !== null ? 'serving' : mlBase ? '100ml' : '100g';
      const c: ColumnSpec[] = [{ basis: inferred }];
      for (const x of headerless) x.cols = c;
      basisInferred = true;
      warn(
        inferred === 'serving'
          ? `No se encontró el encabezado de columnas; se asumió que los valores son por porción (${fmt(meta.servingSize ?? 0)} ${meta.servingUnit ?? ''}). Verifícalo.`
          : `No se encontró el encabezado de columnas; se asumió que los valores son ${BASIS_ES[inferred]}. Verifícalo.`,
      );
    }
  }

  // ── Values
  const ctx: Ctx = {
    servingSize: meta.servingSize,
    servingUnit: meta.servingUnit,
    packageSize: meta.packageSize,
    packageUnit: meta.packageUnit,
    commaDecimal: /\d,\d{1,2}(?!\d)/.test(docFolded),
    dotDecimal: /\d\.\d{1,2}(?!\d)/.test(docFolded),
  };
  const nutrients: ParsedNutrient[] = [];
  const salts: SaltRec[] = [];
  const pctOnly: string[] = [];
  for (const row of rows) {
    if (row.skip || !row.cols) continue;
    const out = row.def.key === 'energy' ? buildEnergy(row, row.cols, ctx) : buildPlain(row, row.cols, ctx);
    if (out.kind === 'error') {
      unrec(row.source);
      warn(out.message);
    } else if (out.kind === 'pctOnly') {
      const name = defName(row.def);
      if (!pctOnly.includes(name)) pctOnly.push(name);
    } else {
      nutrients.push(...out.nutrients);
      salts.push(...out.salts);
    }
  }
  if (pctOnly.length > 0) warn(`Solo se declararon como % del valor diario (no se importaron): ${pctOnly.join(', ')}.`);

  const byBasis: Partial<Record<LabelColumnBasis, NutrientMap>> = {};
  for (const n of nutrients) {
    const map = (byBasis[n.basis] ??= {});
    if (map[n.code] === undefined) map[n.code] = n.value;
    else if (map[n.code] !== n.value) {
      warn(`${ES_BY_CODE.get(n.code) ?? n.code} aparece más de una vez (${BASIS_ES[n.basis]}); se usó el primer valor.`);
    }
  }

  // ── Salt → sodium (only where sodium is not printed)
  for (const s of salts) {
    const map = (byBasis[s.basis] ??= {});
    if (map.sodium !== undefined) continue;
    const mg = tidy(s.grams * SODIUM_MG_PER_G_SALT);
    const notes = s.draft.notes.filter((x) => !x.startsWith('Convertido'));
    notes.push(`Calculado a partir de la sal: ${fmt(s.grams)} g × ${SODIUM_MG_PER_G_SALT} = ${fmt(mg)} mg de sodio.`);
    const d: Draft = { ...s.draft, value: mg, converted: true, uncertain: true, notes };
    nutrients.push(toNutrient('sodium', d, s.basis, s.source));
    map.sodium = mg;
    warn('El sodio se calculó a partir de la sal (sal × 400 mg/g); verifícalo.');
  }

  // ── kJ without kcal: never convert silently
  const kjOnly = (Object.keys(byBasis) as LabelColumnBasis[]).filter(
    (b) => byBasis[b]?.kj !== undefined && byBasis[b]?.kcal === undefined,
  );
  if (kjOnly.length > 0) {
    warn(
      `La energía solo aparece en kJ (${kjOnly.map((b) => BASIS_ES[b]).join(', ')}); confirma las kcal (≈ kJ ÷ 4,184).`,
    );
  }
  if (nutrients.some((n) => n.code === 'carbs' && n.note?.includes(NOTE_PLAIN_CARBS))) {
    warn('La etiqueta no dice si los carbohidratos son totales o disponibles; se guardaron como totales.');
  }
  if (docFolded.trim() === '') warn('No hay texto para analizar.');
  else if (nutrients.length === 0) warn('No se reconoció ningún nutriente; revisa el texto o ingrésalo a mano.');

  const columns: LabelColumnBasis[] = [];
  for (const g of headerGroups) for (const c of g) if (!columns.includes(c.basis)) columns.push(c.basis);
  if (inferred && !columns.includes(inferred)) columns.push(inferred);
  for (const row of rows) if (row.inline && !row.skip && !columns.includes(row.inline)) columns.push(row.inline);

  return {
    columns,
    basisInferred,
    ...meta,
    nutrients,
    byBasis,
    warnings,
    unrecognizedLines,
  };
}
