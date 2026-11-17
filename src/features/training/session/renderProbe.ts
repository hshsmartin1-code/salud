/**
 * Test-only render counter. When an end-to-end test defines `window.__saludRenderProbe = {}`, each
 * probed component adds one per render under its key; otherwise this is a single property read.
 * Used by e2e/v3-session.spec.ts to prove that typing in one set row re-renders only that row.
 */
export function probeRender(key: string): void {
  const p = (globalThis as { __saludRenderProbe?: Record<string, number> }).__saludRenderProbe
  if (p) p[key] = (p[key] ?? 0) + 1
}
