import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useTheme, type ThemePref } from '../../app/theme'
import { APP_VERSION } from '../../db/backup'
import { loadManifest, type ManifestFile } from '../nutrition/catalog'
import { loadExerciseCatalog } from '../training/exercises'
import { REPDB_ATTRIBUTION, REPDB_URL, useExerciseMedia } from '../training/exerciseMedia'
import { formatNumber } from '../../domain/units'
import { Icon } from '../../ui/Icon'
import { Card, PageHeader, Segmented } from '../../ui/kit'

function Source({ title, children, href }: { title: string; children: ReactNode; href?: string }) {
  return (
    <li className="px-4 py-3">
      <div className="flex items-center gap-2 text-sm font-semibold">
        {title}
        {href ? (
          <a href={href} target="_blank" rel="noreferrer noopener" className="text-accent" aria-label={`Abrir ${title}`}>
            <Icon name="link" size={14} />
          </a>
        ) : null}
      </div>
      <div className="mt-0.5 text-xs leading-relaxed text-muted">{children}</div>
    </li>
  )
}

export function SettingsPage() {
  const [theme, setTheme] = useTheme()
  const [files, setFiles] = useState<ManifestFile[] | null>(null)
  const [exCount, setExCount] = useState<number | null>(null)
  const media = useExerciseMedia()
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
      <PageHeader title="Ajustes y fuentes" back="/mas" />
      <div className="space-y-5">
        <Card className="space-y-3">
          <h2 className="font-semibold">Apariencia</h2>
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
        </Card>

        <Card className="space-y-2">
          <h2 className="font-semibold">Privacidad y datos</h2>
          <p className="text-sm text-muted">
            Todo se guarda en este dispositivo (IndexedDB del navegador). No hay cuentas, nube ni sincronización entre dispositivos, y cada perfil tiene sus datos
            separados. La app solo se conecta a internet para descargarse y, cuando tú lo pides, para consultar un código de barras o un producto en Open Food
            Facts (se envía únicamente el código o el texto buscado).
          </p>
          <Link to="/respaldo" className="btn-secondary w-full">
            <Icon name="database" size={18} /> Respaldo e importación
          </Link>
        </Card>

        <section>
          <h2 className="section-title mb-2">Fuentes de datos y licencias</h2>
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
              hacerse bajo la misma licencia ODbL. Los datos pueden contener errores: verifica con la etiqueta.
            </Source>
            <Source title="Tabla de Composición de Alimentos Colombianos (ICBF, 2015)" href="https://www.icbf.gov.co/">
              Instituto Colombiano de Bienestar Familiar. No se distribuye con la app: cada persona la genera localmente desde el PDF oficial y la carga en su
              dispositivo para uso personal.
            </Source>
            <Source title="Ejercicios: open-exercise-db y free-exercise-db" href="https://github.com/yuhonas/free-exercise-db">
              {exCount ? `${formatNumber(exCount, 0)} ejercicios. ` : ''}Traducción al español de open-exercise-db (licencia MIT, © 2026 cwlumm) basada en
              free-exercise-db (Unlicense, dominio público).
            </Source>
            <li className="px-4 py-3" data-testid="repdb-credit">
              <div className="text-sm font-medium">
                <a href={REPDB_URL} target="_blank" rel="noopener nofollow" className="underline underline-offset-2">
                  {REPDB_ATTRIBUTION}
                </a>
              </div>
              <p className="mt-0.5 text-xs text-muted">
                Ilustraciones de ejercicios{mediaCount ? ` (${formatNumber(mediaCount, 0)} ejercicios con imagen)` : ''} de RepDB, licencia Free Tier v1.0: uso
                dentro de la app con atribución visible; no se redistribuyen como conjunto de datos. Solo se muestran donde la correspondencia con el ejercicio
                es segura; el resto aparece sin imagen.
              </p>
            </li>
            <Source title="Reconocimiento de texto (OCR): Tesseract.js" href="https://github.com/naptha/tesseract.js">
              Tesseract.js y tesseract.js-core (Apache 2.0) con el modelo de español «best_int» de tessdata (Apache 2.0), incluidos en la app. Las fotos de
              etiquetas se procesan solo en este dispositivo.
            </Source>
          </ul>
        </section>

        <Card className="space-y-2">
          <h2 className="font-semibold">Cómo se calcula</h2>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
            <li>Gasto basal: ecuación de Mifflin-St Jeor × factor de actividad; el método y los valores usados se muestran en cada objetivo y puedes ajustarlos a mano.</li>
            <li>Nutrientes: los valores desconocidos se muestran como «—» y nunca se cuentan como cero; los totales con datos faltantes se marcan como parciales (*).</li>
            <li>Composición corporal: Jackson & Pollock (7 y 3 pliegues) y Durnin & Womersley con la ecuación de Siri; los protocolos ISAK solo muestran la suma de pliegues. Todo valor calculado se marca como estimado.</li>
            <li>Fuerza: 1RM estimado con la fórmula de Epley (series de 1 a 15 repeticiones); volumen = peso × repeticiones de las series hechas, sin calentamientos.</li>
            <li>Las kcal de pulseras y relojes son informativas y no se suman al objetivo salvo que lo actives en tu perfil.</li>
          </ul>
          <p className="text-xs text-faint">Esta app es una herramienta de registro personal; no es un dispositivo médico ni sustituye la orientación de un profesional de la salud.</p>
        </Card>

        <p className="pb-4 text-center text-xs text-faint">Salud · versión {APP_VERSION}</p>
      </div>
    </>
  )
}
