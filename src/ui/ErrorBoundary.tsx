import { Component, type ErrorInfo, type ReactNode } from 'react'
import { claimChunkReload, isChunkLoadError } from './errorBoundaryLogic'
import { describeError } from './globalErrors'

interface Props {
  children: ReactNode
  /** 'app' wraps everything (no router or providers available); 'route' wraps the screens only. */
  scope: 'app' | 'route'
  /** When this value changes (navigation) a route boundary clears its error and renders again. */
  resetKey?: string
}
interface State {
  error: Error | null
  key: string | undefined
}

function safeSessionStorage(): Storage | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

/**
 * Catches render errors and failed lazy-chunk loads so a bad row or a stale chunk never leaves a
 * permanent white screen. The fallback uses no router, toast or profile hooks, so it also works
 * when those are what failed.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, key: this.props.resetKey }
  private reloading = false

  static getDerivedStateFromError(error: unknown): Pick<State, 'error'> {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  /** Navigation (a new resetKey) clears the error so the next screen gets a fresh try. */
  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Never silent: the full error and component stack in dev; name and message only in production
    // (no rows, no health data).
    if (import.meta.env.DEV) console.error('[ErrorBoundary]', error, info.componentStack)
    else console.error('[ErrorBoundary]', describeError(error))
    if (claimChunkReload(error, safeSessionStorage())) {
      this.reloading = true
      window.location.reload()
    }
  }

  private retry = () => {
    // React.lazy keeps a rejected import forever, so a chunk failure can only be fixed by reloading.
    if (isChunkLoadError(this.state.error)) window.location.reload()
    else this.setState({ error: null })
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    const chunk = isChunkLoadError(error)
    const full = this.props.scope === 'app'
    return (
      <div
        role="alert"
        data-testid="error-fallback"
        className={`${full ? 'min-h-dvh' : 'min-h-[60dvh]'} flex items-center justify-center bg-bg p-4`}
      >
        <div className="tile w-full max-w-sm space-y-4 p-5">
          <h1 className="text-lg font-semibold">{this.reloading ? 'Actualizando…' : 'Algo no salió bien'}</h1>
          <p className="text-body text-muted">
            {chunk
              ? 'No se pudo cargar esta pantalla. Puede que la app se haya actualizado. Recarga para obtener la versión nueva.'
              : 'Esta pantalla tuvo un problema y no se pudo mostrar. Tus datos siguen guardados en este dispositivo.'}
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-primary" onClick={this.retry}>
              Reintentar
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => window.location.reload()}>
              Recargar
            </button>
          </div>
          <p className="text-sm text-muted">
            ¿Quieres asegurar tus datos?{' '}
            <a className="font-medium underline" href="#/respaldo">
              Ir a Respaldo
            </a>
          </p>
        </div>
      </div>
    )
  }
}
