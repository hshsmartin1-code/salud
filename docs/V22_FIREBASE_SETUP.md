# Salud V2.2 — Configurar Firebase (pasos manuales)

Estos pasos solo los puede hacer la persona dueña del proyecto en su cuenta de Google. Sin ellos la app funciona igual que antes: la pantalla «Cuenta y sincronización» dice que la sincronización no está configurada y no muestra botones de inicio de sesión.

No hace falta tarjeta ni facturación: todo cabe en el plan gratuito **Spark**. No cambies a Blaze sin revisar antes [los costos](V22_SYNC_SECURITY.md#7-costos-y-limites-del-plan-gratuito).

Nada de lo que se genera aquí va a Git: `.env.local`, `android/app/google-services.json`, `.firebaserc` y los registros del emulador ya están en `.gitignore`.

## 1. Crear el proyecto

1. Abre <https://console.firebase.google.com> y pulsa **Crear un proyecto**.
2. Ponle un nombre (por ejemplo `salud-personal`). Anota el **ID del proyecto** que propone Firebase.
3. **Desactiva Google Analytics** para este proyecto. La app no usa analítica ni rastreadores.
4. Al terminar, el proyecto queda en el plan Spark (gratuito). Compruébalo en ⚙ → *Uso y facturación*.

## 2. Activar Cloud Firestore

1. Menú **Compilación → Firestore Database → Crear base de datos**.
2. Edición **Standard**. ID de la base de datos: `(default)`.
3. Ubicación: elige una cercana, por ejemplo `southamerica-east1` (São Paulo) o `us-east1`. **No se puede cambiar después.**
4. Modo: **producción** (todo denegado). Las reglas reales se publican en el paso 5.

## 3. Activar el inicio de sesión con Google

1. **Compilación → Authentication → Comenzar**.
2. Pestaña **Método de acceso → Google → Habilitar**. Elige el correo de asistencia y guarda.
3. Pestaña **Configuración → Dominios autorizados**. `localhost` ya está. Añade el dominio de GitHub Pages: `<tu-usuario>.github.io` (sin `https://` ni ruta).

Haz este paso **antes** de descargar `google-services.json` (paso 6). Así el archivo ya incluye el cliente OAuth web que necesita Android. Si lo descargaste antes, vuelve a descargarlo.

## 4. Registrar la app web

1. ⚙ **Configuración del proyecto → General → Tus apps → Web (`</>`)**.
2. Apodo `Salud web`. **No** marques Firebase Hosting.
3. Copia los valores de `firebaseConfig` en `app/.env.local`, que no se sube a Git:

```dotenv
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=<id-del-proyecto>.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=<id-del-proyecto>
VITE_FIREBASE_APP_ID=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
```

La clave web de Firebase identifica el proyecto; no es una contraseña. La seguridad la dan las reglas del paso 5. Aun así se guarda fuera de Git y se restringe en el paso 7.

## 5. Publicar reglas e índices

**Opción A, línea de comandos (recomendada):** publica reglas e índices exactamente como están en el repositorio.

En PowerShell de Windows, si `npx` falla con «la ejecución de scripts está deshabilitada», usa `npx.cmd` en lugar de `npx`. No hace falta cambiar la política de ejecución.

```bash
cd app
npx --yes firebase-tools@15.34.2 login
npx --yes firebase-tools@15.34.2 deploy --only firestore:rules,firestore:indexes --project <id-del-proyecto>
```

**Opción B, consola:**

- **Firestore → Reglas**: pega el contenido de `app/firestore.rules` y pulsa **Publicar**.
- **Firestore → Índices → Compuesto**: crea un índice en la colección `rows` con `t` ascendente y `del` ascendente, alcance *Colección*.
- **Índices → Exenciones de campo único**: en la colección `rows`, desactiva todos los índices de los campos `d`, `h` e `id`. Ahorran espacio y no se consultan.

Comprueba en **Reglas → Área de pruebas** que una lectura de `users/otro-uid/rows/x` con un usuario autenticado distinto queda **denegada**.

## 6. Registrar la app Android

1. Obtén las huellas del certificado de depuración. Es el mismo que firma los APK de prueba desde la V1.1:

   ```bash
   keytool -list -v -keystore %USERPROFILE%\.android\debug.keystore -alias androiddebugkey -storepass android -keypass android
   ```

   Copia las líneas `SHA1:` y `SHA256:`. Son públicas, no secretas.

2. ⚙ **Configuración del proyecto → Tus apps → Android**.
   - Nombre del paquete: `app.salud.personal`, exacto.
   - Apodo: `Salud Android`.
   - Certificado SHA-1: el de depuración.
3. Descarga `google-services.json` y guárdalo en `app/android/app/google-services.json`.
4. En la misma ficha de la app Android, pulsa **Agregar huella digital** y añade también el **SHA-256**.
5. Si algún día publicas en Google Play con *Play App Signing*, añade también las huellas SHA-1 y SHA-256 de **Play Console → Configuración → Integridad de la app**. Sin ellas, el inicio de sesión falla en la versión instalada desde Play.

Con el archivo presente, `capacitor.config.ts` incluye el plugin nativo `@capacitor-firebase/authentication` en la compilación Android, y Gradle aplica `com.google.gms.google-services`. Sin el archivo, el plugin no se incluye y la app no puede fallar por su ausencia.

## 7. Endurecer la configuración (recomendado)

- **Restringir las claves de API**: en Google Cloud Console (mismo proyecto), ve a **APIs y servicios → Credenciales**.
  - *Browser key*: restricción por referente HTTP con `https://<tu-usuario>.github.io/*` y `http://localhost:*`.
  - *Android key*: restricción por app Android con el paquete `app.salud.personal` y las huellas SHA-1.
- **Authentication → Configuración → Acciones del usuario**: deja desactivado el registro con correo y contraseña. Solo se usa Google.
- **App Check** (opcional, fase siguiente): Play Integrity para Android y reCAPTCHA Enterprise para la web. No está activado en la V2.2. Si lo activas sin integrarlo en la app, bloquearás la sincronización.

## 8. Compilar y probar

```bash
cd app
npm run build
```

```bash
npm run build:android
```

```bash
npm run android:apk
```

Instala el APK encima del anterior con `adb install -r`. Abre **Ajustes → Cuenta y sincronización** con cada perfil por separado y comprueba lo siguiente:

1. Inicia sesión con la cuenta de esa persona.
2. Revisa la vista previa y marca la confirmación.
3. Pulsa **Vincular y sincronizar**.
4. Comprueba que aparece «Vinculado y verificado» y, en la consola, **Firestore → Datos** muestra `users/<uid>/rows`.
5. En el otro perfil, usa **otra cuenta**. Con la misma cuenta, la app lo rechaza.

Para la versión de GitHub Pages, la compilación de la web necesita las mismas variables `VITE_FIREBASE_*` en el entorno de compilación. **No hay despliegue automático**: publicar en Pages requiere tu autorización.

## 9. Límites y alertas

- **Firestore → Uso**: lecturas, escrituras y borrados diarios.
- En Spark no hay cargos. Al llegar a la cuota diaria, Firestore rechaza operaciones hasta el día siguiente (hora del Pacífico). La app muestra «Se alcanzó la cuota gratuita» y reintenta más tarde. Los datos siguen en el teléfono.
- Las alertas de presupuesto solo existen con facturación (Blaze). Si algún día cambias de plan, crea antes un presupuesto en **Google Cloud Console → Facturación → Presupuestos y alertas** (por ejemplo, 1 USD con avisos al 50 %, 90 % y 100 %). Ten en cuenta que un presupuesto avisa, pero no corta el gasto.

## 10. Probar sin proyecto real (emuladores)

```bash
npm run test:emulator
```

Ejecuta las reglas y la sincronización contra Firestore real del emulador.

```bash
npm run test:e2e:emulator
```

Ejecuta el flujo de la pantalla de cuenta con dos «dispositivos».

```bash
npm run dev:emulator
```

Abre la app en <http://localhost:4190/salud/> conectada a los emuladores, con identidades de prueba.

Los emuladores usan el proyecto `demo-salud`. En modo emulador se ignoran las variables del proyecto real de `.env.local`: solo se lee `VITE_FIREBASE_EMULATOR_PROJECT_ID`, que debe empezar por `demo-`. Una compilación real rechaza un proyecto `demo-*`. Necesitan Java 11 o superior.
