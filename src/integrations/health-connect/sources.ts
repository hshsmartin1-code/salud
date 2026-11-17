const KNOWN: Record<string, string> = {
  'com.google.android.apps.fitness': 'Google Fit',
  'com.google.android.apps.healthdata': 'Health Connect',
  'com.sec.android.app.shealth': 'Samsung Health',
  'com.fitbit.FitbitMobile': 'Fitbit',
  'com.garmin.android.apps.connectmobile': 'Garmin Connect',
  'com.withings.wiscale2': 'Withings',
  'com.huawei.health': 'Huawei Health',
  'com.xiaomi.wearable': 'Mi Fitness',
  'com.huami.watch.hmwatchmanager': 'Zepp',
  'com.strava': 'Strava',
}

export const PHONE_LABEL = 'Este teléfono'

/** On-device steps are attributed to `android` (before 2026-06) or `com.android.healthconnect.phone.<hash>`. */
export function isPhoneSource(pkg: string): boolean {
  return pkg === 'android' || pkg.startsWith('com.android.healthconnect.phone')
}

export function sourceLabel(pkg: string): string {
  if (isPhoneSource(pkg)) return PHONE_LABEL
  return KNOWN[pkg] ?? pkg
}

/** Distinct, human labels for a list of packages. */
export function sourceLabels(pkgs: readonly string[]): string[] {
  return [...new Set(pkgs.map(sourceLabel))]
}

const DEVICE_TYPES: Record<string, string> = {
  watch: 'Reloj',
  phone: 'Teléfono',
  scale: 'Báscula',
  ring: 'Anillo',
  'fitness-band': 'Pulsera',
  'chest-strap': 'Banda de pecho',
  'head-mounted': 'Dispositivo de cabeza',
  'smart-display': 'Pantalla',
}

export function deviceLabel(type?: string, manufacturer?: string, model?: string): string | null {
  const t = type ? DEVICE_TYPES[type] : undefined
  const mm = [manufacturer, model].filter(Boolean).join(' ')
  const parts = [t, mm].filter(Boolean)
  return parts.length ? parts.join(' · ') : null
}

const EXERCISE_LABELS: Record<string, string> = {
  running: 'Carrera',
  running_treadmill: 'Cinta de correr',
  walking: 'Caminata',
  biking: 'Ciclismo',
  biking_stationary: 'Bicicleta estática',
  hiking: 'Senderismo',
  strength_training: 'Fuerza',
  weightlifting: 'Levantamiento de pesas',
  hiit: 'HIIT',
  swimming_pool: 'Natación (piscina)',
  swimming_open_water: 'Natación (aguas abiertas)',
  yoga: 'Yoga',
  elliptical: 'Elíptica',
  rowing: 'Remo',
  rowing_machine: 'Máquina de remo',
  other: 'Otro entrenamiento',
}

export function exerciseLabel(key: string | undefined, title?: string | null): string {
  if (title) return title
  return (key && EXERCISE_LABELS[key]) || EXERCISE_LABELS.other
}
