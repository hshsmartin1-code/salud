import { useState, type ReactNode } from 'react'
import { useTheme, type ThemePref } from '../app/theme'
import { AppShell } from '../ui/AppShell'
import { useConfirm } from '../ui/Confirm'
import { Delta } from '../ui/Delta'
import { IconButton } from '../ui/IconButton'
import { Menu } from '../ui/Menu'
import { Meter } from '../ui/Meter'
import { Metric } from '../ui/Metric'
import { PeriodPicker } from '../ui/PeriodPicker'
import { Row } from '../ui/Row'
import { SectionHeader } from '../ui/SectionHeader'
import { Skeleton } from '../ui/Skeleton'
import { Stepper } from '../ui/Stepper'
import { Tabs } from '../ui/Tabs'
import { useToast } from '../ui/Toast'
import { EmptyState, PageHeader, Segmented, Toggle } from '../ui/kit'
import { Icon } from '../ui/Icon'
import { parseCustomPeriod } from '../ui/period'

/** Development gallery of the V3 kit (route #/dev/kit). Synthetic values only. */
function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-3 border-t border-line pt-7" aria-label={title}>
      <SectionHeader title={title} hint={hint} />
      {children}
    </section>
  )
}

/** One state of a component, with a plain-language caption above it. */
function Case({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <div className="min-w-0 space-y-1.5">
      <p className="text-label text-muted">{caption}</p>
      {children}
    </div>
  )
}

const TYPE_SCALE = [
  { token: 'text-display', spec: '40 / 40', cls: 'text-display readout', sample: '2.140' },
  { token: 'text-readout', spec: '28 / 28', cls: 'text-readout readout', sample: '72,4' },
  { token: 'text-title', spec: '24 / 28', cls: 'text-title title-wide font-bold', sample: 'Salud' },
  { token: 'text-heading', spec: '17 / 22', cls: 'text-heading', sample: 'Sentadilla en Smith' },
  { token: 'text-body', spec: '15 / 22', cls: 'text-body', sample: 'Texto y filas de lista' },
  { token: 'text-label', spec: '13 / 18', cls: 'text-label text-muted', sample: 'Etiquetas, contexto y unidades' },
  { token: 'text-micro', spec: '11 / 14', cls: 'text-micro text-muted', sample: 'Ejes y pies de gráfica' },
] as const

const PERIODS = [
  { value: '7d', label: '7 d' },
  { value: '30d', label: '30 d' },
  { value: '90d', label: '90 d' },
]

export default function KitGallery() {
  const [theme, setTheme] = useTheme()
  const confirm = useConfirm()
  const toast = useToast()
  const [verdict, setVerdict] = useState('Sin respuesta todavía')
  const [tab, setTab] = useState('resumen')
  const [seg, setSeg] = useState('dia')
  const [period, setPeriod] = useState('30d')
  const [weight, setWeight] = useState(72.4)
  const [sets, setSets] = useState(3)
  const [water, setWater] = useState(0.25)
  const [on, setOn] = useState(true)
  const [lastMenu, setLastMenu] = useState('Ninguna acción elegida')
  const range = parseCustomPeriod(period)

  const menuItems = [
    { label: 'Reordenar ejercicios', icon: 'swap' as const, onSelect: () => setLastMenu('Reordenar ejercicios') },
    { label: 'Añadir nota', icon: 'pencil' as const, onSelect: () => setLastMenu('Añadir nota') },
    { label: 'Duplicar sesión', icon: 'copy' as const, disabled: true, onSelect: () => setLastMenu('Duplicar') },
    { label: 'Descartar sesión', icon: 'trash' as const, tone: 'danger' as const, onSelect: () => setLastMenu('Descartar sesión') },
  ]

  return (
    <AppShell header={<span className="title-wide text-heading font-bold">Kit V3</span>}>
      <PageHeader
        title="Kit de interfaz"
        subtitle="Componentes canónicos con sus estados. Valores sintéticos."
        actions={
          <div className="w-44">
            <Segmented<ThemePref>
              size="sm"
              ariaLabel="Tema"
              value={theme}
              onChange={setTheme}
              options={[
                { value: 'light', label: 'Claro' },
                { value: 'dark', label: 'Oscuro' },
              ]}
            />
          </div>
        }
      />

      <div className="space-y-7">
        <Section title="Tipografía" hint="Seis pasos más el valor de pantalla. Mínimo absoluto 11 px.">
          <div className="divide-rows">
            {TYPE_SCALE.map((t) => (
              <div key={t.token} className="flex min-h-[52px] items-baseline justify-between gap-3 py-2">
                <span className={`min-w-0 truncate ${t.cls}`}>{t.sample}</span>
                <span className="num shrink-0 text-label text-muted">
                  {t.token} · {t.spec}
                </span>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Metric" hint="La cifra manda: valor, unidad pegada y como mucho una línea de contexto.">
          <div className="grid grid-cols-2 gap-x-4 gap-y-6">
            <Case caption="md, con cambio neutro">
              <Metric label="Peso" value="72,4" unit="kg" delta={<Delta value={-0.6} unit="kg" period="vs. 7 d" />} />
            </Case>
            <Case caption="lg con contexto">
              <Metric label="Proteína" value="118" unit="g" size="lg" hint="de 140 g objetivo" />
            </Case>
            <Case caption="Texto largo">
              <Metric label="Energía disponible tras el entrenamiento de la tarde" value="2.140" unit="kcal" hint="Estimación a partir de 14 de 30 días con dato" />
            </Case>
            <Case caption="Vacío">
              <Metric label="Presión arterial" value="—" hint="Sin registros en este periodo" />
            </Case>
            <Case caption="Error">
              <Metric label="Glucosa" value="248" unit="mg/dl" tone="bad" hint="Fuera de rango" />
            </Case>
            <Case caption="Acento y aviso">
              <Metric label="Racha" value="12" unit="días" tone="accent" delta={<Delta value={3} period="vs. mes anterior" goodWhen="up" />} />
            </Case>
          </div>
          <Case caption="xl: valor principal de la pantalla">
            <Metric label="Calorías de hoy" value="1.842" unit="kcal" size="xl" hint="Quedan 358 kcal para el objetivo" />
          </Case>
        </Section>

        <Section title="Delta" hint="Neutro salvo que se indique qué dirección es buena.">
          <div className="grid gap-3 sm:grid-cols-2">
            <Case caption="Sin goodWhen: neutro">
              <div className="flex flex-col items-start gap-1.5">
                <Delta value={8} unit="%" period="vs. 7 d anteriores" />
                <Delta value={-12} unit="min" period="vs. 7 d anteriores" />
              </div>
            </Case>
            <Case caption="goodWhen: bueno y malo">
              <div className="flex flex-col items-start gap-1.5">
                <Delta value={-0.6} unit="kg" period="vs. 30 d" goodWhen="down" />
                <Delta value={0.6} unit="kg" period="vs. 30 d" goodWhen="down" />
                <Delta value={0} unit="kg" period="vs. 30 d" goodWhen="down" />
              </div>
            </Case>
            <Case caption="Texto largo en 360 px">
              <Delta value={1250} unit="pasos al día" period="frente a las cuatro semanas anteriores completas" goodWhen="up" />
            </Case>
          </div>
        </Section>

        <Section title="Row" hint="52 px, denso 48 px. Apiladas con divide-rows, sin tarjeta.">
          <div className="divide-rows">
            <Row leading={<Icon name="dumbbell" size={20} />} title="Pierna A" subtitle="7 ejercicios · 21 series" trailing="62 min" />
            <Row leading={<Icon name="scale" size={20} />} title="Peso corporal" subtitle="Última medición hoy, 7:42" onClick={() => setLastMenu('Fila abierta')} />
            <Row
              leading={<Icon name="bed" size={20} />}
              title="Sueño de la noche anterior con un nombre excesivamente largo para comprobar el recorte"
              subtitle="6 h 52 min · 3 de 7 noches con dato en esta semana"
              to="/sueno"
            />
            <Row dense leading={<Icon name="droplet" size={20} />} title="Agua" subtitle="Fila densa" trailing="1,8 L" />
            <Row leading={<Icon name="heart" size={20} />} title="Presión arterial" subtitle="Sin registros" disabled onClick={() => undefined} />
          </div>
          <Case caption="Vacío">
            <EmptyState icon="info" title="Sin sesiones en este periodo">
              Cuando termines un entrenamiento aparecerá aquí.
            </EmptyState>
          </Case>
        </Section>

        <Section title="Meter" hint="role=&quot;meter&quot;. Más de un 5 % sobre el objetivo se tiñe de aviso.">
          <div className="space-y-4">
            <Case caption="bar: agua 1,8 de 2,5 L">
              <Meter variant="bar" value={1.8} max={2.5} colorVar="water" label="Agua de hoy" valueText="1,8 de 2,5 litros" />
            </Case>
            <Case caption="scale: proteína 118 de 140 g">
              <Meter variant="scale" value={118} max={140} colorVar="protein" label="Proteína de hoy" />
            </Case>
            <Case caption="segments: 6 de 21 series">
              <Meter variant="segments" value={6} max={21} colorVar="train" label="Series completadas" />
            </Case>
            <Case caption="Por encima del objetivo (aviso)">
              <Meter variant="scale" value={2480} max={2200} colorVar="energy" label="Energía de hoy" />
            </Case>
            <Case caption="Vacío: sin objetivo">
              <Meter variant="bar" value={undefined} max={undefined} colorVar="sleep" label="Sueño sin objetivo" />
            </Case>
          </div>
        </Section>

        <Section title="SectionHeader">
          <div className="space-y-5">
            <SectionHeader title="Peso" hint="14 de 30 días con dato" action={<button className="btn-ghost px-3 text-label font-semibold text-accent">Ver detalle</button>} />
            <SectionHeader title="Un título de sección muy largo que debe poder continuar en una segunda línea sin romper el diseño" action={<IconButton icon="plus" label="Añadir registro" />} />
            <SectionHeader title="Solo título" />
          </div>
        </Section>

        <Section title="IconButton" hint="44 × 44 px, siempre con nombre.">
          <div className="flex flex-wrap items-center gap-2">
            <IconButton icon="plus" label="Añadir registro" />
            <IconButton icon="edit" label="Editar" tone="accent" />
            <IconButton icon="trash" label="Eliminar" tone="danger" />
            <IconButton icon="star" label="Marcar favorito" pressed />
            <IconButton icon="download" label="Descargar" disabled />
          </div>
        </Section>

        <Section title="Tabs y Segmented" hint="Flechas, Inicio y Fin. Solo la opción activa está en el orden de Tab.">
          <Case caption="Tabs">
            <Tabs
              ariaLabel="Detalle del ejercicio"
              value={tab}
              onChange={setTab}
              tabs={[
                { value: 'resumen', label: 'Resumen' },
                { value: 'historial', label: 'Historial', count: 12 },
                { value: 'records', label: 'Récords' },
                { value: 'tecnica', label: 'Técnica' },
                { value: 'bloqueada', label: 'Progresión avanzada', disabled: true },
              ]}
            />
          </Case>
          <Case caption="Segmented">
            <div className="max-w-md">
            <Segmented
              ariaLabel="Vista"
              value={seg}
              onChange={setSeg}
              options={[
                { value: 'dia', label: 'Día' },
                { value: 'semana', label: 'Semana' },
                { value: 'mes', label: 'Mes' },
              ]}
            />
            </div>
          </Case>
        </Section>

        <Section title="Stepper" hint="Admite coma decimal. Se limita al mínimo y al máximo.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Case caption="Por defecto">
              <Stepper label="Peso" unit="kg" step={0.1} min={30} max={300} value={weight} onChange={setWeight} />
            </Case>
            <Case caption="En el mínimo">
              <Stepper label="Series" step={1} min={0} max={20} value={sets} onChange={setSets} />
            </Case>
            <Case caption="Paso de 0,25 L">
              <Stepper label="Agua añadida" unit="L" step={0.25} min={0} max={5} value={water} onChange={setWater} />
            </Case>
            <Case caption="Error">
              <Stepper label="Presión sistólica" unit="mmHg" step={1} min={60} max={260} value={300} onChange={() => undefined} error="Fuera del rango habitual (60 a 260)" />
            </Case>
            <Case caption="Desactivado">
              <Stepper label="Descanso" unit="s" step={15} min={0} value={90} onChange={() => undefined} disabled />
            </Case>
          </div>
        </Section>

        <Section title="Menu" hint="Menos de 640 px: hoja de acciones. Más ancho: menú anclado.">
          <div className="flex items-center justify-between gap-3">
            <p className="min-w-0 text-body text-muted">
              Última acción: <span className="text-ink">{lastMenu}</span>
            </p>
            <Menu label="Más acciones de la sesión" items={menuItems} />
          </div>
          <div className="flex items-center justify-between gap-3">
            <p className="text-body text-muted">Desactivado</p>
            <Menu label="Acciones no disponibles" items={menuItems} disabled />
          </div>
        </Section>

        <Section title="Confirmación y avisos" hint="useConfirm() devuelve una promesa; useToast() muestra un aviso a la vez.">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-secondary"
              onClick={async () => {
                const ok = await confirm({ title: 'Mover el registro', body: 'Se moverá al día de ayer. Puedes volver a cambiarlo.', confirmLabel: 'Mover' })
                setVerdict(ok ? 'Confirmado' : 'Cancelado')
              }}
            >
              Confirmar acción
            </button>
            <button
              type="button"
              className="btn-danger"
              onClick={async () => {
                const ok = await confirm({
                  title: 'Descartar la sesión',
                  body: 'Se perderán las 6 series registradas. Esta acción no se puede deshacer.',
                  confirmLabel: 'Descartar sesión',
                  tone: 'danger',
                })
                setVerdict(ok ? 'Descartada' : 'Cancelado')
              }}
            >
              Descartar sesión
            </button>
          </div>
          <p role="note" className="text-label text-muted">
            Resultado: <span className="text-ink">{verdict}</span>
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => toast.show({ message: 'Peso guardado: 72,4 kg', actionLabel: 'Deshacer', onAction: () => setLastMenu('Deshacer pulsado') })}
            >
              Aviso con Deshacer
            </button>
            <button type="button" className="btn-secondary" onClick={() => toast.show({ message: 'Copia de seguridad creada' })}>
              Aviso simple
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() =>
                toast.show({
                  message: 'Se registraron 250 ml de agua en la botella pequeña del escritorio, junto con la ración de la tarde',
                  actionLabel: 'Deshacer',
                })
              }
            >
              Aviso largo
            </button>
          </div>
        </Section>

        <Section title="Skeleton" hint="Sin pulso con movimiento reducido.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Case caption="Tres líneas">
              <Skeleton lines={3} />
            </Case>
            <Case caption="Bloque de 96 px">
              <Skeleton height={96} />
            </Case>
          </div>
        </Section>

        <Section title="PeriodPicker" hint="El periodo elegido se aplica a todos los paneles de la pantalla.">
          <Case caption={range ? `Rango personalizado: ${range.from} a ${range.to}` : `Periodo: ${period}`}>
            <PeriodPicker value={period} onChange={setPeriod} options={PERIODS} allowCustom />
          </Case>
          <Case caption="Sin rango personalizado">
            <PeriodPicker value="7d" onChange={() => undefined} options={PERIODS} />
          </Case>
        </Section>

        <Section title="Toggle y objetivos táctiles">
          <Toggle checked={on} onChange={setOn} label="Mostrar RPE en las series" description="Columna opcional en la sesión en vivo" />
          <div className="flex flex-wrap gap-2">
            <button type="button" className="chip chip-on">Proteína</button>
            <button type="button" className="chip">Carbohidratos</button>
            <button type="button" className="chip">Grasa</button>
          </div>
          <p className="text-label text-muted">Los chips se dibujan en 32 px y mantienen 44 × 44 px de área táctil.</p>
        </Section>
      </div>
    </AppShell>
  )
}
