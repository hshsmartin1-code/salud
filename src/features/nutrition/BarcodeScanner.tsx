import { useEffect, useRef, useState } from 'react'
import { Sheet } from '../../ui/kit'

interface DetectorLike {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>
}
type DetectorCtor = new (opts: { formats: string[] }) => DetectorLike

export function barcodeScanSupported(): boolean {
  return typeof window !== 'undefined' && 'BarcodeDetector' in window && !!navigator.mediaDevices?.getUserMedia
}

/** Camera scan with the native BarcodeDetector API (Chrome/Edge on Android; manual entry always available). */
export function BarcodeScanner({ open, onClose, onCode }: { open: boolean; onClose: () => void; onCode: (code: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let stream: MediaStream | null = null
    let timer = 0
    let stopped = false
    setError(null)
    ;(async () => {
      try {
        const Ctor = (window as unknown as { BarcodeDetector: DetectorCtor }).BarcodeDetector
        const detector = new Ctor({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'] })
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
        const v = videoRef.current
        if (!v || stopped) return
        v.srcObject = stream
        await v.play()
        const tick = async () => {
          if (stopped || !videoRef.current) return
          try {
            const codes = await detector.detect(videoRef.current)
            const hit = codes.find((c) => /^\d{6,14}$/.test(c.rawValue))
            if (hit) {
              navigator.vibrate?.(60)
              onCode(hit.rawValue)
              return
            }
          } catch {
            /* frame not ready */
          }
          timer = window.setTimeout(() => void tick(), 250)
        }
        void tick()
      } catch (e) {
        setError((e as Error).name === 'NotAllowedError' ? 'Permiso de cámara denegado.' : 'No se pudo abrir la cámara en este dispositivo.')
      }
    })()
    return () => {
      stopped = true
      window.clearTimeout(timer)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [open, onCode])

  return (
    <Sheet open={open} onClose={onClose} title="Escanear código de barras">
      {error ? (
        <p className="py-6 text-center text-sm text-bad">{error}</p>
      ) : (
        <div className="relative overflow-hidden rounded-2xl bg-black">
          <video ref={videoRef} className="aspect-[4/3] w-full object-cover" playsInline muted />
          <div className="pointer-events-none absolute inset-x-8 top-1/2 h-0.5 -translate-y-1/2 bg-accent/80 shadow-[0_0_12px_rgb(var(--accent))]" />
        </div>
      )}
      <p className="mt-3 text-center text-xs text-muted">Apunta al código. La imagen no se guarda ni se envía.</p>
    </Sheet>
  )
}
