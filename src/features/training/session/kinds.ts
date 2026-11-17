import { SET_KIND_LABEL, type SetKind } from '../../../domain/setKind'

/** Letter colour per set type (always a letter too: never colour alone). */
export const KIND_TONE: Record<SetKind, string> = { normal: 'text-muted', warmup: 'text-warn', drop: 'text-sleep', failure: 'text-bad' }

export function kindName(kind: SetKind, n: number): string {
  return kind === 'normal' ? `Serie ${n}` : SET_KIND_LABEL[kind]
}
