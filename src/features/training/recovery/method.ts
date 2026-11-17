/** Short method text and sources shown under "Cómo se calcula" (full version: docs/V3_MUSCLE_RECOVERY.md). */
import { BASE_WINDOW_HOURS, EXTENDED_WINDOW_HOURS, HIGH_SESSION_SETS, RECENT_HOURS, WEEKLY_RANGE } from './recovery'

export const METHOD_PARAGRAPHS: readonly string[] = [
  'Es una guía general calculada con tu registro y con investigación sobre grupos de personas. No mide tu recuperación real, las agujetas, el sueño ni la alimentación, y no es consejo médico.',
  `Se toma la última sesión terminada con al menos 1 serie efectiva para el músculo. Menos de ${RECENT_HOURS} h: trabajado hace poco. Después, ventana orientativa de ${BASE_WINDOW_HOURS} h, o de ${EXTENDED_WINDOW_HOURS} h si esa sesión sumó ${HIGH_SESSION_SETS} series efectivas o más. Pasados 7 días sin estímulo se muestra en neutro.`,
  `La síntesis de proteína muscular sigue elevada entre 24 y 48 h tras una sesión, y la fuerza tardó hasta 72 h o más en volver tras sesiones de 8 a 10 series para un músculo. Ningún estudio fija un número exacto de series: el corte de ${HIGH_SESSION_SETS} es una aproximación prudente.`,
  `La referencia semanal (${WEEKLY_RANGE.low}–${WEEKLY_RANGE.high} series por músculo) viene de una revisión en personas entrenadas; es contexto, no un objetivo.`,
]

export const SOURCES: readonly { cite: string; doi: string }[] = [
  { cite: 'MacDougall et al. 1995, Can J Appl Physiol', doi: '10.1139/h95-038' },
  { cite: 'Phillips et al. 1997, Am J Physiol', doi: '10.1152/ajpendo.1997.273.1.E99' },
  { cite: 'Morán-Navarro et al. 2017, Eur J Appl Physiol', doi: '10.1007/s00421-017-3725-7' },
  { cite: 'Bartolomei et al. 2017, Eur J Appl Physiol', doi: '10.1007/s00421-017-3598-9' },
  { cite: 'Ferreira et al. 2017, Physiol Behav', doi: '10.1016/j.physbeh.2017.06.001' },
  { cite: 'Schoenfeld, Ogborn y Krieger 2016, Sports Med', doi: '10.1007/s40279-016-0543-8' },
  { cite: 'Baz-Valle et al. 2022, J Hum Kinet', doi: '10.2478/hukin-2022-0017' },
]
