import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { OTA_BUILD } from '../../ota/config'
import type { OtaErrorCode } from '../../ota/manifest'
import { Icon } from '../../ui/Icon'
import { observeDockInset } from '../../ui/dockInset'
import { useKeyboardInset } from '../training/shared/useKeyboardInset'
import { bannerHiddenOn, bannerModel, type BannerActionId, type BannerModel, type BannerTone } from './bannerModel'
import type { UpdateService } from './service'
import { appUpdates, isNativeShell } from './shared'
import { isTextEntry } from './textEntry'

// A thin bar on the left carries the tone (no icon: on a 360 px phone the icon costs the text a line).
const TONE: Record<BannerTone, string> = { info: 'bg-accent', good: 'bg-good', warn: 'bg-warn', bad: 'bg-bad' }

/**
 * One compact line, fixed above the mobile bottom navigation and above every other bottom bar (it stacks on
 * `--dock-inset-base`). It floats over the page, so nothing moves when it appears: it publishes its height as
 * `--update-banner-inset`, which the page's bottom padding adds, so the last line of a page can always be scrolled
 * clear of it. Presentational: the container below owns the state and the actions.
 */
export function UpdateBannerView({ model, onAction, onDismiss }: { model: BannerModel; onAction: (id: BannerActionId) => void; onDismiss: () => void }) {
  const wrapper = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const node = wrapper.current
    if (!node) return
    return observeDockInset('update', node)
  }, [])
  return (
    <div
      ref={wrapper}
      data-testid="update-banner"
      className="pointer-events-none fixed inset-x-0 bottom-[calc(62px+env(safe-area-inset-bottom)+var(--dock-inset-base,0px))] z-30 px-3 pb-2 lg:left-64 lg:bottom-[calc(env(safe-area-inset-bottom)+var(--dock-inset-base,0px))]"
    >
      <div className="pointer-events-auto relative mx-auto flex max-w-3xl items-center gap-2 overflow-hidden rounded-2xl border border-line-strong bg-surface py-1.5 pl-4 pr-1 shadow-pop">
        <span aria-hidden="true" className={`absolute inset-y-2.5 left-1.5 w-1 rounded-full ${TONE[model.tone]}`} />
        <div role="status" aria-live="polite" className="min-w-0 flex-1 py-1">
          <span className="sr-only">{model.announce}</span>
          <div aria-hidden="true">
            <p className="text-sm font-semibold leading-snug text-ink" data-testid="update-banner-text">{model.text}</p>
            {model.detail ? <p className="text-label leading-snug text-muted">{model.detail}</p> : null}
          </div>
        </div>
        {model.action ? (
          <button type="button" className="btn-primary shrink-0 px-3" onClick={() => onAction(model.action!.id)} data-testid="update-banner-action">{model.action.label}</button>
        ) : null}
        {model.dismissible ? (
          <button type="button" className="btn-ghost h-11 w-11 shrink-0 p-0" aria-label="Cerrar aviso" onClick={onDismiss} data-testid="update-banner-dismiss">
            <Icon name="x" size={18} />
          </button>
        ) : null}
        {model.progress !== undefined ? (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-surface2" role="progressbar" aria-label="Progreso de la descarga" aria-valuemin={0} aria-valuemax={100} aria-valuenow={model.progress}>
            <div className="h-full bg-accent" style={{ width: `${model.progress}%` }} />
          </div>
        ) : null}
      </div>
    </div>
  )
}

export type BannerService = Pick<UpdateService, 'getState' | 'subscribe' | 'check' | 'download' | 'apply' | 'acknowledge'>

/** True while a text field has focus: the keyboard is up and the notice stays out of the way. */
function useTextFieldFocus(): boolean {
  const [focused, setFocused] = useState(false)
  useEffect(() => {
    const update = () => setFocused(isTextEntry(document.activeElement as HTMLElement | null))
    // focusout fires before the next element is focused: read the active element after it settled.
    const later = () => window.setTimeout(update, 0)
    document.addEventListener('focusin', update)
    document.addEventListener('focusout', later)
    update()
    return () => { document.removeEventListener('focusin', update); document.removeEventListener('focusout', later) }
  }, [])
  return focused
}

function BannerContainer({ service }: { service: BannerService }) {
  const state = useSyncExternalStore(service.subscribe, service.getState)
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const keyboard = useKeyboardInset()
  const typing = useTextFieldFocus()
  // Dismissed notices are remembered until the app is restarted (plain state: it lives as long as the app shell).
  const [dismissed, setDismissed] = useState<string | null>(null)
  const [failureCode, setFailureCode] = useState<OtaErrorCode | null>(null)

  const model = bannerModel(state, dismissed, { native: true, enabled: true, hidden: bannerHiddenOn(pathname) || keyboard > 0 || typing, failureCode })

  const run = useCallback(async (operation: () => Promise<unknown>) => {
    setFailureCode(null)
    setDismissed(null)
    await operation()
    const after = service.getState()
    if (after.status === 'error') setFailureCode(after.code)
  }, [service])

  const onAction = (id: BannerActionId) => {
    switch (id) {
      case 'download': void run(() => service.download()); break
      case 'apply': void run(() => service.apply()); break
      case 'retry': void run(async () => {
        const s = await service.check()
        if (s.status === 'available' && s.kind === 'web') await service.download()
      }); break
      case 'settings': navigate('/ajustes/actualizaciones'); break
      case 'notes': service.acknowledge(); navigate('/ajustes/actualizaciones'); break
    }
  }
  const onDismiss = () => {
    if (!model) return
    // The one-time notices go back to idle in the service; offers are only hidden until the next launch.
    if (model.kind === 'applied' || model.kind === 'rolled-back') service.acknowledge()
    else setDismissed(model.key)
  }
  return model ? <UpdateBannerView model={model} onAction={onAction} onDismiss={onDismiss} /> : null
}

/**
 * Global update notice. Mount ONCE inside the app shell (so never on the welcome/onboarding screens). It renders
 * nothing, and creates no service, in the browser or when this build has OTA off. `service`, `native` and `enabled`
 * exist so tests can inject them; the app passes nothing.
 */
export function UpdateBanner({ service, native = isNativeShell(), enabled = OTA_BUILD.enabled }: { service?: BannerService; native?: boolean; enabled?: boolean }) {
  if (!native || !enabled) return null
  return <ShellBanner service={service} />
}

function ShellBanner({ service }: { service?: BannerService }) {
  const [svc] = useState<BannerService>(() => service ?? appUpdates())
  return <BannerContainer service={svc} />
}
