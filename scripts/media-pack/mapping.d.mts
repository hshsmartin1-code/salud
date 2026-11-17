export function normaliseName(name: string): string
export const EQUIPMENT_MAP: Record<string, string>
export const MUSCLE_MAP: Record<string, string>
export function mapEquipment(e: string | null | undefined): string | null
export function mapMuscle(m: string | null | undefined): string | null
export interface DatasetEntry {
  id: string
  name: string
  equipment: string
  target: string
}
export function buildDatasetIndex(dataset: { id: string | number; name: string; equipment: string; target: string }[]): Map<string, DatasetEntry[]>
export interface MatchResult {
  datasetId: string
  datasetName: string
  matchRule: string
  matchConfidence: string
  needsReview: string
}
export function matchExercise(ex: { nameEn: string; equipment: string | null; primaryMuscles?: readonly string[] }, index: Map<string, DatasetEntry[]>): MatchResult
export function parseCsv(text: string): { header: string[]; rows: Record<string, string>[] }
export function toCsv(header: string[], rows: Record<string, string>[]): string
export const NEW_COLUMNS: string[]
export function applyMapping(
  csv: { header: string[]; rows: Record<string, string>[] },
  catalogById: Map<string, { nameEn: string; equipment: string | null; primaryMuscles?: readonly string[] }>,
  index: Map<string, DatasetEntry[]>,
): { header: string[]; rows: Record<string, string>[]; counts: { automatic: number; needsReview: number; none: number; keptByHand: number } }
