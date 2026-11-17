import { describe, expect, it } from 'vitest'

// App tsconfig deliberately excludes Node globals. Only these tests load Node builtins.
const { readFileSync } = await import('node:fs' as string) as { readFileSync(path: string, encoding: string): string }
const { resolve } = await import('node:path' as string) as { resolve(...p: string[]): string }
const { spawnSync } = await import('node:child_process' as string) as { spawnSync(cmd: string, args: string[], options: { encoding: string }): { status: number | null; stdout: string; stderr: string; error?: Error } }

// scripts/verify-android-apk.py: the pure OTA check, exercised with synthetic bundles (no APK, no Android tools).
const python = spawnSync('python', ['--version'], { encoding: 'utf8' })
const hasPython = !python.error && python.status === 0
describe.skipIf(!hasPython)('verify-android-apk.py OTA bundle check', { timeout: 60_000 }, () => { // each case starts a Python process
  const run = (name: string, body: string) => {
    const code = [
      'import importlib.util, json, sys',
      `spec = importlib.util.spec_from_file_location('v', ${JSON.stringify(resolve('scripts/verify-android-apk.py'))})`,
      'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
      'url, ids = m.ota_expectations("stable"); beta_url, _ = m.ota_expectations("beta")',
      "keys = m.read_env_android()['VITE_OTA_PUBLIC_KEYS']",
      "good = ('const u=' + json.dumps(url) + ';const k=' + json.dumps(keys) + ';').encode()",
      body,
    ].join('\n')
    const r = spawnSync('python', ['-I', '-B', '-c', code], { encoding: 'utf8' })
    expect(r.status, `${name}: ${r.stderr}`).toBe(0)
    return JSON.parse(r.stdout.trim()) as string[]
  }
  it('accepts the stable configuration', () => { expect(run('good', 'print(json.dumps(m.ota_bundle_problems(good, url, ids)))')).toEqual([]) })
  it('requires the stable manifest URL and both key ids', () => {
    expect(run('beta url', 'print(json.dumps(m.ota_bundle_problems(good, beta_url, ids)))')).toHaveLength(1)
    expect(run('no keys', 'print(json.dumps(m.ota_bundle_problems(("const u=" + json.dumps(url)).encode(), url, ids)))')).toHaveLength(2)
    expect(run('beta ok', 'print(json.dumps(m.ota_bundle_problems(good.replace(url.encode(), beta_url.encode()), beta_url, ids)))')).toEqual([])
  })
  it('forbids the local lab, the dev-test key and any private JWK member (either order, plain or escaped)', () => {
    expect(run('lab', 'print(json.dumps(m.ota_bundle_problems(good + b\'"localhost:4156"; "dev-test"\', url, ids)))')).toHaveLength(2)
    const cases = [
      '{"kty":"EC","crv":"P-256","x":"a","y":"b","d":"s"}',
      '{"d":"s","kty":"EC","crv":"P-256"}',
      json({ k: '{"kty":"EC","crv":"P-256","d":"s"}' }),
    ]
    for (const c of cases) expect(run('private', `print(json.dumps(m.ota_bundle_problems(good + ${JSON.stringify(c)}.encode(), url, ids)))`)).toEqual(['a private JWK member appears in the bundle'])
    expect(run('public', 'print(json.dumps(m.ota_bundle_problems(good + b\'{"kty":"EC","crv":"P-256","x":"a","y":"b"}\', url, ids)))')).toEqual([])
  })
  it('versions: the APK follows build.gradle and the interface may be newer than the native shell, never older', () => {
    const call = (apk: string, native: string, ui: string, bundle: string) =>
      `print(json.dumps(m.version_problems(${apk}, ${native}, ${ui}, ${bundle})))`
    const shell = "{'package': 'app.salud.personal', 'versionName': '3.1.1', 'versionCode': '8'}"
    const ui = (pkg: string, app = pkg) => `{'package': '${pkg}', 'app': '${app}'}`
    const js = (v: string) => `b'const v="${v}";'`
    expect(run('newer ui', call(shell, shell, ui('3.2.0'), js('3.2.0')))).toEqual([])
    expect(run('same', call(shell, shell, ui('3.1.1'), js('3.1.1')))).toEqual([])
    expect(run('older ui', call(shell, shell, ui('3.0.0'), js('3.0.0')))).toHaveLength(1)
    expect(run('stale bundle', call(shell, shell, ui('3.2.0'), js('3.1.1')))).toHaveLength(1)
    expect(run('app version', call(shell, shell, ui('3.2.0', '3.1.1'), js('3.2.0')))).toHaveLength(1)
    expect(run('name', call("{'package': 'app.salud.personal', 'versionName': '3.2.0', 'versionCode': '8'}", shell, ui('3.2.0'), js('3.2.0')))).toHaveLength(1)
    expect(run('code', call("{'package': 'app.salud.personal', 'versionName': '3.1.1', 'versionCode': '7'}", shell, ui('3.2.0'), js('3.2.0')))).toHaveLength(1)
    expect(run('package', call("{'package': 'app.salud.personal.dev', 'versionName': '3.1.1', 'versionCode': '8'}", shell, ui('3.2.0'), js('3.2.0')))).toHaveLength(1)
    expect(run('not semver', call(shell, shell, ui('3.2'), js('3.2')))).toHaveLength(1)
  })
  it('exposes --dev-beta next to --dev', () => {
    const text = readFileSync(resolve('scripts/verify-android-apk.py'), 'utf8')
    expect(text).toContain("'--dev-beta'")
    expect(text).toContain("'--dev'")
    expect(text).toContain('app.salud.personal.dev')
  })
})
function json(value: { k: string }) { return JSON.stringify(value.k) }
