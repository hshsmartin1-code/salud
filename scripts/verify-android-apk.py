"""Verify version, signing, every synced frontend file and (when configured) the Firebase setup of
the debug APK. No device needed. Secrets are never printed: only public identifiers and booleans."""
import argparse
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parent.parent


FIREBASE_PLUGIN = b'Lio/capawesome/capacitorjs/plugins/firebase/authentication/FirebaseAuthenticationPlugin;'


def resource_strings(aapt: Path, apk: Path, env: dict) -> dict:
    """String resources of the APK (name -> value). Used only for comparisons, never printed."""
    out = subprocess.check_output([str(aapt), 'dump', '--values', 'resources', str(apk)], text=True, env=env, errors='replace')
    values: dict = {}
    name = None
    for line in out.splitlines():
        m = re.search(r'spec resource 0x[0-9a-f]+ [\w.]+:string/(\w+)', line) or re.search(r'resource 0x[0-9a-f]+ [\w.]+:string/(\w+):', line)
        if m:
            name = m.group(1)
            continue
        v = re.search(r'\(string\d*\) "(.*)"', line)
        if v and name and name not in values:
            values[name] = v.group(1)
            name = None
    return values


def check_firebase(archive: zipfile.ZipFile, strings: dict, dex_names: list) -> dict:
    services = json.loads((ROOT / 'android/app/google-services.json').read_text(encoding='utf-8'))
    project_id = services['project_info']['project_id']
    client = next(c for c in services['client'] if c['client_info']['android_client_info']['package_name'] == 'app.salud.personal')
    web_clients = [o['client_id'] for o in client.get('oauth_client', []) if o.get('client_type') == 3]
    if not any(FIREBASE_PLUGIN in archive.read(n) for n in dex_names):
        raise RuntimeError('Compiled Firebase Authentication plugin missing.')
    registry = json.loads(archive.read('assets/capacitor.plugins.json'))
    if not any(p.get('classpath', '').endswith('FirebaseAuthenticationPlugin') for p in registry):
        raise RuntimeError('Firebase Authentication plugin not registered in capacitor.plugins.json.')
    if strings.get('project_id') != project_id:
        raise RuntimeError('google-services resources missing or for another project.')
    if strings.get('google_app_id') != client['client_info']['mobilesdk_app_id']:
        raise RuntimeError('google_app_id does not match google-services.json.')
    if not web_clients or strings.get('default_web_client_id') not in web_clients:
        raise RuntimeError('default_web_client_id (web OAuth client) missing.')
    # The web SDK inside the WebView must point at the same project, never at the emulator demo.
    bundle = b''.join(archive.read(n) for n in archive.namelist() if n.startswith('assets/public/assets/') and n.endswith('.js'))
    if project_id.encode() not in bundle:
        raise RuntimeError('Web Firebase config of this project is not in the bundle (.env.local missing at build time?).')
    return {
        'firebaseProjectId': project_id,
        'firebaseAuthPluginCompiled': True,
        'firebaseAuthPluginRegistered': True,
        'googleServicesResources': True,
        'webOAuthClientPresent': True,
        'webConfigProjectMatches': True,
    }


UPDATER_PLUGIN = b'Lee/forgr/capacitor_updater/CapacitorUpdaterPlugin;'

# A private JWK member next to the P-256 curve, in either order, as plain JSON or as an escaped string literal.
JWK_PRIVATE = re.compile(rb'\\?"crv\\?"\s*:\s*\\?"P-256\\?"[^{}]{0,400}?\\?"d\\?"\s*:|\\?"d\\?"\s*:[^{}]{0,400}?\\?"crv\\?"\s*:\s*\\?"P-256')


def read_env_android() -> dict:
    """Public OTA configuration of the Android build (.env.android): KEY=value lines, optional single/double quotes."""
    values: dict = {}
    for raw in (ROOT / '.env.android').read_text(encoding='utf-8').splitlines():
        line = raw.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        value = value.strip()
        if len(value) >= 2 and value[0] in ("'", '"') and value[-1] == value[0]:
            value = value[1:-1]
        values[key.strip()] = value
    return values


def ota_expectations(channel: str) -> tuple:
    """(manifest URL of the channel, trusted key ids) from .env.android; beta only swaps ota-stable for ota-beta."""
    env = read_env_android()
    url = env['VITE_OTA_MANIFEST_URL']
    if '/ota-stable/' not in url:
        raise RuntimeError('.env.android must describe the stable channel.')
    if channel == 'beta':
        url = url.replace('/ota-stable/', '/ota-beta/')
    return url, list(json.loads(env['VITE_OTA_PUBLIC_KEYS']).keys())


def bundled_js(archive: zipfile.ZipFile) -> bytes:
    return b''.join(archive.read(n) for n in archive.namelist() if n.startswith('assets/public/assets/') and n.endswith('.js'))


def semver(text: str):
    match = re.fullmatch(r'(\d+)\.(\d+)\.(\d+)', text or '')
    return tuple(int(n) for n in match.groups()) if match else None


def version_problems(apk: dict, native: dict, interface: dict, bundle: bytes) -> list:
    """Problems with the versions of an APK (empty list = right). Pure: tested without an APK.

    The native shell and the interface are versioned apart. The APK must carry the package, versionName and
    versionCode of android/app/build.gradle. The interface inside it (package.json, the same as APP_VERSION) may be
    newer than the shell, never older: interface updates reach an installed shell without a new APK, and a bundle
    built from this checkout asks for a native versionCode of at least the one in build.gradle.
    """
    problems = []
    if apk['package'] != native['package']:
        problems.append(f"package is {apk['package']}, expected {native['package']}")
    if apk['versionName'] != native['versionName']:
        problems.append(f"APK versionName is {apk['versionName']}, android/app/build.gradle says {native['versionName']}")
    if str(apk['versionCode']) != str(native['versionCode']):
        problems.append(f"APK versionCode is {apk['versionCode']}, expected {native['versionCode']}")
    if interface['package'] != interface['app']:
        problems.append(f"package.json is {interface['package']} but APP_VERSION is {interface['app']}")
    shell, ui = semver(native['versionName']), semver(interface['package'])
    if shell is None or ui is None:
        problems.append('versions must be plain x.y.z')
    elif ui < shell:
        problems.append(f"the interface ({interface['package']}) is older than the native shell ({native['versionName']})")
    literal = interface['package'].encode()
    if not any(q + literal + q in bundle for q in (b'"', b"'", b'`')):
        problems.append(f"the bundled JavaScript does not carry interface version {interface['package']}")
    return problems


def ota_bundle_problems(bundle: bytes, manifest_url: str, key_ids: list) -> list:
    """Problems with the OTA configuration baked into the bundled JavaScript (empty list = right). Pure: tested without an APK."""
    problems = []
    if manifest_url.encode() not in bundle:
        problems.append(f'manifest URL of the channel is not in the bundle ({manifest_url})')
    for key_id in key_ids:
        if not re.search(re.escape(key_id.encode()) + rb'\\?"\s*:', bundle):
            problems.append(f'trusted key id {key_id} is not in the bundle')
    if b'localhost:4156' in bundle:
        problems.append('the local lab host localhost:4156 is in the bundle')
    if b'dev-test' in bundle:
        problems.append('the dev-test key id is in the bundle')
    if JWK_PRIVATE.search(bundle):
        problems.append('a private JWK member appears in the bundle')
    return problems


def check_release_ota(archive: zipfile.ZipFile) -> dict:
    """The normal APK ships the stable channel: stable manifest URL, both trusted keys, nothing of the lab, no private key."""
    url, key_ids = ota_expectations('stable')
    problems = ota_bundle_problems(bundled_js(archive), url, key_ids)
    if problems:
        raise RuntimeError('OTA configuration of the normal APK is wrong: ' + '; '.join(problems))
    return {'otaStableConfigBaked': True, 'otaKeyIds': key_ids}


def check_dev(archive: zipfile.ZipFile, strings: dict, dex_names: list, badging: str, beta: bool = False) -> dict:
    """Salud Dev: never the real package, no Firebase anywhere, updater plugin present. Lab: OTA on and local-only. Beta: production mode, ota-beta."""
    if "application-label:'Salud Dev'" not in badging:
        raise RuntimeError('Launcher label is not "Salud Dev".')
    dex = b''.join(archive.read(n) for n in dex_names)
    if FIREBASE_PLUGIN in dex:
        raise RuntimeError('Dev APK contains the Firebase Authentication plugin.')
    registry = json.loads(archive.read('assets/capacitor.plugins.json'))
    classpaths = [p.get('classpath', '') for p in registry]
    if any('firebase' in c.lower() for c in classpaths):
        raise RuntimeError('Firebase plugin registered in the Dev APK.')
    if not any(c.endswith('CapacitorUpdaterPlugin') for c in classpaths):
        raise RuntimeError('Updater plugin not registered in capacitor.plugins.json.')
    if UPDATER_PLUGIN not in dex:
        raise RuntimeError('Compiled updater plugin missing.')
    for key in ('project_id', 'google_app_id', 'default_web_client_id', 'gcm_defaultSenderId', 'google_api_key'):
        if key in strings:
            raise RuntimeError(f'Dev APK carries Firebase resource {key}.')
    config = json.loads(archive.read('assets/capacitor.config.json'))
    if config.get('appId') != 'app.salud.personal.dev':
        raise RuntimeError('capacitor.config.json does not name the Dev application id.')
    https_only = config.get('plugins', {}).get('CapacitorUpdater', {}).get('httpsOnly')
    bundle = bundled_js(archive)
    if beta:
        if https_only is not True:
            raise RuntimeError('Dev beta build must keep httpsOnly=true (production mode).')
        url, key_ids = ota_expectations('beta')
        problems = ota_bundle_problems(bundle, url, key_ids)
        if problems:
            raise RuntimeError('OTA configuration of the Dev beta APK is wrong: ' + '; '.join(problems))
        return {
            'devVariant': 'beta', 'launcherLabel': 'Salud Dev', 'firebasePluginPresent': False, 'firebaseResources': False,
            'updaterPluginCompiled': True, 'updaterPluginRegistered': True, 'otaBetaConfigBaked': True, 'otaKeyIds': key_ids,
        }
    if https_only is not False:
        raise RuntimeError('Dev build should allow cleartext only through the dev flag (httpsOnly=false).')
    if b'localhost:4156' not in bundle or b'dev-test' not in bundle:
        raise RuntimeError('OTA test configuration (localhost:4156 / dev-test key) is not baked into the Dev bundle.')
    if JWK_PRIVATE.search(bundle) or b'"d":"' in bundle:
        raise RuntimeError('A private JWK member appears in the bundle.')
    return {
        'devVariant': True, 'launcherLabel': 'Salud Dev', 'firebasePluginPresent': False, 'firebaseResources': False,
        'updaterPluginCompiled': True, 'updaterPluginRegistered': True, 'otaTestConfigBaked': True,
    }


def verify(apk: Path, dev: bool = False, beta: bool = False) -> dict:
    dev = dev or beta
    sdk = Path(os.environ.get('ANDROID_HOME') or os.environ.get('ANDROID_SDK_ROOT') or
               str(Path(os.environ.get('LOCALAPPDATA', '')) / 'Android' / 'Sdk'))
    tool_dirs = sorted((sdk / 'build-tools').glob('*'),
                       key=lambda p: tuple(int(n) for n in re.findall(r'\d+', p.name)), reverse=True)
    tools = next((p for p in tool_dirs if (p / ('aapt.exe' if os.name == 'nt' else 'aapt')).exists()), None)
    if tools is None:
        raise RuntimeError('Android build-tools not found; set ANDROID_HOME.')
    aapt = tools / ('aapt.exe' if os.name == 'nt' else 'aapt')
    apksigner = tools / ('apksigner.bat' if os.name == 'nt' else 'apksigner')
    env = dict(os.environ)
    if os.name == 'nt' and not env.get('JAVA_HOME'):
        jdks = sorted((Path(env.get('ProgramFiles', 'C:/Program Files')) / 'Eclipse Adoptium').glob('jdk-21*'))
        if jdks:
            env['JAVA_HOME'] = str(jdks[-1])
    badging = subprocess.check_output([str(aapt), 'dump', 'badging', str(apk)], text=True, env=env)
    match = re.search(r"package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'", badging)
    if not match:
        raise RuntimeError('APK package metadata unavailable.')
    package, code, version = match.groups()
    interface_version = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version']
    app_version = re.search(r"APP_VERSION = '([^']+)'", (ROOT / 'src/appVersion.ts').read_text(encoding='utf-8')).group(1)
    gradle = (ROOT / 'android/app/build.gradle').read_text(encoding='utf-8')
    native_name = re.search(r'\bversionName\s+"([^"]+)"', gradle).group(1)
    expected_code = re.search(r'\bversionCode\s+(\d+)', gradle).group(1)
    if dev:
        # The Dev variant is one versionCode above the normal build (see android/app/build.gradle).
        # The Dev version code is the gradle default unless this round overrides it (ORG_GRADLE_PROJECT_saludDevCode).
        expected_code = os.environ.get('ORG_GRADLE_PROJECT_saludDevCode') or re.search(r"findProperty\('saludDevCode'\) \?: '(\d+)'", gradle).group(1)
    expected_package = 'app.salud.personal.dev' if dev else 'app.salud.personal'
    with zipfile.ZipFile(apk) as archive:
        problems = version_problems(
            {'package': package, 'versionName': version, 'versionCode': code},
            {'package': expected_package, 'versionName': native_name, 'versionCode': expected_code},
            {'package': interface_version, 'app': app_version}, bundled_js(archive))
    if problems:
        raise RuntimeError('Unexpected package or versions: ' + '; '.join(problems))
    min_sdk = re.search(r"sdkVersion:'(\d+)'", badging)
    if not min_sdk or min_sdk.group(1) != '26':
        raise RuntimeError('Unexpected minimum Android SDK.')
    signing = subprocess.check_output([str(apksigner), 'verify', '--verbose', '--print-certs', str(apk)], text=True, env=env)
    cert = re.search(r'Signer #1 certificate SHA-256 digest: (\w+)', signing)
    if not cert:
        raise RuntimeError('APK signature certificate unavailable.')
    assets = ROOT / 'android/app/src/main/assets/public'
    checked = 0
    decompressed = 0
    with zipfile.ZipFile(apk) as archive:
        if archive.testzip() is not None:
            raise RuntimeError('APK ZIP checksum failed.')
        expected_names = set()
        for src in assets.rglob('*'):
            if not src.is_file():
                continue
            # build.gradle deliberately excludes dotfiles (for example GitHub Pages' .nojekyll).
            if any(part.startswith('.') for part in src.relative_to(assets).parts):
                continue
            name = 'assets/public/' + src.relative_to(assets).as_posix()
            data = src.read_bytes()
            if name not in archive.namelist() and name.endswith('.gz'):
                name = name[:-3]
                data = gzip.decompress(data)
                decompressed += 1
            if archive.read(name) != data:
                raise RuntimeError(f'Stale or altered frontend asset: {name}')
            expected_names.add(name)
            checked += 1
        extra = {n for n in archive.namelist() if n.startswith('assets/public/') and not n.endswith('/')} - expected_names
        if extra:
            raise RuntimeError(f'Unexpected frontend files in APK: {sorted(extra)}')
        notices = archive.read('assets/public/THIRD_PARTY_NOTICES.txt')
        if notices != (ROOT / 'THIRD_PARTY_NOTICES.md').read_bytes():
            raise RuntimeError('Third-party notices are stale.')
        if 'assets/public/sw.js' in archive.namelist():
            raise RuntimeError('Android APK unexpectedly contains the web service worker.')
        dex_names = [n for n in archive.namelist() if re.fullmatch(r'classes\d*\.dex', n)]
        plugin = b'Lapp/salud/personal/healthconnect/HealthConnectPlugin;'
        if not any(plugin in archive.read(n) for n in dex_names):
            raise RuntimeError('Compiled Health Connect plugin missing.')
        if "uses-permission: name='android.permission.REQUEST_INSTALL_PACKAGES'" in badging:
            raise RuntimeError('APK must not request REQUEST_INSTALL_PACKAGES.')
        firebase = {'firebaseConfigured': False}
        extra_dev = {}
        if dev:
            extra_dev = check_dev(archive, resource_strings(aapt, apk, env), dex_names, badging, beta)
        else:
            extra_dev = check_release_ota(archive)
        if not dev and (ROOT / 'android/app/google-services.json').exists():
            firebase = {'firebaseConfigured': True, **check_firebase(archive, resource_strings(aapt, apk, env), dex_names)}
        index_hash = hashlib.sha256(archive.read('assets/public/index.html')).hexdigest()
    return {
        'package': package, 'versionName': version, 'versionCode': int(code), 'interfaceVersion': interface_version,
        'updatesFromThisCheckoutNeedVersionCode': int(re.search(r'\bversionCode\s+(\d+)', gradle).group(1)), 'minSdk': int(min_sdk.group(1)),
        'apkBytes': apk.stat().st_size, 'apkSha256': hashlib.sha256(apk.read_bytes()).hexdigest(),
        'signatureVerified': True, 'certificateSha256': cert.group(1),
        'frontendFilesVerified': checked, 'gzipAssetsExpandedByAapt': decompressed,
        'indexSha256': index_hash, 'noticesSha256': hashlib.sha256(notices).hexdigest(),
        'healthConnectPluginCompiled': True, **firebase, **extra_dev, 'deviceTested': False,
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dev', action='store_true', help='Verify the side-by-side Salud Dev APK (app.salud.personal.dev), local lab variant.')
    parser.add_argument('--dev-beta', action='store_true', help='Verify the Salud Dev APK built with `build-dev.mjs --channel beta` (production mode, ota-beta, no localhost).')
    parser.add_argument('--apk', type=Path)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    if args.dev and args.dev_beta:
        parser.error('--dev and --dev-beta are exclusive')
    is_dev = args.dev or args.dev_beta
    apk_path = args.apk or ROOT / 'android/app/build/outputs/apk/debug' / ('app-dev-debug.apk' if is_dev else 'app-debug.apk')
    result = json.dumps(verify(apk_path.resolve(), args.dev, args.dev_beta), indent=2)
    if args.output:
        args.output.write_text(result + '\n', encoding='utf-8')
    print(result)
