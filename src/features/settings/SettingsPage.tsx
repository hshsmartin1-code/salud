import { formatDistanceToNow } from 'date-fns'
import { es } from 'date-fns/locale'
import { useEffect, useState, type ReactNode, lazy, Suspense } from 'react'
import { useTheme, type ThemePref } from '../../app/theme'
import { APP_VERSION } from '../../appVersion'
import { loadManifest, type ManifestFile } from '../nutrition/catalog'
import { loadExerciseCatalog } from '../training/exercises'
import { REPDB_ATTRIBUTION, REPDB_URL, useExerciseMedia } from '../training/exerciseMedia'
import { BODYPARTS3D_ATTRIBUTION, BODYPARTS3D_URL } from '../training/figureCredit'
import { formatNumber } from '../../domain/units'
import { Icon, type IconName } from '../../ui/Icon'
import { PageHeader, Segmented } from '../../ui/kit'
import { Disclosure } from '../../ui/Disclosure'
import { Row } from '../../ui/Row'
import { useLiveQuery } from 'dexie-react-hooks'
import { useProfiles } from '../../app/profile'
import { db } from '../../db/schema'
import { SYNC_CONFIG } from '../../sync/config'
import { STORAGE_NOTE_LONG } from '../../sync/copy'
import { mealTimesSummary } from '../nutrition/mealSlots'
import { useMealSlots } from '../nutrition/useMealSlots'
const PrivatePackImporter = lazy(() => import('../training/media/PrivatePackImporter').then((m) => ({ default: m.PrivatePackImporter })))

function Source({ title, children, href }: { title: string; children: ReactNode; href?: string }) {
  return (
    <li className="px-4 py-3">
      <div className="flex items-center gap-2 text-sm font-semibold">
        {title}
        {href ? (
          <a href={href} target="_blank" rel="noreferrer noopener" className="hit-44 inline-flex items-center justify-center text-accent" aria-label={`Abrir ${title}`}>
            <Icon name="link" size={14} />
          </a>
        ) : null}
      </div>
      <div className="mt-0.5 text-xs leading-relaxed text-muted">{children}</div>
    </li>
  )
}

/** Set to true when the route /ajustes/actualizaciones exists in App.tsx (added by the updates engineer). */
const HAS_UPDATES_ROUTE = true

const PRIVACY_SUMMARY_LOCAL = 'Tus datos de salud se guardan solo en este dispositivo. La app no usa cuentas ni sube nada a la nube.'
const PRIVACY_SUMMARY_SYNC = 'Tus datos se guardan primero en este dispositivo. Solo si vinculas una cuenta de Google se copian a la nube, bajo esa cuenta.'

/** Same look as a Row title, for the rows that fold content (icon + medium title). */
function RowTitle({ icon, text }: { icon: IconName; text: string }) {
  return (
    <span className="flex items-center gap-3 text-body font-medium text-ink">
      <span className="text-muted"><Icon name={icon} size={20} /></span>
      {text}
    </span>
  )
}

/** One line: the state of the account, never the machinery. */
function AccountRow() {
  const { active } = useProfiles()
  const link = useLiveQuery(() => (active ? db.syncLinks.get(active.id) : undefined), [active?.id])
  const conflicts = useLiveQuery(() => (active ? db.syncConflicts.where('profileId').equals(active.id).count() : 0), [active?.id]) ?? 0
  if (!active) return null
  const subtitle = !SYNC_CONFIG
    ? 'Sin cuenta · esta versión no tiene sincronización'
    : link
      ? `${link.email ?? 'Cuenta de Google'} · ${conflicts ? `${conflicts} por revisar` : link.lastSyncAt ? `sincronizado ${formatDistanceToNow(new Date(link.lastSyncAt), { addSuffix: true, locale: es })}` : 'pendiente de sincronizar'}`
      : 'Sin cuenta · tus datos están en este dispositivo'
  return (
    <div data-row="cuenta">
      <Row leading={<Icon name="user" size={20} />} title="Cuenta y sincronización" subtitle={subtitle} to="/cuenta" />
    </div>
  )
}

/** Preferences row: the meals the diary offers, in one line. */
function MealTimesRow() {
  const { slots } = useMealSlots()
  return (
    <div data-row="tiempos">
      <Row leading={<Icon name="utensils" size={20} />} title="Tiempos de comida" subtitle={mealTimesSummary(slots)} to="/ajustes/tiempos-de-comida" />
    </div>
  )
}

export function SettingsPage() {
  const [theme, setTheme] = useTheme()
  const [files, setFiles] = useState<ManifestFile[] | null>(null)
  const [exCount, setExCount] = useState<number | null>(null)
  const media = useExerciseMedia()
  const mediaPack = media?.index?.pack
  const repdbPack = mediaPack?.id === 'repdb-free'
  const mediaCount = media ? Object.keys(media.items).length : null
  useEffect(() => {
    void loadManifest()
      .then((m) => setFiles(m))
      .catch(() => setFiles([]))
    void loadExerciseCatalog()
      .then((c) => setExCount(c.list.length))
      .catch(() => setExCount(null))
  }, [])
  const count = (needle: string) => files?.find((f) => f.path.includes(needle))?.count
  return (
    <>
      <PageHeader title="Ajustes" back="/mas" />
      <div className="space-y-5">
        <div className="tile divide-rows" data-testid="settings-list">
          <AccountRow />
          <div data-row="perfil">
            <Row leading={<Icon name="target" size={20} />} title="Perfil y objetivos" subtitle="Tus datos y tus cifras diarias" to="/perfil" />
          </div>
          <div data-row="preferencias">
            <Disclosure summary={<RowTitle icon="sliders" text="Preferencias" />} tone="section" testId="settings-prefs">
              <div className="space-y-3 pb-2">
                <div>
                  <span className="label">Tema</span>
                  <Segmented<ThemePref>
                    value={theme}
                    onChange={setTheme}
                    ariaLabel="Tema"
                    options={[
                      { value: 'system', label: 'Sistema' },
                      { value: 'light', label: 'Claro' },
                      { value: 'dark', label: 'Oscuro' },
                    ]}
                  />
                </div>
                <p className="text-label text-muted">
                  Entrenamiento: el temporizador de descanso, los avisos y la pantalla encendida se ajustan dentro de una sesión, en «Opciones ▸ Ajustes del entreno».
                </p>
              </div>
            </Disclosure>
          </div>
          <MealTimesRow />
          {/* Actualizaciones: route /ajustes/actualizaciones lives in App.tsx. */}
          {HAS_UPDATES_ROUTE ? (
            <div data-row="actualizaciones">
              <Row leading={<Icon name="download" size={20} />} title="Actualizaciones" to="/ajustes/actualizaciones" />
            </div>
          ) : null}
          <div data-row="privacidad" className="py-3">
            <RowTitle icon="shield" text="Privacidad" />
            <p className="mt-1 pl-8 text-label text-muted">{SYNC_CONFIG ? PRIVACY_SUMMARY_SYNC : PRIVACY_SUMMARY_LOCAL}</p>
            <Disclosure summary="Cómo se guardan tus datos" testId="privacy-detail" className="pl-8">
              <p className="text-label leading-relaxed text-muted">{STORAGE_NOTE_LONG}</p>
            </Disclosure>
          </div>
          <div data-row="datos">
            <Row leading={<Icon name="database" size={20} />} title="Datos y respaldos" subtitle="Exportar, importar y restaurar" to="/respaldo" />
          </div>
          <div data-row="avanzado">

        <Disclosure summary={<RowTitle icon="layers" text="Avanzado" />} tone="section" testId="settings-advanced">
          <div className="space-y-5 pt-2">
          <section>
            <h2 className="section-title mb-2">Fuentes de datos y licencias</h2>
          <a href={`${import.meta.env.BASE_URL}THIRD_PARTY_NOTICES.txt`} target="_blank" rel="noreferrer noopener" className="btn-secondary mb-3 w-full">
            Licencias y avisos de terceros
          </a>
          <ul className="card divide-y divide-line overflow-hidden">
            <Source title="USDA FoodData Central" href="https://fdc.nal.usda.gov/">
              U.S. Department of Agriculture, Agricultural Research Service. FoodData Central (Foundation Foods, SR Legacy, FNDDS). Dominio público (CC0 1.0).
              {count('usda') ? ` ${formatNumber(count('usda')!, 0)} alimentos incluidos.` : ''} Nombres en español curados para los alimentos más comunes; el
              resto se muestra con su nombre original en inglés.
            </Source>
            <Source title="Open Food Facts" href="https://world.openfoodfacts.org/">
              Datos de productos © colaboradores de Open Food Facts, disponibles bajo la Open Database License (ODbL 1.0); los contenidos individuales, bajo la
              Database Contents License (DbCL 1.0). Se incluye una instantánea parcial de productos de Colombia
              {count('off') ? ` (${formatNumber(count('off')!, 0)} productos)` : ''} y se consultan otros bajo demanda. Si redistribuyes esta base derivada, debe
              hacerse bajo la misma licencia ODbL. Las fotos de los colaboradores se muestran bajo CC BY-SA 3.0, con enlace a la ficha. Los datos pueden contener errores: verifica con la etiqueta.
            </Source>
            <Source title="Tabla de Composición de Alimentos Colombianos (ICBF, 2015)" href="https://www.icbf.gov.co/">
              Instituto Colombiano de Bienestar Familiar. No se distribuye con la app: cada persona la genera localmente desde el PDF oficial y la carga en su
              dispositivo para uso personal.
            </Source>
            <Source title="Ejercicios: open-exercise-db y free-exercise-db" href="https://github.com/yuhonas/free-exercise-db">
              {exCount ? `${formatNumber(exCount, 0)} ejercicios. ` : ''}Datos en español de open-exercise-db (CC0 1.0; código MIT, © 2026 cwlumm), basados en
              free-exercise-db (Unlicense, dominio público).
            </Source>
            <li className="px-4 py-3" data-testid="repdb-credit">
              <div className="text-sm font-medium">
                {mediaPack?.attributionUrl || repdbPack ? (
                  <a href={mediaPack?.attributionUrl ?? REPDB_URL} target="_blank" rel="noopener nofollow" className="inline-flex min-h-[44px] items-center underline underline-offset-2">
                    {mediaPack?.attribution ?? REPDB_ATTRIBUTION}
                  </a>
                ) : <span>{mediaPack?.attribution ?? 'Medios de ejercicios'}</span>}
              </div>
              <p className="mt-0.5 text-xs text-muted">
                Ilustraciones de ejercicios{mediaCount !== null ? ` (${formatNumber(mediaCount, 0)} ejercicios con imagen)` : ''}.
                {repdbPack ? ' RepDB Free Tier v1.0: uso dentro de la app con atribución visible; no se redistribuyen como conjunto de datos.' : null}
                {' '}Solo se muestran los medios del pack activo con licencia válida; el resto aparece sin imagen.
              </p>
            </li>
            <Source title="Figura anatómica: BodyParts3D" href={BODYPARTS3D_URL}>
              <span data-testid="bodyparts3d-credit">{BODYPARTS3D_ATTRIBUTION}.</span> Selección de músculos, render en Blender y trazado vectorial
              propios; las regiones del dorsal ancho y del recto abdominal se aproximan desde la superficie corporal porque el conjunto no las incluye.
            </Source>
            <Source title="Reconocimiento de texto (OCR): Tesseract.js" href="https://github.com/naptha/tesseract.js">
              El código de Tesseract.js (Apache 2.0) está en la app, pero el reconocimiento de texto en fotos de etiquetas está desactivado y sus archivos
              (motor y modelo de español «best_int» de tessdata, Apache 2.0) no se incluyen. Las etiquetas se registran escribiendo los valores a mano.
            </Source>
            <Source title="Tipografía: Archivo" href="https://github.com/Omnibus-Type/Archivo">
              Copyright 2020 The Archivo Project Authors. SIL Open Font License 1.1, incluida en la app mediante @fontsource-variable/archivo.
            </Source>
          </ul>
        </section>

          <section className="space-y-2">
          <h2 className="font-semibold">Cómo se calcula</h2>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
            <li>Gasto energético total estimado: metabolismo en reposo (Mifflin-St Jeor, predeterminada) × factor de actividad, o Schofield × PAL con el método RIEN Colombia (Res. 3803/2016); el método y los valores usados se muestran en cada objetivo y puedes ajustarlos a mano.</li>
            <li>Nutrientes: los valores desconocidos se muestran como «—» y nunca se cuentan como cero; los totales con datos faltantes se marcan como parciales (*).</li>
            <li>Composición corporal: Jackson & Pollock (7 y 3 pliegues) y Durnin & Womersley con la ecuación de Siri; los protocolos ISAK solo muestran la suma de pliegues. Todo valor calculado se marca como estimado.</li>
            <li>Fuerza: 1RM estimado con la fórmula de Epley solo en series de 1 a 10 repeticiones (Reynolds y cols., 2006) y nunca en ejercicios de peso corporal; volumen = peso × repeticiones de las series hechas, sin calentamientos (en peso corporal, solo el lastre añadido).</li>
            <li>Las kcal de pulseras y relojes son informativas y no se suman al objetivo salvo que lo actives en tu perfil.</li>
          </ul>
          <a href={`${import.meta.env.BASE_URL}METODOLOGIA.txt`} target="_blank" rel="noreferrer noopener" className="btn-secondary w-full" data-testid="methodology-link">
            Metodología completa: fórmulas, supuestos y fuentes
          </a>
          <p className="text-xs text-faint">Esta app es una herramienta de registro personal; no es un dispositivo médico ni sustituye la orientación de un profesional de la salud.</p>
          </section>
          <section data-testid="settings-private-media">
            <h2 className="section-title mb-2">Paquete de medios privado</h2>
            <Suspense fallback={null}><PrivatePackImporter /></Suspense>
          </section>
          <p className="text-center text-xs text-faint" data-testid="app-version">Salud · versión {APP_VERSION}</p>
          </div>
        </Disclosure>
          </div>
        </div>
      </div>
    </>
  )
}
