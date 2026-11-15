import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useRepo } from '../../app/profile'
import { refFoods } from '../../db/shared'
import type { RefFood } from '../../db/types'
import { searchIndex } from '../../domain/search'
import { formatNutrient } from '../../domain/nutrients'
import { Icon } from '../../ui/Icon'
import { Badge, EmptyState } from '../../ui/kit'
import { BarcodeScanner, barcodeScanSupported } from './BarcodeScanner'
import { fromRefFood, KIND_LABEL, SOURCE_SHORT, type Food } from './food'
import { fetchOffBarcode, searchOff } from './off'
import { useFoods } from './useFoods'

type SourceFilter = 'all' | 'icbf' | 'usda' | 'off' | 'mine'
type KindFilter = 'all' | 'raw' | 'cooked' | 'prepared'
type Tab = 'recent' | 'fav' | 'mine'

const SRC_FILTERS: { v: SourceFilter; l: string }[] = [
  { v: 'all', l: 'Todas' },
  { v: 'icbf', l: 'ICBF' },
  { v: 'usda', l: 'USDA' },
  { v: 'off', l: 'Empacados' },
  { v: 'mine', l: 'Míos' },
]
const KIND_FILTERS: { v: KindFilter; l: string }[] = [
  { v: 'all', l: 'Todo' },
  { v: 'raw', l: 'Crudo' },
  { v: 'cooked', l: 'Cocido' },
  { v: 'prepared', l: 'Preparado' },
]

function matchSource(f: Food, s: SourceFilter) {
  switch (s) {
    case 'icbf':
      return f.source === 'icbf_tcac2015'
    case 'usda':
      return f.source.startsWith('usda_')
    case 'off':
      return f.source === 'off'
    case 'mine':
      return f.source === 'user' || f.source === 'label' || f.source === 'recipe'
    default:
      return true
  }
}

export function FoodSearch({ onSelect, autoScan = false }: { onSelect: (f: Food) => void; autoScan?: boolean }) {
  const r = useRepo()
  const foods = useFoods()
  const [q, setQ] = useState('')
  const dq = useDeferredValue(q)
  const [src, setSrc] = useState<SourceFilter>('all')
  const [kind, setKind] = useState<KindFilter>('all')
  const [tab, setTab] = useState<Tab>('recent')
  const [scan, setScan] = useState(autoScan && barcodeScanSupported())
  const [barcodeMode, setBarcodeMode] = useState(autoScan)
  const [code, setCode] = useState('')
  const [online, setOnline] = useState<{ busy: boolean; error: string | null; results: RefFood[] | null; note?: string }>({
    busy: false,
    error: null,
    results: null,
  })

  const recents = useLiveQuery(() => r.all('recents'), [r])
  const favs = useLiveQuery(() => r.all('favorites'), [r])

  const results = useMemo(() => {
    if (!dq.trim()) return []
    const filter = src === 'all' && kind === 'all' ? undefined : (f: Food) => matchSource(f, src) && (kind === 'all' || f.kind === kind)
    return searchIndex(foods.index, dq, { limit: 60, filter })
  }, [dq, src, kind, foods.index])

  useEffect(() => setOnline({ busy: false, error: null, results: null }), [dq])

  const lookupCode = useCallback(
    async (raw: string, allowOnline: boolean) => {
      const c = raw.replace(/\D/g, '')
      if (c.length < 6) {
        setOnline({ busy: false, error: 'Código demasiado corto', results: null })
        return
      }
      const local = foods.byBarcode(c) ?? (await refFoods.byBarcode(c).then((x) => (x ? fromRefFood(x) : undefined)))
      if (local) {
        onSelect(local)
        return
      }
      if (!allowOnline) {
        setOnline({ busy: false, error: null, results: null, note: `El código ${c} no está en el catálogo local.` })
        return
      }
      setOnline({ busy: true, error: null, results: null })
      try {
        const res = await fetchOffBarcode(c)
        if ('error' in res) setOnline({ busy: false, error: res.error, results: null })
        else {
          await refFoods.put(res.food)
          setOnline({ busy: false, error: null, results: null })
          onSelect(fromRefFood(res.food))
        }
      } catch {
        setOnline({ busy: false, error: 'No se pudo conectar con Open Food Facts.', results: null })
      }
    },
    [foods, onSelect],
  )

  async function onlineSearch() {
    setOnline({ busy: true, error: null, results: null })
    try {
      const res = await searchOff(dq.trim())
      if ('error' in res) setOnline({ busy: false, error: res.error, results: null })
      else setOnline({ busy: false, error: null, results: res.foods, note: res.skipped ? `${res.skipped} productos sin datos de energía omitidos.` : undefined })
    } catch {
      setOnline({ busy: false, error: 'No se pudo conectar con Open Food Facts.', results: null })
    }
  }

  async function pickOnline(f: RefFood) {
    await refFoods.put(f)
    onSelect(fromRefFood(f))
  }

  const listFor = (refs: { foodRef: string; name: string }[]) =>
    refs.map((x) => foods.resolve(x.foodRef)).filter((f): f is Food => !!f)

  const recentFoods = useMemo(
    () => listFor((recents ?? []).slice().sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt)).slice(0, 30)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [recents, foods.resolve],
  )
  const favFoods = useMemo(() => listFor((favs ?? []).slice().sort((a, b) => a.name.localeCompare(b.name))), [favs, foods.resolve]) // eslint-disable-line
  const mineFoods = useMemo(
    () => [...foods.customs.map((c) => foods.resolve(`custom:${c.id}`)), ...foods.recipes.map((x) => foods.resolve(`recipe:${x.id}`))].filter((f): f is Food => !!f),
    [foods],
  )

  return (
    <div>
      <div className="sticky top-14 z-20 -mx-4 bg-bg/95 px-4 pb-2 pt-1 backdrop-blur lg:top-0">
        <div className="flex gap-2">
          {barcodeMode ? (
            <form
              className="flex flex-1 gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                void lookupCode(code, false)
              }}
            >
              <input
                className="field num flex-1"
                inputMode="numeric"
                placeholder="Código de barras"
                value={code}
                autoFocus
                onChange={(e) => setCode(e.target.value)}
                aria-label="Código de barras"
              />
              <button className="btn-primary px-3" type="submit" disabled={!code.trim()}>
                Buscar
              </button>
            </form>
          ) : (
            <div className="relative flex-1">
              <Icon name="search" size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
              <input
                type="search"
                className="field pl-10"
                placeholder="Buscar alimento (p. ej. arroz cocido)"
                value={q}
                autoFocus
                onChange={(e) => setQ(e.target.value)}
                aria-label="Buscar alimento"
                data-testid="food-search"
              />
            </div>
          )}
          <button
            type="button"
            className={`btn-secondary px-3 ${barcodeMode ? 'border-accent text-accent' : ''}`}
            aria-label="Código de barras"
            onClick={() => setBarcodeMode((v) => !v)}
          >
            <Icon name="barcode" />
          </button>
          {barcodeMode && barcodeScanSupported() ? (
            <button type="button" className="btn-secondary px-3" aria-label="Escanear con la cámara" onClick={() => setScan(true)}>
              <Icon name="camera" />
            </button>
          ) : null}
        </div>
        {!barcodeMode ? (
          <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1">
            {SRC_FILTERS.map((f) => (
              <button key={f.v} type="button" onClick={() => setSrc(f.v)} className={`chip shrink-0 ${src === f.v ? 'chip-on' : ''}`}>
                {f.l}
              </button>
            ))}
            <span className="mx-1 w-px shrink-0 bg-line" />
            {KIND_FILTERS.map((f) => (
              <button key={f.v} type="button" onClick={() => setKind(f.v)} className={`chip shrink-0 ${kind === f.v ? 'chip-on' : ''}`}>
                {f.l}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {foods.catalogError ? <p className="my-3 rounded-xl bg-bad/10 p-3 text-sm text-bad">{foods.catalogError}</p> : null}
      {!foods.ready && !foods.catalogError ? <p className="my-3 text-sm text-muted">Cargando catálogo de alimentos…</p> : null}

      {barcodeMode ? (
        <div className="mt-3 space-y-3">
          {online.note ? (
            <div className="card p-4 text-sm">
              <p>{online.note}</p>
              <p className="mt-1 text-xs text-muted">Puedes consultarlo en Open Food Facts (requiere internet; se envía solo el código).</p>
              <div className="mt-3 flex gap-2">
                <button className="btn-primary" onClick={() => void lookupCode(code, true)} disabled={online.busy}>
                  <Icon name="link" size={16} /> Consultar en línea
                </button>
                <Link className="btn-secondary" to={`/comida/etiqueta?barcode=${encodeURIComponent(code.replace(/\D/g, ''))}`}>
                  <Icon name="tag" size={16} /> Desde la etiqueta
                </Link>
              </div>
            </div>
          ) : null}
          {online.busy ? <p className="text-sm text-muted">Consultando Open Food Facts…</p> : null}
          {online.error ? (
            <div className="rounded-xl bg-warn/10 p-3 text-sm text-warn">
              {online.error}{' '}
              <Link className="font-semibold underline" to={`/comida/etiqueta?barcode=${encodeURIComponent(code.replace(/\D/g, ''))}`}>
                Registrar desde la etiqueta
              </Link>
            </div>
          ) : null}
        </div>
      ) : dq.trim() ? (
        <>
          <ResultList foods={results} onSelect={onSelect} />
          {results.length === 0 && foods.ready ? (
            <EmptyState icon="search" title="Sin resultados locales">
              Prueba otro término, quita filtros o crea el alimento desde su etiqueta.
            </EmptyState>
          ) : null}
          <div className="mt-4 space-y-2">
            {online.results ? (
              <>
                <h3 className="section-title">Open Food Facts (en línea)</h3>
                {online.results.length ? (
                  <ResultList foods={online.results.map(fromRefFood)} onSelect={(f) => void pickOnline(online.results!.find((x) => x.id === f.ref)!)} />
                ) : (
                  <p className="text-sm text-muted">Sin resultados con datos de energía.</p>
                )}
                {online.note ? <p className="text-xs text-faint">{online.note}</p> : null}
              </>
            ) : (
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-secondary" onClick={() => void onlineSearch()} disabled={online.busy}>
                  <Icon name="link" size={16} /> {online.busy ? 'Buscando…' : 'Buscar en Open Food Facts'}
                </button>
                <Link className="btn-ghost" to="/comida/etiqueta">
                  <Icon name="tag" size={16} /> Crear desde etiqueta
                </Link>
              </div>
            )}
            {online.error ? <p className="text-sm text-warn">{online.error}</p> : null}
            <p className="text-[11px] text-faint">La búsqueda en línea envía solo el texto escrito a Open Food Facts.</p>
          </div>
        </>
      ) : (
        <div className="mt-2">
          <div className="mb-2 flex gap-1.5">
            {(
              [
                ['recent', 'Recientes'],
                ['fav', 'Favoritos'],
                ['mine', 'Míos y recetas'],
              ] as [Tab, string][]
            ).map(([v, l]) => (
              <button key={v} type="button" onClick={() => setTab(v)} className={`chip ${tab === v ? 'chip-on' : ''}`}>
                {l}
              </button>
            ))}
          </div>
          {tab === 'recent' ? (
            recentFoods.length ? (
              <ResultList foods={recentFoods} onSelect={onSelect} />
            ) : (
              <EmptyState icon="clock" title="Aún no hay recientes">
                Busca un alimento por nombre o escanea un código.
              </EmptyState>
            )
          ) : tab === 'fav' ? (
            favFoods.length ? (
              <ResultList foods={favFoods} onSelect={onSelect} />
            ) : (
              <EmptyState icon="star" title="Sin favoritos">
                Marca la estrella al registrar un alimento.
              </EmptyState>
            )
          ) : mineFoods.length ? (
            <ResultList foods={mineFoods} onSelect={onSelect} />
          ) : (
            <EmptyState icon="tag" title="Sin alimentos propios" action={<Link className="btn-primary" to="/comida/etiqueta">Crear desde etiqueta</Link>}>
              Los alimentos creados desde etiquetas y tus recetas aparecen aquí.
            </EmptyState>
          )}
        </div>
      )}

      <BarcodeScanner
        open={scan}
        onClose={() => setScan(false)}
        onCode={(c) => {
          setScan(false)
          setBarcodeMode(true)
          setCode(c)
          void lookupCode(c, false)
        }}
      />
    </div>
  )
}

export function ResultList({ foods, onSelect }: { foods: Food[]; onSelect: (f: Food) => void }) {
  if (!foods.length) return null
  return (
    <ul className="card mt-2 divide-y divide-line overflow-hidden" data-testid="food-results">
      {foods.map((f) => (
        <li key={f.ref}>
          <button type="button" onClick={() => onSelect(f)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-surface2/60">
            <span className="min-w-0 flex-1">
              <span className="line-clamp-2 text-[15px] font-medium leading-snug">{f.name}</span>
              <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                <Badge tone={f.source === 'icbf_tcac2015' || f.curated ? 'accent' : 'muted'}>{SOURCE_SHORT[f.source]}</Badge>
                {f.kind !== 'generic' && f.kind !== 'packaged' ? <span>{KIND_LABEL[f.kind]}</span> : null}
                {f.brand ? <span className="truncate">{f.brand}</span> : null}
                {f.englishOnly ? <span className="text-faint">· nombre en inglés</span> : null}
              </span>
            </span>
            <span className="num shrink-0 text-right text-sm font-semibold">
              {formatNutrient('kcal', f.nutrients.kcal, false)}
              <span className="block text-[10px] font-normal text-faint">kcal/{f.basis === 'serving' ? 'porción' : f.basis === '100ml' ? '100 ml' : '100 g'}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}
