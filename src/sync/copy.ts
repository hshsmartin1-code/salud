import { SYNC_CONFIG } from './config'

/** Storage notes shown around the app. They must describe what this build really does. */
export const STORAGE_NOTE_SHORT = SYNC_CONFIG
  ? 'Datos guardados en este dispositivo. Sincronización opcional por perfil con una cuenta de Google.'
  : 'Datos guardados solo en este dispositivo. Sin cuentas ni sincronización en la nube.'

export const STORAGE_NOTE_TINY = SYNC_CONFIG ? 'Datos en este dispositivo · nube opcional por perfil.' : 'Datos guardados solo en este dispositivo. Sin sincronización.'

export const STORAGE_NOTE_LONG = SYNC_CONFIG
  ? 'Todo se guarda primero en este dispositivo (IndexedDB) y la app funciona sin conexión. Si vinculas un perfil a una cuenta de Google en «Cuenta y sincronización», sus registros se copian a Cloud Firestore bajo esa cuenta y solo esa cuenta puede leerlos; los perfiles sin vincular siguen solo en este dispositivo. Las fotos y los datos de Health Connect no se suben. La app también se conecta a internet para descargarse y, cuando tú lo pides, para consultar un código de barras o un producto en Open Food Facts (se envía únicamente el código o el texto buscado).'
  : 'Todo se guarda en este dispositivo (IndexedDB del navegador). No hay cuentas, nube ni sincronización entre dispositivos, y cada perfil tiene sus datos separados. La app solo se conecta a internet para descargarse y, cuando tú lo pides, para consultar un código de barras o un producto en Open Food Facts (se envía únicamente el código o el texto buscado).'

export const BACKUP_NOTE = SYNC_CONFIG
  ? 'La sincronización no sustituye a los respaldos. Los archivos contienen datos de salud: no los compartas.'
  : 'Sin nube: exporta un respaldo con frecuencia. Los archivos contienen datos de salud: no los compartas.'

export const SYNC_ERROR_TEXT: Record<string, string> = {
  offline: 'Sin conexión. Se reintentará sola cuando vuelva internet; tus datos siguen guardados aquí.',
  auth: 'La sesión caducó o se revocó. Inicia sesión de nuevo con la misma cuenta.',
  permission: 'Firestore rechazó el acceso. Revisa que las reglas de seguridad estén publicadas (guía de configuración de Firebase).',
  quota: 'Se alcanzó la cuota gratuita diaria de Firestore. Se reintentará más tarde; tus datos siguen en este dispositivo.',
  invalid: 'Firestore rechazó un registro con formato no válido. No se perdió nada en este dispositivo.',
  'account-mismatch': 'La sesión abierta es de otra cuenta. No se sincronizó nada.',
  'foreign-row': 'Un registro de esta cuenta ya existe en otro perfil de este dispositivo. No se sincronizó nada: vincula la cuenta a ese perfil.',
  partial: 'Algunos registros no se pudieron sincronizar; el resto sí. Siguen guardados en este dispositivo.',
  'cloud-reset': 'Los datos de esta cuenta se borraron de la nube. Desvincula el perfil y vuélvelo a vincular si quieres subirlos otra vez.',
  'profile-missing': 'El perfil ya no existe en este dispositivo.',
  'not-linked': 'Este perfil no está vinculado.',
  conflict: 'Otro dispositivo cambió los mismos registros; se reintentará.',
  unknown: 'Error inesperado al sincronizar. Se reintentará más tarde.',
}

/** Texts of the conflict cards (account screen). */
export const CONFLICT_TEXT = {
  merge: 'Combinar',
  mergeHelp:
    'Combinar une las dos versiones de la sesión: conserva todas sus series, junta las notas de ambas y, en lo demás, usa el cambio más reciente.',
  sessionDeletedHere: 'Aquí borraste esta sesión; en otro dispositivo se modificó. Lo que elijas se aplica a la sesión y a todas sus series.',
  sessionDeletedElsewhere: 'En otro dispositivo se borró esta sesión; aquí tiene cambios sin subir. Lo que elijas se aplica a la sesión y a todas sus series.',
  includesSets: (n: number) => (n === 1 ? 'Incluye 1 serie con cambios.' : `Incluye ${n} series con cambios.`),
} as const
