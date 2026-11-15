// Builds a debug APK from the Capacitor project (run `npm run build:android` first).
// Finds the Android SDK and a JDK 21 when ANDROID_HOME / JAVA_HOME are not set, then runs Gradle.
// Prints the APK path only if Gradle actually produced it.
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const androidDir = join(root, 'android')
const win = process.platform === 'win32'
const env = { ...process.env }

function firstExisting(paths) {
  return paths.find((p) => p && existsSync(p)) ?? null
}

const sdk = firstExisting([
  env.ANDROID_HOME,
  env.ANDROID_SDK_ROOT,
  win ? join(env.LOCALAPPDATA ?? '', 'Android', 'Sdk') : null,
  join(homedir(), 'Library', 'Android', 'sdk'),
  join(homedir(), 'Android', 'Sdk'),
])
if (!sdk) {
  console.error('[apk] No se encontró el Android SDK. Instala Android Studio o define ANDROID_HOME.')
  process.exit(1)
}
env.ANDROID_HOME = sdk

function findJdk21() {
  if (env.JAVA_HOME && existsSync(env.JAVA_HOME)) return env.JAVA_HOME
  const pf = env.ProgramFiles ?? 'C:/Program Files'
  const bases = win ? [join(pf, 'Eclipse Adoptium'), join(pf, 'Java'), join(pf, 'Microsoft')] : ['/usr/lib/jvm', '/Library/Java/JavaVirtualMachines']
  for (const b of bases) {
    if (!existsSync(b)) continue
    const hit = readdirSync(b).find((d) => /(^|[^0-9])21[.\-]/.test(d))
    if (hit) return join(b, hit, existsSync(join(b, hit, 'Contents', 'Home')) ? 'Contents/Home' : '')
  }
  return null
}
const jdk = findJdk21()
if (jdk) env.JAVA_HOME = jdk
else console.warn('[apk] JAVA_HOME no definido y no se encontró un JDK 21; se usará el java del PATH.')

// local.properties is machine-specific (gitignored).
// Forward slashes are valid for Gradle on Windows and avoid escaping in .properties.
writeFileSync(join(androidDir, 'local.properties'), `sdk.dir=${sdk.split(String.fromCharCode(92)).join('/')}\n`)

console.log(`[apk] SDK: ${sdk}`)
console.log(`[apk] JDK: ${env.JAVA_HOME ?? '(PATH)'}`)
const gradlew = join(androidDir, win ? 'gradlew.bat' : 'gradlew')
const r = spawnSync(gradlew, ['assembleDebug', '--no-daemon'], { cwd: androidDir, env, stdio: 'inherit', shell: win })
const apk = join(androidDir, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk')
if (r.status !== 0 || !existsSync(apk)) {
  console.error('[apk] Gradle terminó con error; no se generó el APK.')
  process.exit(r.status || 1)
}
console.log(`[apk] APK de depuración: ${apk} (${(statSync(apk).size / 1048576).toFixed(1)} MB)`)
