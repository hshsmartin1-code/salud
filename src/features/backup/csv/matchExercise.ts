/**
 * Matches exercise names of other apps ("Bench Press (Barbell)", "Lat Pulldown - Wide Grip") to the
 * library (catalog + own exercises). Pure.
 *
 * Names are normalised (lowercase, no accents or punctuation), reduced to tokens (stop words dropped,
 * plurals folded, abbreviations such as DB/BB expanded) and compared as token SETS, so word order and
 * where the equipment sits ("Barbell Bench Press" / "Bench Press (Barbell)") do not matter.
 * score = 0.7 × share of the source tokens found in the candidate + 0.3 × share of the candidate tokens
 * found in the source (extra qualifiers in the candidate lower the score a little).
 */
import { normalize } from '../../../domain/search'

export interface LibraryEntry {
  /** Id stored in sets: `fedb:...` or `custom:<id>`. */
  id: string
  nameEs: string
  nameEn: string
  aliases: string[]
  custom: boolean
}

const STOP = new Set(['the', 'a', 'an', 'with', 'on', 'of', 'to', 'and', 'in', 'for', 'de', 'con', 'el', 'la', 'los', 'las', 'y'])
const SYN: Record<string, string> = {
  db: 'dumbbell',
  dumbell: 'dumbbell',
  bb: 'barbell',
  kb: 'kettlebell',
  ez: 'ez',
  bw: 'body',
  bodyweight: 'body',
  mancuerna: 'dumbbell',
  mancuernas: 'dumbbell',
  barra: 'barbell',
  polea: 'cable',
  maquina: 'machine',
  pesa: 'kettlebell',
}

function foldToken(t: string): string {
  const s = SYN[t] ?? t
  return s.length > 3 && s.endsWith('s') && !s.endsWith('ss') ? s.slice(0, -1) : s
}

/** Sorted unique tokens of a name. */
export function nameTokens(name: string): string[] {
  const toks = normalize(name)
    .split(' ')
    .filter((t) => t && !STOP.has(t))
    .map(foldToken)
  return [...new Set(toks)].sort()
}

/** Stable key of a name (used to group the same exercise across files and as part of ids). */
export const nameKey = (name: string): string => nameTokens(name).join(' ')

export type MatchLevel = 'exact' | 'probable' | 'possible'
export interface Match {
  entry: LibraryEntry
  score: number
  level: MatchLevel
}

export const AUTO_THRESHOLD = 0.8
export const SUGGEST_THRESHOLD = 0.55

function score(src: string[], cand: string[]): number {
  if (!src.length || !cand.length) return 0
  const c = new Set(cand)
  const inter = src.filter((t) => c.has(t)).length
  if (inter === src.length && inter === cand.length) return 1
  return 0.7 * (inter / src.length) + 0.3 * (inter / cand.length)
}

export interface LibraryIndex {
  rows: { entry: LibraryEntry; tokenSets: string[][] }[]
}

export function buildIndex(entries: readonly LibraryEntry[]): LibraryIndex {
  return {
    rows: entries.map((entry) => {
      const names = new Set([entry.nameEn, entry.nameEs, ...entry.aliases].filter(Boolean))
      return { entry, tokenSets: [...names].map(nameTokens).filter((t) => t.length) }
    }),
  }
}

/** Best candidates (score ≥ SUGGEST_THRESHOLD), best first; own exercises win ties, then shorter names. */
export function matchExercise(name: string, index: LibraryIndex, limit = 3): Match[] {
  const src = nameTokens(name)
  if (!src.length) return []
  const out: (Match & { len: number })[] = []
  for (const { entry, tokenSets } of index.rows) {
    let best = 0
    let len = 99
    for (const t of tokenSets) {
      const s = score(src, t)
      if (s > best || (s === best && t.length < len)) {
        best = s
        len = t.length
      }
    }
    if (best >= SUGGEST_THRESHOLD) out.push({ entry, score: best, level: best >= 0.98 ? 'exact' : best >= AUTO_THRESHOLD ? 'probable' : 'possible', len })
  }
  out.sort((a, b) => b.score - a.score || Number(b.entry.custom) - Number(a.entry.custom) || a.len - b.len || a.entry.id.localeCompare(b.entry.id))
  return out.slice(0, limit).map(({ len: _len, ...m }) => (void _len, m))
}
