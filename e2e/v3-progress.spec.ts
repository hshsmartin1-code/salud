import { demoBackup, expect, test, today as clockToday } from './helpers'

// Progreso headlines state what they are. Synthetic demo dataset for the suite clock (helpers), restored
// through Respaldo; expectations are computed from that same seed, never literals that depend on the day.

interface Row {
  date: string
  steps?: number | null
  hours?: number | null
  excludeFromStats?: boolean
}
interface Tables {
  foodLogs: Row[]
  activityLogs: Row[]
  sleepLogs: Row[]
  bodyMeasurements: Row[]
}

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10)
const fmt = (v: number) => new Intl.NumberFormat('es-CO', { maximumFractionDigits: Math.abs(v) >= 100 ? 0 : 1, useGrouping: 'always' }).format(v)

/** Mean of the daily totals of COMPLETE days (before `today`) in the last 90 days, like the headline. */
function completeDayMean(rows: Row[], pick: (r: Row) => number | null | undefined, today: string): number | null {
  const from = addDays(today, -89)
  const by = new Map<string, number>()
  for (const r of rows) {
    const v = pick(r)
    if (r.excludeFromStats || v === null || v === undefined || r.date < from || r.date >= today) continue
    by.set(r.date, (by.get(r.date) ?? 0) + v)
  }
  const vals = [...by.values()]
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
}

function suite(label: string, at: string | null) {
  test.describe(label, () => {
    test.use({ clockAt: at })
    let backup: { tables: Tables } & Record<string, unknown>
    let today = ''

    test.beforeAll(async () => {
      today = clockToday(at)
      backup = await demoBackup(at)
    })

    test.beforeEach(async ({ page }) => {
      await page.goto('./')
      await page.getByTestId('restore-link').click()
      await page.getByTestId('import-backup-file').setInputFiles({ name: 'demo.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) })
      await page.getByTestId('import-target').waitFor()
      await page.getByTestId('apply-import').click()
      await page.getByTestId('import-result').waitFor()
      await page.goto('./')
      await page.getByTestId('dashboard').waitFor()
      await page.goto('./#/progreso')
      await page.getByTestId('progress-charts').waitFor()
    })

    test('sum metrics headline the mean of complete days; level metrics the latest value with its date', async ({ page }) => {
      const t = backup.tables
      const panel = (title: string) => page.getByTestId('chart-panel').filter({ has: page.getByRole('heading', { name: title, exact: true }) })
      const stepsToday = t.activityLogs.some((r) => r.date === today && r.steps != null && !r.excludeFromStats)
      const sleepToday = t.sleepLogs.some((r) => r.date === today && r.hours != null && !r.excludeFromStats)
      const foodToday = t.foodLogs.some((r) => r.date === today)
      const weightToday = t.bodyMeasurements.some((r) => r.date === today && !r.excludeFromStats)
      const note = 'hoy (en curso) no cuenta en la media'

      for (const title of ['Kcal consumidas vs objetivo', 'Proteína vs objetivo', 'Sueño', 'Pasos']) {
        await expect(panel(title).getByTestId('panel-sub')).toContainText('Media diaria · Últimos 90 días')
      }
      // The "today does not count" note appears exactly when today has data for that metric.
      for (const [title, has] of [
        ['Kcal consumidas vs objetivo', foodToday],
        ['Proteína vs objetivo', foodToday],
        ['Sueño', sleepToday],
        ['Pasos', stepsToday],
      ] as const) {
        const p = panel(title)
        if (has) await expect(p).toContainText(note)
        else await expect(p).not.toContainText(note)
      }
      // Means computed from the seed rows: complete days only.
      const steps = completeDayMean(t.activityLogs, (r) => r.steps, today)
      const sleep = completeDayMean(t.sleepLogs, (r) => r.hours, today)
      expect(steps).not.toBeNull()
      expect(sleep).not.toBeNull()
      await expect(panel('Pasos').getByTestId('panel-value')).toHaveText(fmt(steps!))
      await expect(panel('Sueño').getByTestId('panel-value')).toHaveText(fmt(sleep!))

      await expect(panel('Volumen semanal de entrenamiento').getByTestId('panel-sub')).toContainText('Media semanal')

      const peso = panel('Peso').getByTestId('panel-sub')
      await expect(peso).toContainText(/Último valor \(/)
      if (weightToday) await expect(peso).toContainText('Último valor (hoy)')
      else await expect(peso).not.toContainText('Último valor (hoy)')
    })
  })
}

suite('default clock (Wednesday afternoon)', null)
suite('Monday 00:10, nothing logged today yet', '2026-11-16T00:10:00-05:00')
