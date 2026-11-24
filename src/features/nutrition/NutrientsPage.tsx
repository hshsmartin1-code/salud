import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { DateNav, useDateParam } from '../../app/useDate'
import { useProfile, useRepo } from '../../app/profile'
import { useToday } from '../../app/useToday'
import { pickGoalForDate } from '../../db/queries'
import { getDri, REFERENCE_SETS } from '../../domain/dri'
import { buildReport, periodRange, type ReportPeriod } from '../../domain/nutrientReport'
import { formatNumber } from '../../domain/units'
import { Disclosure } from '../../ui/Disclosure'
import { Icon } from '../../ui/Icon'
import { EmptyState, PageHeader, Segmented } from '../../ui/kit'
import { SectionHeader } from '../../ui/SectionHeader'
import { buildSections, type NutrientRow } from './nutrientRows'
import { searchPath } from './paths'
import { useMealSlots } from './useMealSlots'

const PERIODS: { value: ReportPeriod; label: string }[] = [
  { value: 'day', label: 'Día' },
  { value: '7d', label: '7 días' },
  { value: '30d', label: '30 días' },
]

const TONE_TEXT = { good: 'text-good', warn: 'text-warn', bad: 'text-bad', muted: 'text-muted' } as const

function fillColor(row: NutrientRow): string {
  if (row.status.tone === 'bad') return 'rgb(var(--bad))'
  if (row.status.tone === 'warn') return 'rgb(var(--warn))'
  return `rgb(var(--${row.colorVar}))`
}

const pctW = (f: number) => `${Math.round(f * 1000) / 10}%`

function Bar({ bar, color }: { bar: NonNullable<NutrientRow['bar']>; color: string }) {
  return (
    <div className="relative h-1.5 rounded-full bg-surface2" aria-hidden>
      {bar.band ? (
        <div className="absolute inset-y-0 bg-ink/15" style={{ left: pctW(bar.band[0]), width: pctW(bar.band[1] - bar.band[0]) }} />
      ) : null}
      <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: pctW(bar.fill), background: color }} />
      {bar.mark !== null ? <div className="absolute -bottom-[3px] -top-[3px] w-0.5 rounded-full bg-ink" style={{ left: `calc(${pctW(bar.mark)} - 1px)` }} /> : null}
      {bar.ulMark !== null ? <div className="absolute -bottom-[3px] -top-[3px] w-0.5 rounded-full bg-bad" style={{ left: `calc(${pctW(bar.ulMark)} - 1px)` }} /> : null}
    </div>
  )
}

function RowView({ row }: { row: NutrientRow }) {
  return (
    <li className="py-3" data-testid={`nutrient-${row.code}`}>
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0 text-body font-medium">
          {row.label}
          {row.qualifier ? <span className="ml-1.5 text-micro font-normal text-muted">{row.qualifier}</span> : null}
        </div>
        <div className="num shrink-0 text-body font-semibold">{row.amountText}</div>
      </div>
      {row.bar ? (
        <div className="mt-1.5">
          <Bar bar={row.bar} color={fillColor(row)} />
        </div>
      ) : null}
      <div className="mt-1 flex items-start justify-between gap-3 text-label">
        <span className="min-w-0 text-muted">{row.refText}</span>
        <span className={`max-w-[50%] shrink-0 text-right font-medium ${TONE_TEXT[row.status.tone]}`} data-testid={`status-${row.code}`}>
          {row.status.text}
        </span>
      </div>
      {row.coverageHint ? <div className="mt-0.5 text-micro text-muted">{row.coverageHint}</div> : null}
      {row.notes.map((n) => (
        <div key={n} className="mt-0.5 text-micro text-muted">
          {n}
        </div>
      ))}
    </li>
  )
}

export function NutrientsPage() {
  const r = useRepo()
  const profile = useProfile()
  const slots = useMealSlots()
  const today = useToday()
  const [date, setDate] = useDateParam()
  const [period, setPeriod] = useState<ReportPeriod>('day')
  const { from, to } = periodRange(date, period)
  const dq = date === today ? '' : `?d=${date}`

  const data = useLiveQuery(async () => {
    const [logs, marks, goals] = await Promise.all([r.range('foodLogs', from, to), r.range('dayMarks', from, to), r.all('goals')])
    return { logs, marks, goal: pickGoalForDate(goals, date) }
  }, [r, from, to, date])

  const model = useMemo(() => {
    if (!data) return null
    const report = buildReport(data.logs, data.marks, from, to, { excludeIncomplete: period !== 'day' })
    const goalKcal = data.goal?.kcal ?? null
    const dri = getDri({ sex: profile.sex, birthDate: profile.birthDate, on: date, energyKcal: goalKcal })
    return { report, dri, goalKcal, sections: buildSections(report, dri, goalKcal) }
  }, [data, from, to, period, profile.sex, profile.birthDate, date])

  const report = model?.report
  const nDays = report?.days.length ?? 0
  const scope =
    period === 'day'
      ? null
      : `Promedio por día de ${nDays} ${nDays === 1 ? 'día' : 'días'} con registro`
  const excluded = report && report.excludedIncomplete > 0 ? `${report.excludedIncomplete} ${report.excludedIncomplete === 1 ? 'día excluido' : 'días excluidos'} por estar marcado${report.excludedIncomplete === 1 ? '' : 's'} como incompleto${report.excludedIncomplete === 1 ? '' : 's'}` : null

  return (
    <>
      <PageHeader title="Nutrientes" back={`/comida${dq}`} subtitle="Consumo frente a valores de referencia" />
      <div className="mb-3 flex justify-center sm:justify-start">
        <DateNav date={date} onChange={setDate} />
      </div>
      <div className="mb-4 max-w-sm">
        <Segmented ariaLabel="Periodo" size="sm" value={period} options={PERIODS} onChange={setPeriod} />
      </div>

      {!model || !report ? (
        <div className="h-48 rounded-2xl bg-surface2/40" aria-hidden />
      ) : report.days.length === 0 ? (
        <EmptyState
          icon="utensils"
          title={report.loggedDays > 0 ? 'Todos los días están marcados como incompletos' : 'Sin registros en este periodo'}
          action={
            <Link to={searchPath(date)} className="btn-primary px-4">
              <Icon name="plus" size={18} /> Agregar comida
            </Link>
          }
        >
          {report.loggedDays > 0 ? 'Los promedios no incluyen días incompletos. Cambia la marca del día o elige otro periodo.' : 'Registra lo que comes para ver cuánto aportas de cada nutriente.'}
        </EmptyState>
      ) : (
        <div data-testid="nutrients-report">
          <div className="mb-3 space-y-1 text-label text-muted" data-testid="nutrients-scope">
            <p data-testid="nutrients-refset">Referencia: {REFERENCE_SETS[model.dri.referenceSet]}</p>
              {scope ? <p>{scope}.</p> : null}
              {excluded ? <p>{excluded}.</p> : null}
              {report.selectedIncomplete ? <p>Este día está marcado como incompleto: los valores pueden quedar cortos.</p> : null}
              {model.dri.notes.map((n) => (
                <p key={n}>{n}</p>
              ))}
          </div>

          {model.sections.map((sec) => (
            <section key={sec.id} className="mt-6" aria-labelledby={`nut-${sec.id}`}>
              <SectionHeader title={<span id={`nut-${sec.id}`}>{sec.title}</span>} hint={sec.hint} />
              <ul className="divide-rows mt-1">
                {sec.rows.map((row) => (
                  <RowView key={row.code} row={row} />
                ))}
              </ul>
            </section>
          ))}

          <section className="mt-6" aria-labelledby="nut-comidas" data-testid="nutrients-meals">
            <SectionHeader title={<span id="nut-comidas">Distribución por comida</span>} hint={period === 'day' ? 'Energía de cada comida' : 'Energía promedio por día'} />
            {report.meals.length === 0 ? (
              <p className="mt-2 text-label text-muted">Ningún alimento del periodo trae energía.</p>
            ) : (
              <ul className="divide-rows mt-1">
                {[...report.meals]
                  .sort((a, b) => slots.slots.findIndex((s) => s.key === a.meal) - slots.slots.findIndex((s) => s.key === b.meal))
                  .map((m) => (
                    <li key={m.meal} className="py-3" data-testid={`meal-${m.meal}`}>
                      <div className="flex items-baseline justify-between gap-3">
                        <div className="min-w-0 text-body font-medium">{slots.label(m.meal)}</div>
                        <div className="num shrink-0 text-body font-semibold">
                          {formatNumber(m.kcal, 0)} kcal <span className="font-normal text-muted">· {formatNumber(m.pct, 0)} %</span>
                        </div>
                      </div>
                      <div className="mt-1.5">
                        <Bar bar={{ fill: Math.min(1, m.pct / 100), mark: null, ulMark: null, band: null }} color="rgb(var(--energy))" />
                      </div>
                    </li>
                  ))}
              </ul>
            )}
            {report.entriesWithoutKcal > 0 ? (
              <p className="mt-1 text-micro text-muted">
                {report.entriesWithoutKcal} {report.entriesWithoutKcal === 1 ? 'alimento sin energía registrada no entra' : 'alimentos sin energía registrada no entran'} en la distribución.
              </p>
            ) : null}
          </section>

          <Disclosure summary="Cómo se calcula" className="mt-6 border-t border-line" testId="nutrients-method">
            <div className="space-y-2 text-label text-muted">
              <p>
                Referencia usada: {REFERENCE_SETS[model.dri.referenceSet]}. La referencia nacional de Colombia es la RIEN (Resolución 3803 de 2016, Ministerio de Salud); sus tablas todavía no están incluidas, así que algunos valores pueden diferir.
                Para adultos el AMDR mostrado es el del IOM (proteína 10–35 %, carbohidratos 45–65 %, grasa 20–35 %).
              </p>
              <p>
                Los valores de referencia son ingestas dietéticas de referencia (DRI) de la National Academies (NASEM/IOM) para personas sanas: RDA cubre a casi toda la población, AI es una ingesta
                adecuada estimada, CDRR es el umbral del sodio (2019) y UL es el máximo tolerable. Son referencias poblacionales, no un diagnóstico ni una prescripción individual.
              </p>
              <p>
                Edad y sexo salen del perfil: {model.dri.sex === 'male' ? 'hombre' : model.dri.sex === 'female' ? 'mujer' : 'sexo sin definir'}
                {model.dri.age !== null ? `, ${model.dri.age} años (grupo ${model.dri.ageGroup ?? 'no cubierto'})` : ', sin fecha de nacimiento (se usa el grupo de 31 a 50 años)'}. Embarazo y lactancia no están
                modelados, ni tampoco fumadores o necesidades clínicas.
              </p>
              <p>
                Fibra: 14 g por 1000 kcal de tu meta de energía. Grasa saturada (OMS 2023) y azúcares añadidos (OMS 2015): menos del 10 % de la energía, igual que las Guías Alimentarias de EE. UU. 2020-2025. Sodio: CDRR de 2300 mg (NASEM 2019) y menos de 2000 mg al día según la OMS (2012). Colesterol y grasa trans no tienen valor numérico. Macronutrientes: rangos
                AMDR en % de la energía (proteína y carbohidratos con 4 kcal/g, grasa con 9 kcal/g).
              </p>
              <p>
                Cobertura: es la parte de la energía registrada que viene de alimentos que tienen ese dato. Un nutriente sin dato en ningún alimento se muestra como sin dato, nunca como cero. Con cobertura baja el valor real es mayor
                que el mostrado. Los porcentajes de energía se calculan solo sobre los alimentos que tienen el dato.
              </p>
              <p>
                Periodos: el promedio usa solo los días con registro y deja fuera los marcados como incompletos. Cada nutriente se promedia sobre los días en que hay dato.
              </p>
              <p>
                Unidades: vitamina A en µg RAE (en el TCAC es equivalentes de retinol); vitamina E como α-tocoferol; folato total de los alimentos, mientras la RDA se expresa en DFE (el folato de alimentos fortificados vale más en DFE). Los UL de magnesio,
                folato y vitamina E aplican solo a suplementos y fortificantes, y el de vitamina A solo a retinol preformado. El agua mostrada es solo humedad de los alimentos; la AI de agua total incluye las bebidas, que están en Hidratación.
              </p>
            </div>
          </Disclosure>
        </div>
      )}
    </>
  )
}
