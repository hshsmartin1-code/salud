import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../../../ui/Icon'
import { SectionHeader } from '../../../ui/SectionHeader'
import { plural } from '../routines'
import { TEMPLATES, templateLine, templateSetCount, type RoutineTemplate } from '../templates'

function TemplateCard({ t, onUse }: { t: RoutineTemplate; onUse: () => void }) {
  const [open, setOpen] = useState(false)
  const sets = t.routines.reduce((a, r) => a + templateSetCount(r), 0)
  return (
    <li className="card p-3" data-testid="template-card">
      <h3 className="text-heading text-ink">{t.name}</h3>
      <p className="mt-0.5 text-label text-muted">{t.description}</p>
      <p className="num mt-1 text-label text-muted">
        {plural(t.routines.length, 'rutina', 'rutinas')} · {plural(sets, 'serie', 'series')} en total
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" className="btn-primary px-4" onClick={onUse} data-testid="use-template" aria-label={`Usar plantilla ${t.name}`}>
          Usar plantilla
        </button>
        <button type="button" className="btn-ghost px-3 text-label" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? 'Ocultar ejercicios' : 'Ver ejercicios'}
          <Icon name={open ? 'chevronUp' : 'chevronDown'} size={16} />
        </button>
      </div>
      {open ? (
        <div className="mt-3 space-y-3 border-t border-line pt-3">
          {t.routines.map((r) => (
            <div key={r.name}>
              <h4 className="text-body font-semibold text-ink">{r.name}</h4>
              <ul className="divide-rows mt-1">
                {r.exercises.map((e) => (
                  <li key={e.exerciseId} className="flex items-baseline justify-between gap-3 py-2">
                    <span className="min-w-0 text-body text-ink">{e.name}</span>
                    <span className="num shrink-0 text-label text-muted">{templateLine(e)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : null}
    </li>
  )
}

/** "Plantillas para empezar": generic starting points that become normal routines. Open by default while the library is small. */
export function TemplatesSection({ defaultOpen, onUse }: { defaultOpen: boolean; onUse: (t: RoutineTemplate) => Promise<{ id: string }[]> }) {
  const nav = useNavigate()
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="border-t border-line pt-4" aria-labelledby="tpl-title" data-testid="templates">
      <SectionHeader
        title={<span id="tpl-title">Plantillas para empezar</span>}
        hint="Puntos de partida habituales: ajusta pesos, series y descansos a tu nivel."
        action={
          <button type="button" className="btn-ghost px-2 text-label" aria-expanded={open} onClick={() => setOpen((v) => !v)} data-testid="templates-toggle">
            {open ? 'Ocultar' : 'Mostrar'}
          </button>
        }
      />
      {open ? (
        <ul className="mt-3 space-y-3 lg:grid lg:grid-cols-[repeat(2,minmax(0,1fr))] lg:items-start lg:gap-3 lg:space-y-0">
          {TEMPLATES.map((t) => (
            <TemplateCard key={t.id} t={t} onUse={() => void onUse(t).then((rows) => rows[0] && nav(`/entreno/rutinas/${rows[0].id}`))} />
          ))}
        </ul>
      ) : null}
    </section>
  )
}
