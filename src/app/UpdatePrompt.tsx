import { useRegisterSW } from 'virtual:pwa-register/react'
import { Icon } from '../ui/Icon'

/** Service-worker lifecycle: "offline ready" note and "new version" prompt. */
export function UpdatePrompt() {
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, reg) {
      // Check for updates every hour while the app is open.
      if (reg) window.setInterval(() => void reg.update(), 60 * 60 * 1000)
    },
  })
  if (!offlineReady && !needRefresh) return null
  return (
    <div className="fixed inset-x-0 bottom-20 z-50 flex justify-center px-4 lg:bottom-6" role="status">
      <div className="card flex max-w-md items-center gap-3 px-4 py-3 shadow-pop">
        <Icon name={needRefresh ? 'refresh' : 'check'} className="text-accent" />
        <div className="flex-1 text-sm">
          {needRefresh ? 'Hay una versión nueva de la aplicación.' : 'Lista para usarse sin conexión.'}
        </div>
        {needRefresh ? (
          <button className="btn-primary px-3 py-1.5" onClick={() => void updateServiceWorker(true)}>
            Actualizar
          </button>
        ) : null}
        <button
          className="btn-ghost p-1.5"
          aria-label="Cerrar"
          onClick={() => {
            setOfflineReady(false)
            setNeedRefresh(false)
          }}
        >
          <Icon name="x" size={18} />
        </button>
      </div>
    </div>
  )
}
