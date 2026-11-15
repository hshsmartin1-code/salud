/**
 * Glue between the stored per-profile data and the pure adaptive-energy module.
 * Everything is read through the active profile's repo: no cross-profile data ever enters a calculation.
 */
import { useLiveQuery } from 'dexie-react-hooks'
import { useProfile, useRepo } from '../../app/profile'
import { pickGoalForDate } from '../../db/queries'
import type { Repo } from '../../db/repo'
import type { BodyMeasurement, DayMark, EnergyAdjustment, FoodLog, Goal, ImportedDaily, Profile, StoredAdaptiveSettings } from '../../db/types'
import {
  adaptiveSettingsForGoal,
  DEFAULT_ADAPTIVE_SETTINGS,
  estimateObservedTdee,
  proposeAdjustment,
  sanitizeAdaptiveSettings,
  toAdjustmentRecord,
  type AdaptiveSettings,
  type AdjustmentProposal,
  type AdjustmentRecord,
  type IntakeDay,
  type ObservedTdeeResult,
  type WeighIn,
} from '../../domain/adaptiveEnergy'
import { addDays, formatDateEs, todayLocal } from '../../domain/dates'
import { ACTIVITY_LEVELS, ageFromBirthDate, mifflinStJeor } from '../../domain/energy'
import { sumNutrients } from '../../domain/nutrients'
import { formatNumber } from '../../domain/units'

export interface FormulaEstimate {
  bmr: number
  tdee: number
  activityEs: string
  factor: number
  weightKg: number
}

export interface AdaptiveState {
  today: string
  /** Last day included in the window (yesterday: today is still being logged). */
  to: string
  goal: Goal | null
  settings: AdaptiveSettings
  stored: StoredAdaptiveSettings | undefined
  weight: { kg: number; date: string } | null
  formula: FormulaEstimate | null
  /** What is missing to compute the formula TDEE (Spanish). */
  missing: string[]
  observed: ObservedTdeeResult | null
  proposal: AdjustmentProposal | null
  history: EnergyAdjustment[]
}

/** One IntakeDay per date with food logs (or a Phase 0 daily total when there are no logs that day). */
export function buildIntakeDays(logs: FoodLog[], imported: ImportedDaily[], marks: DayMark[]): IntakeDay[] {
  const byDay = new Map<string, FoodLog[]>()
  for (const l of logs) byDay.set(l.date, [...(byDay.get(l.date) ?? []), l])
  const mark = new Map(marks.map((m) => [m.date, m.complete]))
  const out = new Map<string, IntakeDay>()
  for (const [date, ls] of byDay) {
    const { totals, partial } = sumNutrients(ls)
    out.set(date, { date, kcal: totals.kcal ?? null, entries: ls.length, partial: partial.includes('kcal'), complete: mark.get(date) ?? null })
  }
  for (const d of imported) {
    if (d.metric !== 'kcal_intake' || d.value === null || d.excludeFromStats || out.has(d.date)) continue
    out.set(d.date, { date: d.date, kcal: d.value, entries: 1, partial: false, complete: mark.get(d.date) ?? null })
  }
  for (const [date, complete] of mark) if (!out.has(date)) out.set(date, { date, kcal: null, entries: 0, partial: false, complete })
  return [...out.values()].sort((a, b) => (a.date < b.date ? -1 : 1))
}

export function buildWeighIns(rows: BodyMeasurement[]): WeighIn[] {
  return rows
    .filter((m) => m.weightKg !== null)
    .map((m) => ({ date: m.date, weightKg: m.weightKg as number, approx: !!m.approx, excluded: !!m.excludeFromStats }))
}

export function formulaEstimate(profile: Profile, goal: Goal | null, weight: { kg: number } | null, today: string): { formula: FormulaEstimate | null; missing: string[] } {
  const missing: string[] = []
  const heightCm = profile.heightCm ?? goal?.inputs?.heightCm ?? null
  const ageYears = profile.birthDate ? ageFromBirthDate(profile.birthDate, today) : (goal?.inputs?.ageYears ?? null)
  const activity = ACTIVITY_LEVELS.find((l) => l.key === (goal?.inputs?.activity ?? profile.activity))
  if (!weight) missing.push('un peso registrado')
  if (!heightCm) missing.push('la estatura')
  if (ageYears === null) missing.push('la fecha de nacimiento')
  if (!activity) missing.push('el nivel de actividad')
  if (!weight || !heightCm || ageYears === null || !activity) return { formula: null, missing }
  const bmr = mifflinStJeor({ weightKg: weight.kg, heightCm, ageYears, sex: profile.sex })
  return { formula: { bmr, tdee: bmr * activity.factor, activityEs: activity.es, factor: activity.factor, weightKg: weight.kg }, missing }
}

export function resolveSettings(goal: Goal | null, stored: StoredAdaptiveSettings | undefined): AdaptiveSettings {
  const base = goal ? adaptiveSettingsForGoal(goal.goal) : DEFAULT_ADAPTIVE_SETTINGS
  const s: AdaptiveSettings = { ...base }
  if (stored) {
    s.mode = stored.mode
    s.phase = stored.phase
    s.targetRatePctPerWeek = stored.targetRatePctPerWeek
    if (stored.windowDays !== undefined) s.windowDays = stored.windowDays
    if (stored.maxStepKcal !== undefined) s.maxStepKcal = stored.maxStepKcal
    if (stored.cooldownDays !== undefined) s.cooldownDays = stored.cooldownDays
    if (stored.minKcalFloor !== undefined) s.minKcalFloor = stored.minKcalFloor
  }
  return sanitizeAdaptiveSettings(s)
}

/** Latest exact weigh-in (approximate values only when nothing else exists). */
function latestWeighIn(rows: BodyMeasurement[]): { kg: number; date: string } | null {
  const ws = rows.filter((m) => m.weightKg !== null && !m.excludeFromStats).sort((a, b) => (a.date + a.createdAt).localeCompare(b.date + b.createdAt))
  const exact = ws.filter((m) => !m.approx)
  const pick = (exact.length ? exact : ws).at(-1)
  return pick ? { kg: pick.weightKg as number, date: pick.date } : null
}

export async function loadAdaptiveState(r: Repo, profile: Profile, today: string): Promise<AdaptiveState> {
  const stored = profile.settings.adaptive
  const goals = await r.all('goals')
  const goal = pickGoalForDate(goals, today)
  const settings = resolveSettings(goal, stored)
  const to = addDays(today, -1)
  const from = addDays(to, -(settings.windowDays - 1))
  // A little history before the window tells the module whether the record reaches back far enough.
  const lookback = addDays(from, -45)
  const [logs, imported, marks, body, history] = await Promise.all([
    r.range('foodLogs', lookback, to),
    r.range('importedDaily', lookback, to),
    r.range('dayMarks', lookback, to),
    r.all('bodyMeasurements'),
    r.all('energyAdjustments'),
  ])
  history.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
  const weight = latestWeighIn(body.filter((m) => m.date <= today))
  const { formula, missing } = formulaEstimate(profile, goal, weight, today)
  const state: AdaptiveState = { today, to, goal, settings, stored, weight, formula, missing, observed: null, proposal: null, history }
  if (!formula) return state

  const observed = estimateObservedTdee({
    intake: buildIntakeDays(logs, imported, marks),
    weights: buildWeighIns(body),
    to,
    formulaTdee: formula.tdee,
    bmr: formula.bmr,
    settings,
  })
  state.observed = observed
  if (!goal || goal.kcal <= 0 || !weight) return state

  const records: AdjustmentRecord[] = history.map((h) => ({ date: h.date, fromKcal: h.fromKcal, toKcal: h.toKcal, tdee: h.blendedTdee ?? 0, reason: h.reason, applied: h.applied }))
  // Any goal the person set by hand also restarts the waiting period between changes.
  if (!goal.adaptive && goal.origin !== 'phase0' && !records.some((h) => h.date >= goal.validFrom)) {
    records.push({ date: goal.validFrom, fromKcal: goal.kcal, toKcal: goal.kcal, tdee: 0, reason: 'Objetivo definido por ti', applied: 'accepted' })
  }
  state.proposal = proposeAdjustment({
    observed,
    settings,
    currentKcal: goal.kcal,
    currentWeightKg: weight.kg,
    bmr: formula.bmr,
    sex: profile.sex,
    manualOverride: goal.method === 'manual',
    history: records,
    today,
  })
  return state
}

export function useAdaptiveEnergy(today = todayLocal()): AdaptiveState | undefined {
  const profile = useProfile()
  const r = useRepo()
  return useLiveQuery(() => loadAdaptiveState(r, profile, today), [r, profile, today])
}

/**
 * Writes a new goal (valid from today) with the proposed kcal plus an energyAdjustments row.
 * Protein and fat grams stay as they were; the change goes to carbohydrates (4 kcal/g).
 */
export async function applyProposal(r: Repo, s: AdaptiveState, applied: 'auto' | 'accepted'): Promise<Goal | null> {
  const { goal, proposal, observed, formula, settings, today } = s
  if (!goal || !proposal) return null
  const rec = toAdjustmentRecord(proposal, today, applied)
  if (!rec) return null
  const delta = rec.toKcal - rec.fromKcal
  const carbs = Math.max(0, Math.round(goal.carbs + delta / 4))
  const f0 = (n: number) => formatNumber(n, 0)
  const head = [
    `Ajuste adaptativo del ${formatDateEs(today)} (${applied === 'auto' ? 'automático' : 'aceptado por ti'}): ${f0(rec.fromKcal)} → ${f0(rec.toKcal)} kcal.`,
    `Gasto estimado ≈ ${f0(rec.tdee)} kcal (fórmula: ${formula ? f0(formula.tdee) : '—'} kcal); confianza ${observed?.confidence ?? '—'}.`,
    `Carbohidratos ${delta >= 0 ? '+' : '−'}${f0(Math.abs(carbs - goal.carbs))} g; proteína y grasa sin cambios.`,
    'Es una estimación a partir de tus registros, no una medición exacta.',
  ].join('\n')
  const { id: _id, profileId: _p, createdAt: _c, updatedAt: _u, origin: _o, sourceRef: _s, ...rest } = goal
  void _id
  void _p
  void _c
  void _u
  void _o
  void _s
  const newGoal = await r.add('goals', {
    ...rest,
    origin: 'app',
    validFrom: today,
    kcal: rec.toKcal,
    carbs,
    adaptive: true,
    methodText: `${head}\n\n${goal.methodText}`,
    warnings: goal.warnings.filter((w) => !w.startsWith('Ajuste adaptativo')),
  })
  await r.add('energyAdjustments', {
    date: today,
    fromKcal: rec.fromKcal,
    toKcal: rec.toKcal,
    formulaTdee: formula ? Math.round(formula.tdee) : null,
    observedTdee: observed?.observedTdee !== null && observed?.observedTdee !== undefined ? Math.round(observed.observedTdee) : null,
    blendedTdee: rec.tdee,
    confidence: observed?.confidence ?? 'none',
    phase: settings.phase,
    ratePctPerWeek: proposal.ratePctPerWeek,
    applied,
    reason: rec.reason,
    goalId: newGoal.id,
  })
  return newGoal
}
