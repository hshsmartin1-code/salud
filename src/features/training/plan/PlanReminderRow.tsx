import { useEffect, useState } from 'react'
import { Toggle } from '../../../ui/kit'
import { requestNotificationPermission, restNotificationStatus } from '../../../integrations/notifications'
import { isNativePlatform } from '../../../integrations/notifications/native'
import { isValidReminderTime, setReminder } from './plan'
import type { PlanState } from './usePlan'

const DEFAULT_TIME = '07:00'

/**
 * Reminder switch and time of the plan. The notification permission is requested here and nowhere else, from the tap
 * that switches the reminder on. Scheduling (TrainingReminderSync) never asks. Android only.
 */
export function PlanReminderRow({ p }: { p: PlanState }) {
  const native = isNativePlatform()
  const on = p.plan?.reminder?.on === true
  const time = p.plan?.reminder?.time ?? DEFAULT_TIME
  const [blocked, setBlocked] = useState(false)

  // A reminder that is on but whose permission was taken away in the system settings says so.
  useEffect(() => {
    if (!native || !on) return
    let live = true
    void restNotificationStatus().then((s) => live && setBlocked(s !== 'granted'))
    return () => {
      live = false
    }
  }, [native, on])

  if (!native) {
    return (
      <div className="flex items-start justify-between gap-4 py-2" data-testid="plan-reminder-web">
        <span className="text-sm font-medium">Recordatorio</span>
        <span className="text-label text-muted">Disponible en la app de Android</span>
      </div>
    )
  }

  const toggle = async (v: boolean) => {
    if (!v) {
      setBlocked(false)
      await p.edit((pl) => setReminder(pl, { on: false, time }))
      return
    }
    const status = await restNotificationStatus()
    const ok = status === 'granted' || (status === 'unasked' && (await requestNotificationPermission()))
    setBlocked(!ok)
    if (ok) await p.edit((pl) => setReminder(pl, { on: true, time }))
  }

  return (
    <div data-testid="plan-reminder">
      <Toggle label="Recordatorio los días de entreno" checked={on} onChange={(v) => void toggle(v)} />
      {on ? (
        <label className="mt-1 flex items-center justify-between gap-3 text-sm">
          <span className="font-medium">Hora</span>
          <input
            type="time"
            className="field w-auto"
            value={time}
            aria-label="Hora del recordatorio"
            data-testid="plan-reminder-time"
            onChange={(e) => {
              const v = e.target.value
              if (isValidReminderTime(v)) void p.edit((pl) => setReminder(pl, { on: true, time: v }))
            }}
          />
        </label>
      ) : null}
      {blocked ? (
        <p className="mt-2 text-label text-muted" role="status" data-testid="plan-reminder-blocked">
          Para recibir el aviso, permite las notificaciones de Salud en los ajustes del sistema.
        </p>
      ) : null}
    </div>
  )
}
