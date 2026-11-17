import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useRepo } from '../../app/profile'
import { refFoods } from '../../db/shared'
import type { FoodLog, MealKey, RefFood } from '../../db/types'
import { searchIndex } from '../../domain/search'
import { Icon } from '../../ui/Icon'
import { EmptyState, Segmented, Sheet } from '../../ui/kit'
import { BarcodeScanner, barcodeScanSupported } from './BarcodeScanner'
import { describeQty, fromRefFood, type Food } from './food'
import { dedupeByRef, orderQueryResults, type FoodUsage } from './foodList'
import { FoodGlyph } from './FoodGlyph'
import { habitualFor } from './habitual'
import { fetchOffBarcode, searchOff } from './off'
import { lastLogByFood, suggestForMeal } from './suggestions'
import { useDesktop } from './useDesktop'
import { useFoods } from './useFoods'
import { useMealSlots } from './useMealSlots'

type SourceFilter = 'all' | 'icbf' | 'usda' | 'off' | 'mine'
type KindFilter = 'all' | 'raw' | 'cooked' | 'prepared'
type Tab = 'recent' | 'freq' | 'fav' | 'mine'

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

/** What the search needs to offer one-tap adds into one meal of one day. */
export interface QuickAddContext {
  meal: MealKey
  date: string
  /** The profile's recent food logs (previous quantities and frequent foods are read from them). */
  logs: readonly FoodLog[]
  /** Foods already logged in this meal on this date (marked with a check). */
  inDiary: ReadonlySet<string>
  /** Copies this log into the meal and date; the caller owns the undo toast and the counter. */
  onQuickAdd: (log: FoodLog, food: Food) => void
}

export function FoodSearch({
  onSelect,
  autoScan = false,
  stickyTop,
  quick,
  ideas,
  clearSignal = 0,
  selectedRef,
  filtersExtra,
  inSheet = false,
}: {
  onSelect: (f: Food) => void
  autoScan?: boolean
  /** Rendered first inside the sticky header. */
  stickyTop?: ReactNode
  quick?: QuickAddContext
  /** Shown first in the "Frecuentes" tab (ideas for what is left of the day). */
  ideas?: ReactNode
  /** Each change clears the query and focuses the field again (continuous logging). */
  clearSignal?: number
  /** Desktop: the food open in the side editor; its row is marked. */
  selectedRef?: string
  /** Extra controls of the "Filtros" sheet (e.g. "Seguir agregando alimentos"). */
  filtersExtra?: ReactNode
  /** Inside a sheet (no top bar above): the search field sticks to the top of the sheet. */
  inSheet?: boolean
}) {
  const r = useRepo()
  const mealLower = useMealSlots().lower
  const foods = useFoods()
  const [q, setQ] = useState('')
  const dq = useDeferredValue(q)
  const inputRef = useRef<HTMLInputElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const desktop = useDesktop()
  const [src, setSrc] = useState<SourceFilter>('all')
  const [kind, setKind] = useState<KindFilter>('all')
  const [filters, setFilters] = useState(false)
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
  const filterActive = src !== 'all' || kind !== 'all'

  // Touch devices (Android) start in the field so the keyboard is ready. With a fine pointer the browser keeps
  // the natural Tab order: the sequential-focus starting point would otherwise skip the controls above the field.
  useEffect(() => {
    if (!autoScan && window.matchMedia('(pointer: coarse)').matches) inputRef.current?.focus()
  }, [autoScan])
  useEffect(() => {
    if (!clearSignal) return
    setQ('')
    setBarcodeMode(false)
    inputRef.current?.focus()
  }, [clearSignal])

  const results = useMemo(() => {
    if (!dq.trim()) return []
    const filter = src === 'all' && kind === 'all' ? undefined : (f: Food) => matchSource(f, src) && (kind === 'all' || f.kind === kind)
    return dedupeByRef(searchIndex(foods.index, dq, { limit: 60, filter }), foods.resolve)
  }, [dq, src, kind, foods.index, foods.resolve])

  useEffect(() => setOnline({ busy: false, error: null, results: null }), [dq])

  // Typed-query order: own foods first, Spanish matches next, English-only names folded at the end.
  const usage = useMemo(() => new Map<string, FoodUsage>((recents ?? []).map((x) => [x.foodRef, { count: x.count, lastUsedAt: x.lastUsedAt }])), [recents])
  const ordered = useMemo(() => orderQueryResults(results, dq, usage), [results, dq, usage])
  const [englishFor, setEnglishFor] = useState<string | null>(null)
  const showEnglish = englishFor === dq

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

  const resolveAll = useCallback(
    (refs: { foodRef: string }[]) => refs.map((x) => foods.resolve(x.foodRef)).filter((f): f is Food => !!f),
    [foods.resolve],
  )

  const lastLogs = useMemo(() => (quick ? lastLogByFood(quick.logs, quick.meal) : null), [quick])
  const frequentFoods = useMemo(() => {
    if (!quick) return []
    return resolveAll(suggestForMeal(quick.logs, quick.meal, quick.date, { cap: 12, excludeLogged: false }))
  }, [quick, resolveAll])
  const recentFoods = useMemo(
    () => resolveAll((recents ?? []).slice().sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt)).slice(0, 30)),
    [recents, resolveAll],
  )
  const favFoods = useMemo(() => resolveAll((favs ?? []).slice().sort((a, b) => a.name.localeCompare(b.name))), [favs, resolveAll])
  const mineFoods = useMemo(
    () => [...foods.customs.map((c) => foods.resolve(`custom:${c.id}`)), ...foods.recipes.map((x) => foods.resolve(`recipe:${x.id}`))].filter((f): f is Food => !!f),
    [foods],
  )

  const rowProps = { onSelect, quick, lastLogs, selectedRef }
  const tabs = useMemo(
    () => [
      { value: 'recent' as Tab, label: 'Recientes' },
      ...(quick ? [{ value: 'freq' as Tab, label: 'Frecuentes' }] : []),
      { value: 'fav' as Tab, label: 'Favoritos' },
      { value: 'mine' as Tab, label: 'Míos' },
    ],
    [quick],
  )
  const activeTab: Tab = tabs.some((t) => t.value === tab) ? tab : 'recent'

  // Desktop keyboard: from the field, ArrowDown enters the results; arrows walk the rows; Enter opens the
  // focused row (the browser clicks it) or, from the field, the first result; Escape goes back to the field.
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (!desktop || e.defaultPrevented) return
    const target = e.target as HTMLElement
    const input = inputRef.current
    const rows = [...(rootRef.current?.querySelectorAll<HTMLElement>('[data-food-row]') ?? [])]
    if (target === input) {
      if (e.key === 'ArrowDown' && rows[0]) {
        e.preventDefault()
        rows[0].focus()
      } else if (e.key === 'Enter' && dq.trim() && rows[0]) {
        e.preventDefault()
        rows[0].click()
      }
      return
    }
    const i = rows.indexOf(target)
    if (i < 0) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const next = i + (e.key === 'ArrowDown' ? 1 : -1)
      if (next < 0) input?.focus()
      else rows[Math.min(next, rows.length - 1)]?.focus()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      input?.focus()
    }
  }

  return (
    <div ref={rootRef} onKeyDown={onKeyDown}>
      {stickyTop}
      <div className={`sticky z-20 -mx-4 px-4 pb-2 pt-1 backdrop-blur ${inSheet ? 'top-0 bg-surface/95' : 'top-14 bg-bg/95 lg:top-0'}`}>
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
            <div className="relative min-w-0 flex-1">
              <Icon name="search" size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
              <input
                ref={inputRef}
                type="search"
                className="field pl-10"
                placeholder="Buscar alimento"
                value={q}
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
            aria-pressed={barcodeMode}
            onClick={() => setBarcodeMode((v) => !v)}
          >
            <Icon name="barcode" />
          </button>
          {barcodeMode && barcodeScanSupported() ? (
            <button type="button" className="btn-secondary px-3" aria-label="Escanear con la cámara" onClick={() => setScan(true)}>
              <Icon name="camera" />
            </button>
          ) : null}
          <button
            type="button"
            className={`btn-secondary relative px-3 ${filterActive ? 'border-accent text-accent' : ''}`}
            aria-label={filterActive ? 'Filtros, hay un filtro activo' : 'Filtros'}
            aria-haspopup="dialog"
            data-testid="filters-button"
            onClick={() => setFilters(true)}
          >
            <Icon name="sliders" />
            {filterActive ? <span aria-hidden data-testid="filters-dot" className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-accent" /> : null}
          </button>
        </div>
      </div>

      {foods.catalogError ? <p className="my-3 rounded-xl bg-bad/10 p-3 text-body text-bad">{foods.catalogError}</p> : null}
      {!foods.ready && !foods.catalogError ? <p className="my-3 text-body text-muted">Cargando catálogo de alimentos…</p> : null}

      {barcodeMode ? (
        <div className="mt-3 space-y-3">
          {online.note ? (
            <div className="card p-4 text-body">
              <p>{online.note}</p>
              <p className="mt-1 text-label text-muted">Puedes consultarlo en Open Food Facts (requiere internet; se envía solo el código).</p>
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
          {online.busy ? <p className="text-body text-muted">Consultando Open Food Facts…</p> : null}
          {online.error ? (
            <div className="rounded-xl bg-warn/10 p-3 text-body text-warn">
              {online.error}{' '}
              <Link className="font-semibold underline" to={`/comida/etiqueta?barcode=${encodeURIComponent(code.replace(/\D/g, ''))}`}>
                Registrar desde la etiqueta
              </Link>
            </div>
          ) : null}
        </div>
      ) : dq.trim() ? (
        <>
          <ResultList foods={ordered.main} {...rowProps} />
          {ordered.english.length ? (
            <div className="border-t border-line">
              <button
                type="button"
                data-testid="english-toggle"
                aria-expanded={showEnglish}
                onClick={() => setEnglishFor(showEnglish ? null : dq)}
                className="flex min-h-[52px] w-full items-center gap-2 text-left text-body font-medium text-muted transition-colors hover:text-ink"
              >
                <Icon name={showEnglish ? 'chevronUp' : 'chevronDown'} size={18} />
                {showEnglish ? 'Ocultar' : 'Ver'} {ordered.english.length} {ordered.english.length === 1 ? 'resultado' : 'resultados'} en inglés
              </button>
              {showEnglish ? <ResultList foods={ordered.english} {...rowProps} testId="food-results-english" /> : null}
            </div>
          ) : null}
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
                  <ResultList
                    foods={dedupeByRef(online.results.map(fromRefFood), foods.resolve)}
                    {...rowProps}
                    onSelect={(f) => void pickOnline(online.results!.find((x) => x.id === f.ref)!)}
                    testId="food-results-online"
                  />
                ) : (
                  <p className="text-body text-muted">Sin resultados con datos de energía.</p>
                )}
                {online.note ? <p className="text-label text-muted">{online.note}</p> : null}
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
            {online.error ? <p className="text-body text-warn">{online.error}</p> : null}
            <p className="text-label text-muted">La búsqueda en línea envía solo el texto escrito a Open Food Facts.</p>
          </div>
        </>
      ) : (
        <div className="mt-1">
          <Segmented<Tab> value={activeTab} onChange={setTab} options={tabs} size="sm" ariaLabel="Lista de alimentos" />
          {activeTab === 'recent' ? (
            recentFoods.length ? (
              <ResultList foods={recentFoods} {...rowProps} testId="food-recent" />
            ) : (
              <EmptyState icon="clock" title="Aún no hay recientes">
                Busca un alimento por nombre o escanea un código.
              </EmptyState>
            )
          ) : activeTab === 'freq' && quick ? (
            <div className="mt-1">
              {ideas}
              {frequentFoods.length ? (
                <ResultList foods={frequentFoods} {...rowProps} testId="food-frequent" />
              ) : (
                <EmptyState icon="clock" title={`Aún no hay frecuentes en ${mealLower(quick.meal)}`}>
                  Aparecen aquí los alimentos que registras a menudo en esta comida.
                </EmptyState>
              )}
            </div>
          ) : activeTab === 'fav' ? (
            favFoods.length ? (
              <ResultList foods={favFoods} {...rowProps} testId="food-favs" />
            ) : (
              <EmptyState icon="star" title="Sin favoritos">
                Marca la estrella al registrar un alimento.
              </EmptyState>
            )
          ) : mineFoods.length ? (
            <ResultList foods={mineFoods} {...rowProps} testId="food-mine" />
          ) : (
            <EmptyState icon="tag" title="Sin alimentos propios" action={<Link className="btn-primary" to="/comida/etiqueta">Crear desde etiqueta</Link>}>
              Los alimentos creados desde etiquetas y tus recetas aparecen aquí.
            </EmptyState>
          )}
        </div>
      )}

      <Sheet
        open={filters}
        onClose={() => setFilters(false)}
        title="Filtros"
        footer={
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-secondary flex-1"
              disabled={!filterActive}
              onClick={() => {
                setSrc('all')
                setKind('all')
              }}
            >
              Quitar filtros
            </button>
            <button type="button" className="btn-primary flex-1" onClick={() => setFilters(false)}>
              Listo
            </button>
          </div>
        }
      >
        <div className="space-y-4 pb-2" data-testid="filters-sheet">
          <ChipGroup label="Base de datos" value={src} onChange={setSrc} options={SRC_FILTERS} />
          <ChipGroup label="Estado" value={kind} onChange={setKind} options={KIND_FILTERS} />
          {filtersExtra}
        </div>
      </Sheet>

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

function ChipGroup<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (v: T) => void; options: { v: T; l: string }[] }) {
  return (
    <div role="radiogroup" aria-label={label}>
      <span className="label">{label}</span>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button key={o.v} type="button" role="radio" aria-checked={value === o.v} onClick={() => onChange(o.v)} className={`chip min-h-11 ${value === o.v ? 'chip-on' : ''}`}>
            {o.l}
          </button>
        ))}
      </div>
    </div>
  )
}

/** One food row: glyph, name (two lines), brand, and on the right the habitual quantity with its energy. */
export function FoodRow({
  food,
  onSelect,
  quick,
  last,
  selected,
}: {
  food: Food
  onSelect: (f: Food) => void
  quick?: QuickAddContext
  last?: FoodLog
  selected?: boolean
}) {
  const habitual = useMemo(() => habitualFor(food, last), [food, last])
  const inDiary = !!quick?.inDiary.has(food.ref)
  return (
    <li className="flex items-center gap-1">
      <button
        type="button"
        data-food-row=""
        aria-current={selected ? 'true' : undefined}
        onClick={() => onSelect(food)}
        className="flex min-h-[60px] min-w-0 flex-1 items-center gap-3 py-2 text-left transition-colors hover:bg-surface2/50 aria-[current=true]:bg-surface2 lg:scroll-mt-32 lg:rounded-xl lg:px-2"
      >
        <FoodGlyph size={40} food={food} />
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 text-body font-medium leading-snug">
            {food.name}
            {inDiary ? (
              <span role="img" aria-label="En el diario" className="ml-1.5 inline-block align-[-2px] text-good">
                <Icon name="check" size={15} />
              </span>
            ) : null}
          </span>
          {food.brand ? <span className="block truncate text-label text-muted">{food.brand}</span> : null}
        </span>
        {habitual ? (
          <span className="num max-w-[38%] shrink-0 text-right" data-testid="food-habitual">
            <span className="block truncate text-label font-medium text-ink">{habitual.qty}</span>
            {habitual.kcal !== null ? <span className="block text-label text-muted">{habitual.kcal} kcal</span> : null}
          </span>
        ) : null}
      </button>
      {last && quick ? (
        <button
          type="button"
          data-testid="quick-add"
          aria-label={`Agregar ${describeQty(last)} de ${food.name}`}
          title={`Agregar ${describeQty(last)}`}
          onClick={() => quick.onQuickAdd(last, food)}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-line-strong text-accent transition-colors duration-state hover:border-accent hover:bg-accent/10 active:scale-95"
        >
          <Icon name="plus" size={18} />
        </button>
      ) : null}
    </li>
  )
}

/**
 * A list of foods, one row each. A row whose food has a previous quantity (a log to copy) also has a
 * "+" that logs that exact snapshot; a row without one has none, and tapping it opens the food detail.
 */
export function ResultList({
  foods,
  onSelect,
  quick,
  lastLogs,
  selectedRef,
  testId = 'food-results',
}: {
  foods: Food[]
  onSelect: (f: Food) => void
  quick?: QuickAddContext
  lastLogs?: ReadonlyMap<string, FoodLog> | null
  selectedRef?: string
  testId?: string
}) {
  if (!foods.length) return null
  return (
    <ul className="divide-rows mt-1" data-testid={testId}>
      {foods.map((f) => (
        <FoodRow key={f.ref} food={f} onSelect={onSelect} quick={quick} last={quick ? lastLogs?.get(f.ref) : undefined} selected={selectedRef === f.ref} />
      ))}
    </ul>
  )
}
