import type { SaveOutcome } from './saveFile'

export const IMPORT_MERGE_LABEL = 'Añadir a lo existente'
export const IMPORT_MERGE_HELP = `${IMPORT_MERGE_LABEL}: agrega lo que falta y, si un registro existe en ambos, conserva la versión más reciente.`

/**
 * «Reemplazar» deletes the target profile's rows before importing. A safety copy of every existing
 * target is saved first; if any copy cannot be handed to the platform, nothing is imported.
 */
export interface ReplaceTarget {
  id: string
  name: string
}

export interface ReplaceDeps<R> {
  /** Exports and saves the safety copy of one profile. */
  saveSafetyCopy: (target: ReplaceTarget) => Promise<SaveOutcome>
  runImport: () => Promise<R>
}

export type ReplaceOutcome<R> = { ok: true; result: R } | { ok: false; message: string }

export function safetyCopyFailedMessage(name: string, detail: string): string {
  return `No se reemplazó nada. No se pudo guardar la copia de seguridad de «${name}» antes de reemplazar. ${detail} Si quieres importar sin borrar nada, usa «${IMPORT_MERGE_LABEL}».`
}

export async function replaceWithSafetyCopy<R>(targets: readonly ReplaceTarget[], deps: ReplaceDeps<R>): Promise<ReplaceOutcome<R>> {
  for (const t of targets) {
    let out: SaveOutcome
    try {
      out = await deps.saveSafetyCopy(t)
    } catch (e) {
      out = { ok: false, reason: 'error', message: e instanceof Error && e.message ? e.message : 'Error inesperado.' }
    }
    if (!out.ok) return { ok: false, message: safetyCopyFailedMessage(t.name, out.message) }
  }
  return { ok: true, result: await deps.runImport() }
}

/** The sentence of the confirmation shown before a replace. */
export function replaceConfirmText(names: readonly string[], removed: number | null): string {
  const who = names.length ? names.map((n) => `«${n}»`).join(', ') : 'el perfil de destino'
  const rows = removed === null ? '' : removed === 1 ? ' Se borra 1 registro actual.' : removed > 1 ? ` Se borran ${removed.toLocaleString('es-CO')} registros actuales.` : ''
  return `Los datos actuales de ${who} en este dispositivo se reemplazarán por los del archivo (solo en las tablas que trae el archivo).${rows} Antes se guarda una copia de seguridad; si no se puede guardar, no se reemplaza nada.`
}
