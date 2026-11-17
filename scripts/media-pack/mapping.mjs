// Strict matching of Salud exercises (public/data/exercises.json) against the TEXT metadata of the public
// exercise dataset (ids, names, equipment, target). Only text is read: no media file is ever opened.
//
// Rules (the project notes):
//  - automatic: the normalised English name, the equipment AND the primary muscle all agree, and exactly one
//    dataset entry agrees  -> matchRule "name+equipment+muscle", matchConfidence "high", needsReview "no".
//  - name only (or several entries agree)  -> needsReview "yes" (a person must confirm or clear it by hand).
//  - anything else stays empty.

/** Lowercase, no accents, hyphens / slashes / underscores as spaces, other punctuation dropped, plural -s removed. */
export function normaliseName(name) {
  let s = String(name ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[-_/]+/g, ' ')
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
  s = s
    .replace(/\be z\b/g, 'ez')
    .replace(/\bpush ?ups?\b/g, 'push up')
    .replace(/\bpull ?ups?\b/g, 'pull up')
    .replace(/\bchin ?ups?\b/g, 'chin up')
    .replace(/\bsit ?ups?\b/g, 'sit up')
    .replace(/\bdumb bells?\b/g, 'dumbbell')
    .replace(/\bkettle bells?\b/g, 'kettlebell')
    .replace(/\bbar bells?\b/g, 'barbell')
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => (t.length > 3 && t.endsWith('s') && !t.endsWith('ss') ? t.slice(0, -1) : t))
    .join(' ')
}

/** Dataset equipment -> Salud catalog equipment id. Unlisted values have no counterpart (never auto-match). */
export const EQUIPMENT_MAP = {
  'body weight': 'body only',
  cable: 'cable',
  'leverage machine': 'machine',
  'sled machine': 'machine',
  'smith machine': 'machine',
  band: 'bands',
  'resistance band': 'bands',
  barbell: 'barbell',
  'olympic barbell': 'barbell',
  'ez barbell': 'e-z curl bar',
  dumbbell: 'dumbbell',
  kettlebell: 'kettlebells',
  'medicine ball': 'medicine ball',
  'stability ball': 'exercise ball',
  roller: 'foam roll',
}

/** Dataset target muscle -> Salud catalog muscle id. Unlisted targets (cardio, serratus...) have no counterpart. */
export const MUSCLE_MAP = {
  abs: 'abdominals',
  quads: 'quadriceps',
  lats: 'lats',
  calves: 'calves',
  pectorals: 'chest',
  glutes: 'glutes',
  hamstrings: 'hamstrings',
  adductors: 'adductors',
  triceps: 'triceps',
  'upper back': 'middle back',
  biceps: 'biceps',
  delts: 'shoulders',
  forearms: 'forearms',
  traps: 'traps',
  abductors: 'abductors',
  spine: 'lower back',
  'levator scapulae': 'neck',
}

export const mapEquipment = (e) => EQUIPMENT_MAP[String(e ?? '').toLowerCase()] ?? null
export const mapMuscle = (m) => MUSCLE_MAP[String(m ?? '').toLowerCase()] ?? null

/** nameKey -> dataset entries (id, name, equipment, target). */
export function buildDatasetIndex(dataset) {
  const index = new Map()
  for (const d of dataset) {
    const key = normaliseName(d.name)
    if (!key) continue
    const list = index.get(key) ?? []
    list.push({ id: String(d.id), name: String(d.name), equipment: d.equipment, target: d.target })
    index.set(key, list)
  }
  return index
}

/**
 * Match of one catalog exercise ({ nameEn, equipment, primaryMuscles }).
 * Returns { datasetId, datasetName, matchRule, matchConfidence, needsReview } with empty strings for "no candidate".
 */
export function matchExercise(ex, index) {
  const none = { datasetId: '', datasetName: '', matchRule: '', matchConfidence: '', needsReview: '' }
  const cands = index.get(normaliseName(ex.nameEn)) ?? []
  if (!cands.length) return none
  const agree = cands.filter((c) => {
    const eq = mapEquipment(c.equipment)
    const mu = mapMuscle(c.target)
    return !!eq && eq === ex.equipment && !!mu && (ex.primaryMuscles ?? []).includes(mu)
  })
  const pack = (list, rule, confidence, review) => ({
    datasetId: list.map((c) => c.id).join('|'),
    datasetName: list.map((c) => c.name).join('|'),
    matchRule: rule,
    matchConfidence: confidence,
    needsReview: review,
  })
  if (agree.length === 1) return pack(agree, 'name+equipment+muscle', 'high', 'no')
  if (agree.length > 1) return pack(agree, `ambiguous(${agree.length}):name+equipment+muscle`, 'low', 'yes')
  return pack(cands, cands.length > 1 ? `ambiguous(${cands.length}):name-only` : 'name-only', 'low', 'yes')
}

// ───────────── CSV (RFC 4180 subset) ─────────────
export function parseCsv(text) {
  const src = text.replace(/^﻿/, '')
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') (cell += '"', i++)
        else quoted = false
      } else cell += c
    } else if (c === '"') quoted = true
    else if (c === ',') (row.push(cell), (cell = ''))
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(cell)
      cell = ''
      if (row.length > 1 || row[0] !== '') rows.push(row)
      row = []
    } else cell += c
  }
  if (cell !== '' || row.length) (row.push(cell), rows.push(row))
  const [head, ...body] = rows
  return { header: head ?? [], rows: body.map((r) => Object.fromEntries((head ?? []).map((h, i) => [h, r[i] ?? '']))) }
}

export function toCsv(header, rows) {
  const q = (v) => (/[",\n\r]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))
  return '﻿' + [header.map(q).join(','), ...rows.map((r) => header.map((h) => q(r[h] ?? '')).join(','))].join('\r\n') + '\r\n'
}

export const NEW_COLUMNS = ['datasetId', 'datasetName', 'matchRule']

/**
 * Applies the matches to CSV rows. A row the owner already cleared by hand (same dataset id, needsReview "no")
 * keeps its decision. Returns { header, rows, counts }.
 */
export function applyMapping(csv, catalogById, index) {
  const header = [...csv.header]
  for (const c of [...NEW_COLUMNS, 'matchConfidence', 'needsReview']) if (!header.includes(c)) header.push(c)
  const counts = { automatic: 0, needsReview: 0, none: 0, keptByHand: 0 }
  const rows = csv.rows.map((r) => {
    const ex = catalogById.get(r.exerciseId)
    const m = ex ? matchExercise(ex, index) : { datasetId: '', datasetName: '', matchRule: '', matchConfidence: '', needsReview: '' }
    const keep = m.needsReview === 'yes' && r.needsReview === 'no' && r.datasetId && r.datasetId === m.datasetId
    const out = { ...r, ...m }
    if (keep) {
      out.needsReview = 'no'
      counts.keptByHand++
    }
    if (out.needsReview === 'no') counts.automatic++
    else if (out.needsReview === 'yes') counts.needsReview++
    else counts.none++
    return out
  })
  return { header, rows, counts }
}
