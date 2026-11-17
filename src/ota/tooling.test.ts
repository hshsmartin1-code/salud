import { describe, expect, it } from 'vitest'
import { signedFixture, TEST_BYTES } from './test-fixtures'
import { verifyBundle, verifyManifest } from './manifest'
import { readOtaConfig } from './config'

// App tsconfig deliberately excludes Node globals. Only these tests load Node builtins.
const { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } = await import('node:fs' as string) as {
  mkdtempSync(prefix: string): string; mkdirSync(path: string, options?: { recursive: boolean }): void; writeFileSync(path: string, text: string): void
  rmSync(path: string, options?: { recursive: boolean; force: boolean }): void; readFileSync(path: string, encoding: string): string
}
const { tmpdir } = await import('node:os' as string) as { tmpdir(): string }
const { resolve } = await import('node:path' as string) as { resolve(...paths: string[]): string }
const { inflateRawSync } = await import('node:zlib' as string) as { inflateRawSync(bytes: Uint8Array): Uint8Array }

type Env = Record<string, string>
type Expected = { manifestUrl: string; keys: { id: string; x: string }[] }
const config = await import('../../scripts/ota-config.mjs' as string) as {
  parseEnvFile(text: string): Env; readAndroidEnv(): Env; channelEnv(env: Env, channel: string): Env; manifestUrlFor(env: Env, channel: string): string
  zipUrlFor(env: Env, channel: string, version: string): string; ownerRepo(url: string): { owner: string; repo: string }; gradleVersionCode(text: string): number
  trustedKeys(env: Env): { id: string; x: string }[]; expectedBundleConfig(env: Env, channel: string): Expected
  bundleConfigProblems(files: { name: string; bytes: Uint8Array }[], expected: Expected): string[]; OTA_ENV_NAMES: string[]
}
type BuildCtx = { root: string; env: Env; packageVersion: string; gradleText: string; dirty: boolean; hasLocalEnv: boolean }
type Plan = { channel: string; out: string; minNative: number; version: string; zipUrl: string; env: Env; noSync: boolean; steps: [string, string[]][] }
const build = await import('../../scripts/ota-build.mjs' as string) as {
  parseBuildArgs(argv: string[]): Record<string, string | true>; planBuild(options: Record<string, string | true>, ctx: BuildCtx): Plan
  buildEnvironment(base: Record<string, string>, plan: Plan): Record<string, string>; verifySignedManifest(text: string, keys: Record<string, JsonWebKey>): Promise<void>; hasGoogleApiKey(text: string): boolean
}
const tooling = await import('../../scripts/ota-release.mjs' as string) as {
  releaseContext(): { packageVersion: string; appVersion: string; env: Env }
  makeZip(files: { name: string; bytes: Uint8Array }[]): Uint8Array<ArrayBuffer>
  readAndroidDist(directory: string): { name: string; bytes: Uint8Array }[]
  release(options: Record<string, string>, context?: { packageVersion: string; appVersion: string; env: Env }): Promise<unknown>
  privateMedia(path: string): boolean
  digest(bytes: Uint8Array<ArrayBuffer>): Promise<string>
}
const signing = await import('../../scripts/ota-sign.mjs' as string) as { assertExternalPath(path: string): string }
const bad = await import('../../scripts/ota-make-bad.mjs' as string) as { badVariants(m: unknown, bytes: Uint8Array): { name: string; manifest: unknown; zip: Uint8Array<ArrayBuffer>; wrongSignature?: boolean }[] }

describe('offline release tooling', () => {
  it('packages root index.html and assets as an interoperable deflate ZIP with a central directory', async () => {
    const zip = tooling.makeZip([{ name: 'index.html', bytes: TEST_BYTES }, { name: 'assets/app.js', bytes: new TextEncoder().encode('app') }])
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
    expect(view.getUint32(0, true)).toBe(0x04034b50)
    const nameLength = view.getUint16(26, true)
    expect(new TextDecoder().decode(zip.subarray(30, 30 + nameLength))).toBe('index.html')
    const compressedSize = view.getUint32(18, true)
    expect(new Uint8Array(inflateRawSync(zip.subarray(30 + nameLength, 30 + nameLength + compressedSize)))).toEqual(TEST_BYTES)
    const end = zip.length - 22
    expect(view.getUint32(end, true)).toBe(0x06054b50)
    expect(view.getUint16(end + 10, true)).toBe(2)
    const central = view.getUint32(end + 16, true)
    expect(view.getUint32(central, true)).toBe(0x02014b50)
    expect(view.getUint32(central + 16, true)).toBe(view.getUint32(14, true))
    const f = await signedFixture({ size: zip.length, sha256: await tooling.digest(zip) })
    await expect(verifyBundle(zip, await verifyManifest(f.signed, f.config.publicKeys))).resolves.toBeUndefined()
  })
  it.each(['private-media/photo.png', 'assets/PRIVATE-MEDIA/file', 'personal.private.json', 'assets/x.private.json', '../escape'])('refuses private/traversal path %s', (name) => {
    expect(() => tooling.makeZip([{ name, bytes: TEST_BYTES }])).toThrow()
  })
  it('refuses any key/output inside this repository, including a missing path', async () => {
    expect(() => signing.assertExternalPath(resolve('src/ota/no-key.jwk'))).toThrow('FUERA')
    expect(() => signing.assertExternalPath(resolve('dist'))).toThrow('FUERA')
    await expect(tooling.release({ out: resolve('dist'), 'key-file': resolve('none') })).rejects.toThrow('FUERA')
  })
  it('reads only an Android layout and refuses private media instead of silently omitting it', () => {
    const root = mkdtempSync(resolve('.ota-tooling-test-'))
    try {
      writeFileSync(resolve(root, 'index.html'), '<script src="./assets/app.js"></script>')
      mkdirSync(resolve(root, 'assets')); writeFileSync(resolve(root, 'assets/app.js'), 'app')
      expect(tooling.readAndroidDist(root).map((f) => f.name)).toEqual(['assets/app.js', 'index.html'])
      writeFileSync(resolve(root, 'sw.js'), 'sw')
      expect(() => tooling.readAndroidDist(root)).toThrow('Android')
      rmSync(resolve(root, 'sw.js'))
      mkdirSync(resolve(root, 'private-media')); writeFileSync(resolve(root, 'private-media/photo.txt'), 'synthetic fixture')
      expect(() => tooling.readAndroidDist(root)).toThrow('privado')
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
  it('derives all eight bad cases without mutating the good release and signs with the real signer', async () => {
    const f = await signedFixture()
    const variants = bad.badVariants(f.manifest, TEST_BYTES)
    expect(variants.map((v) => v.name)).toEqual(['wrong-signature', 'corrupted-zip', 'wrong-size', 'future-schema', 'too-new-native', 'downgrade', 'http-url', 'foreign-host'])
    const corrupt = variants.find((v) => v.name === 'corrupted-zip')!
    await expect(verifyBundle(corrupt.zip, f.manifest)).rejects.toMatchObject({ code: 'integrity' })
    expect(TEST_BYTES[0]).toBe(new TextEncoder().encode('b')[0])
    const wrongSize = await verifyManifest(await f.sign(variants.find((v) => v.name === 'wrong-size')!.manifest), f.config.publicKeys)
    await expect(verifyBundle(TEST_BYTES, wrongSize)).rejects.toMatchObject({ code: 'integrity' })
  })
})

// ---- Channel-aware tooling (V3.2): .env.android, ota-build.mjs and the new refusals of ota-release.mjs. Nothing builds or touches the network. ----
const androidEnv = config.readAndroidEnv()
const GRADLE = 'android {\n    defaultConfig {\n        applicationId saludDev ? "app.salud.personal.dev" : "app.salud.personal"\n        versionCode 7\n        versionName "3.1.0"\n    }\n    if (saludDev) {\n        defaultConfig { versionCode 8 }\n    }\n}\n'
const EXTERNAL = (name: string) => resolve(tmpdir(), `salud-ota-test-${name}`) // never created: every refusal below happens before any file is read or written
const baseOptions = (over: Record<string, string | true> = {}): Record<string, string | true> =>
  ({ channel: 'beta', out: EXTERNAL('out'), 'key-file': EXTERNAL('key.jwk'), 'key-id': 'k2026a', notes: 'Notas de prueba.', ...over })
const ctx = (over: Partial<BuildCtx> = {}): BuildCtx => ({ root: resolve('.'), env: androidEnv, packageVersion: '3.2.0', gradleText: GRADLE, dirty: false, hasLocalEnv: true, ...over })

describe('.env.android (public configuration of the Android build)', () => {
  it('feeds readOtaConfig: enabled, stable, two keys, https, no private member, manifest host in the allow-list', () => {
    const cfg = readOtaConfig({ ...androidEnv })
    expect(cfg.configurationError).toBeUndefined()
    expect(cfg.enabled).toBe(true)
    expect(cfg.channel).toBe('stable')
    expect(cfg.distribution).toBe('sideload')
    expect(Object.keys(cfg.publicKeys)).toEqual(['k2026a', 'k2026b'])
    for (const key of Object.values(cfg.publicKeys)) { expect('d' in key).toBe(false); expect(key).toMatchObject({ kty: 'EC', crv: 'P-256' }) }
    const url = new URL(cfg.manifestUrl)
    expect(url.protocol).toBe('https:')
    expect(cfg.allowedHosts).toContain(url.host)
    expect(cfg.allowedHosts).toEqual(['github.com', 'release-assets.githubusercontent.com'])
    expect(cfg.devHttp).toBe(false)
    expect(cfg.manifestUrl).toMatch(/\/releases\/download\/ota-stable\/manifest\.json$/)
  })
  it('the dev escape cannot be switched on by this file', () => {
    expect(Object.keys(androidEnv).some((k) => /DEV_HTTP/.test(k))).toBe(false)
    expect(readOtaConfig({ ...androidEnv, VITE_OTA_DEV_HTTP: '1' }).devHttp).toBe(false) // DEV is not true in a build
  })
  it('parses quotes, comments and blank lines', () => {
    expect(config.parseEnvFile('# c\n\nA=1\nB=\'{"x":1}\'\nC="two words"\r\nD=http://h/p=q\n')).toEqual({ A: '1', B: '{"x":1}', C: 'two words', D: 'http://h/p=q' })
    expect(() => config.parseEnvFile('NOEQUALS')).toThrow()
  })
})

describe('channel configuration', () => {
  it('stable is exactly .env.android', () => {
    const env = config.channelEnv(androidEnv, 'stable')
    for (const name of config.OTA_ENV_NAMES) expect(env[name]).toBe(androidEnv[name])
  })
  it('beta keeps keys, hosts and distribution, and only changes the channel and ota-stable -> ota-beta in the manifest URL', () => {
    const env = config.channelEnv(androidEnv, 'beta')
    expect(env.VITE_OTA_CHANNEL).toBe('beta')
    expect(env.VITE_OTA_MANIFEST_URL).toBe(androidEnv.VITE_OTA_MANIFEST_URL.replace('/ota-stable/', '/ota-beta/'))
    expect(env.VITE_OTA_MANIFEST_URL).not.toContain('ota-stable')
    for (const name of ['VITE_OTA_ENABLED', 'VITE_OTA_PUBLIC_KEYS', 'VITE_OTA_ALLOWED_HOSTS', 'VITE_DISTRIBUTION']) expect(env[name]).toBe(androidEnv[name])
    expect(readOtaConfig({ ...env })).toMatchObject({ enabled: true, channel: 'beta' })
  })
  it('derives owner/repo from the stable manifest URL and builds the ZIP URL of each channel', () => {
    const { owner, repo } = config.ownerRepo(androidEnv.VITE_OTA_MANIFEST_URL)
    expect(config.zipUrlFor(androidEnv, 'stable', '3.2.0')).toBe(`https://github.com/${owner}/${repo}/releases/download/ota-stable/salud-3.2.0.zip`)
    expect(config.zipUrlFor(androidEnv, 'beta', '3.2.0')).toBe(`https://github.com/${owner}/${repo}/releases/download/ota-beta/salud-3.2.0.zip`)
    expect(() => config.ownerRepo('https://example.test/ota-stable/manifest.json')).toThrow()
    expect(() => config.ownerRepo('https://github.com/a/b/releases/download/ota-beta/manifest.json')).toThrow()
    expect(() => config.zipUrlFor(androidEnv, 'nightly', '3.2.0')).toThrow()
    expect(() => config.zipUrlFor(androidEnv, 'beta', '3.2')).toThrow()
  })
  it('refuses a .env.android that is not the stable channel or lacks a variable', () => {
    expect(() => config.channelEnv({ ...androidEnv, VITE_OTA_CHANNEL: 'beta' }, 'stable')).toThrow('stable')
    const without = { ...androidEnv }
    delete without.VITE_OTA_ALLOWED_HOSTS
    expect(() => config.channelEnv(without, 'beta')).toThrow('VITE_OTA_ALLOWED_HOSTS')
  })
  it('reads the versionCode of the normal build, not the Dev override, from the real build.gradle too', () => {
    expect(config.gradleVersionCode(GRADLE)).toBe(7)
    expect(() => config.gradleVersionCode('android {}')).toThrow()
    expect(config.gradleVersionCode(readFileSync(resolve('android/app/build.gradle'), 'utf8'))).toBeGreaterThanOrEqual(7)
  })
})

describe('ota-build.mjs plan', () => {
  it('parses the CLI: values, the two boolean flags', () => {
    expect(build.parseBuildArgs(['--channel', 'beta', '--out', 'x', '--allow-dirty', '--notes', 'Mejoras.', '--no-sync'])).toEqual({ channel: 'beta', out: 'x', 'allow-dirty': true, notes: 'Mejoras.', 'no-sync': true })
    expect(() => build.parseBuildArgs(['--channel'])).toThrow('valor')
    expect(() => build.parseBuildArgs(['--channel', '--out'])).toThrow('valor')
    expect(() => build.parseBuildArgs(['--bogus', '1'])).toThrow('desconocida')
    expect(() => build.parseBuildArgs(['stray'])).toThrow('inesperado')
    expect(() => build.parseBuildArgs(['--channel', 'a', '--channel', 'b'])).toThrow('repetido')
  })
  it.each(['stable', 'beta'])('plans the %s build: version from package.json, minNative from build.gradle, ZIP URL of the channel, no cap sync', (channel) => {
    const plan = build.planBuild(baseOptions({ channel }), ctx())
    expect(plan).toMatchObject({ channel, version: '3.2.0', minNative: 7 })
    expect(plan.zipUrl).toBe(config.zipUrlFor(androidEnv, channel, '3.2.0'))
    expect(plan.env).toEqual(config.channelEnv(androidEnv, channel))
    expect(plan.steps).toEqual([['npx', ['tsc', '-b']], ['node', ['scripts/copy-ocr-assets.mjs']], ['npx', ['vite', 'build', '--mode', 'android']]])
    expect(JSON.stringify(plan.steps)).not.toMatch(/cap|sync|gradle/i)
  })
  it('--min-native overrides the gradle versionCode', () => {
    expect(build.planBuild(baseOptions({ 'min-native': '9' }), ctx()).minNative).toBe(9)
  })
  it.each<[string, Record<string, string | true>, Partial<BuildCtx>, string]>([
    ['no channel', { channel: '' }, {}, 'stable o beta'],
    ['unknown channel', { channel: 'nightly' }, {}, 'stable o beta'],
    ['no key file', { 'key-file': '' }, {}, '--key-file'],
    ['no key id', { 'key-id': '' }, {}, '--key-id'],
    ['no notes', { notes: '' }, {}, '--notes'],
    ['no output', { out: '' }, {}, '--out'],
    ['output inside the repository', { out: resolve('dist-ota') }, {}, 'FUERA'],
    ['key file inside the repository', { 'key-file': resolve('ota-keys/k.jwk') }, {}, 'FUERA'],
    ['relative output', { out: 'releases' }, {}, 'absoluta'],
    ['key id that the app does not trust', { 'key-id': 'k2099z' }, {}, 'no es una clave de confianza'],
    ['bad key id characters', { 'key-id': 'a b' }, {}, '--key-id'],
    ['bad min-native', { 'min-native': '0' }, {}, 'entero positivo'],
    ['dirty working tree', {}, { dirty: true }, 'sin confirmar'],
    ['no .env.local (sync would be switched off)', {}, { hasLocalEnv: false }, 'sincronización'],
    ['no gradle versionCode', {}, { gradleText: 'android {}' }, 'versionCode'],
    ['package.json without semver', {}, { packageVersion: 'abc' }, 'semver'],
  ])('refuses: %s', (_name, over, ctxOver, message) => {
    expect(() => build.planBuild(baseOptions(over), ctx(ctxOver))).toThrow(message)
  })
  it('--allow-dirty and --no-sync lift exactly their own refusal', () => {
    expect(() => build.planBuild(baseOptions({ 'allow-dirty': true }), ctx({ dirty: true }))).not.toThrow()
    expect(() => build.planBuild(baseOptions({ 'no-sync': true }), ctx({ hasLocalEnv: false }))).not.toThrow()
    expect(() => build.planBuild(baseOptions({ 'allow-dirty': true }), ctx({ hasLocalEnv: false }))).toThrow('sincronización')
  })
  it('--no-sync builds a bundle without any Firebase web configuration (a test bundle is published where anyone can read it)', () => {
    const withSync = build.planBuild(baseOptions(), ctx())
    expect(withSync.noSync).toBe(false)
    expect(withSync.env.VITE_SYNC_DISABLED).toBeUndefined()
    const plan = build.planBuild(baseOptions({ 'no-sync': true }), ctx())
    expect(plan.noSync).toBe(true)
    const env = build.buildEnvironment({ VITE_SYNC_DISABLED: '0', VITE_FIREBASE_API_KEY: 'inherited' }, plan)
    expect(env.VITE_SYNC_DISABLED).toBe('1')
    for (const name of ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_APP_ID', 'VITE_FIREBASE_MESSAGING_SENDER_ID']) expect(env[name]).toBe('off')
    expect(build.hasGoogleApiKey('x="AIza' + 'b'.repeat(35) + '"')).toBe(true)
    expect(build.hasGoogleApiKey('AIza-too-short')).toBe(false)
  })
  it('the build environment drops anything inherited that could change the OTA configuration or the mode, then sets the channel values', () => {
    const plan = build.planBuild(baseOptions(), ctx())
    const env = build.buildEnvironment({ PATH: 'p', NODE_ENV: 'development', VITE_OTA_DEV_HTTP: '1', SALUD_DEV: '1', VITE_SYNC_DISABLED: '1', VITE_OTA_CHANNEL: 'stable', VITE_DISTRIBUTION: 'play', VITE_OTA_MANIFEST_URL: 'http://localhost:4156/m.json' }, plan)
    expect(env.PATH).toBe('p')
    for (const gone of ['NODE_ENV', 'VITE_OTA_DEV_HTTP', 'SALUD_DEV', 'VITE_SYNC_DISABLED']) expect(env[gone]).toBeUndefined()
    expect(env).toMatchObject(config.channelEnv(androidEnv, 'beta'))
  })
  it('verifies the written manifest against the trusted public key, and refuses a key that does not match', async () => {
    const f = await signedFixture()
    await expect(build.verifySignedManifest(JSON.stringify(f.signed), f.config.publicKeys)).resolves.toBeUndefined()
    const other = await signedFixture()
    await expect(build.verifySignedManifest(JSON.stringify(f.signed), other.config.publicKeys)).rejects.toThrow('no verifica')
    await expect(build.verifySignedManifest(JSON.stringify({ ...f.signed, keyId: 'nope' }), f.config.publicKeys)).rejects.toThrow('no es de confianza')
  })
})

describe('ota-release.mjs refusals', () => {
  const expectedStable = config.expectedBundleConfig(androidEnv, 'stable')
  const bytes = (text: string) => new TextEncoder().encode(text)
  const bundleJs = (parts: string[]) => [{ name: 'assets/app.js', bytes: bytes(parts.join(';')) }, { name: 'index.html', bytes: bytes('<script src="./assets/app.js"></script>') }]
  const keysLiteral = JSON.stringify(androidEnv.VITE_OTA_PUBLIC_KEYS) // how Vite bakes the variable into the JavaScript: an escaped string literal
  const good = (channel: string) => bundleJs([`const u=${JSON.stringify(config.manifestUrlFor(androidEnv, channel))}`, `const k=${keysLiteral}`])

  it('accepts a bundle that carries the manifest URL of the channel and every trusted key', () => {
    expect(config.bundleConfigProblems(good('stable'), expectedStable)).toEqual([])
    expect(config.bundleConfigProblems(good('beta'), config.expectedBundleConfig(androidEnv, 'beta'))).toEqual([])
  })
  it('refuses a bundle built without OTA configuration (updates would be off for good)', () => {
    expect(config.bundleConfigProblems(bundleJs(['const a=1']), expectedStable)).toHaveLength(3)
  })
  it('refuses a bundle for the other channel, in both directions', () => {
    expect(config.bundleConfigProblems(good('beta'), expectedStable)).toEqual([expect.stringContaining('URL del manifiesto')])
    expect(config.bundleConfigProblems(good('stable'), config.expectedBundleConfig(androidEnv, 'beta'))).toEqual([expect.stringContaining('ota-beta')])
  })
  it('refuses a bundle missing any single trusted key id, or whose key material differs', () => {
    const [a, b] = expectedStable.keys
    const url = `const u=${JSON.stringify(expectedStable.manifestUrl)}`
    const onlyA = JSON.stringify(JSON.stringify({ [a.id]: { kty: 'EC', crv: 'P-256', x: a.x, y: 'y' } }))
    expect(config.bundleConfigProblems(bundleJs([url, `const k=${onlyA}`]), expectedStable)).toEqual([expect.stringContaining(b.id)])
    const wrongX = JSON.stringify(JSON.stringify({ [a.id]: { x: 'A'.repeat(43) }, [b.id]: { x: b.x } }))
    expect(config.bundleConfigProblems(bundleJs([url, `const k=${wrongX}`]), expectedStable)).toEqual([expect.stringContaining(a.id)])
  })
  it('ignores non-JavaScript files when looking for the configuration', () => {
    expect(config.bundleConfigProblems([{ name: 'index.html', bytes: bytes(expectedStable.manifestUrl + keysLiteral) }], expectedStable)).toHaveLength(3)
  })

  const releaseOptions = (dist: string, over: Record<string, string> = {}) => ({ dist, version: '3.2.0', channel: 'stable', 'min-native': '7', url: config.zipUrlFor(androidEnv, 'stable', '3.2.0'),
    notes: 'Notas.', 'key-id': 'k2026a', 'key-file': EXTERNAL('key.jwk'), out: EXTERNAL('release'), ...over })
  const context = (over: Partial<{ packageVersion: string; appVersion: string }> = {}) => ({ packageVersion: '3.2.0', appVersion: '3.2.0', env: androidEnv, ...over })
  const withDist = async (files: { name: string; bytes: Uint8Array }[], run: (dist: string) => Promise<void>) => {
    const root = mkdtempSync(resolve('.ota-tooling-test-'))
    try {
      for (const f of files) {
        const dir = resolve(root, f.name.split('/').slice(0, -1).join('/'))
        mkdirSync(dir, { recursive: true })
        writeFileSync(resolve(root, f.name), new TextDecoder().decode(f.bytes))
      }
      await run(root)
    } finally { rmSync(root, { recursive: true, force: true }) }
  }

  it('refuses --version different from package.json or from APP_VERSION, before reading anything', async () => {
    await expect(tooling.release(releaseOptions(resolve('missing-dist'), { version: '3.3.0' }), context())).rejects.toThrow('no coincide')
    await expect(tooling.release(releaseOptions(resolve('missing-dist')), context({ packageVersion: '3.1.0' }))).rejects.toThrow('no coincide')
    await expect(tooling.release(releaseOptions(resolve('missing-dist')), context({ appVersion: '3.1.0' }))).rejects.toThrow('APP_VERSION 3.1.0')
  })
  it('the repository itself declares one version in package.json and APP_VERSION (what releaseContext reads)', () => {
    const real = tooling.releaseContext()
    expect(real.packageVersion).toBe(real.appVersion)
    expect(real.env.VITE_OTA_CHANNEL).toBe('stable')
  })
  it('refuses to package a dist without the OTA configuration, or built for another channel', async () => {
    const html = { name: 'index.html', bytes: bytes('<script src="./a.js"></script>') }
    await withDist([html, { name: 'a.js', bytes: bytes('console.log(1)') }], async (dist) => {
      await expect(tooling.release(releaseOptions(dist), context())).rejects.toThrow('El dist no sirve para el canal stable')
    })
    await withDist([html, { name: 'a.js', bytes: good('beta')[0].bytes }], async (dist) => {
      await expect(tooling.release(releaseOptions(dist), context())).rejects.toThrow('URL del manifiesto')
    })
  })
})
