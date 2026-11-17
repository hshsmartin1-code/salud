# Salud

Aplicación para registrar nutrición, entrenamiento, composición corporal, actividad, sueño y hábitos, con perfiles independientes en el mismo dispositivo. Funciona sin conexión: es una PWA instalable y también una app Android (Capacitor).

- **Privacidad:** los datos viven en el almacenamiento local del dispositivo (IndexedDB) y la app funciona sin servidor. Este repositorio contiene solo código y catálogos públicos; ninguna credencial ni dato personal.
- **Sincronización opcional:** cada perfil puede vincularse a su propia cuenta de Google y sincronizarse con Cloud Firestore del proyecto de Firebase que tú configures. Sin esa configuración no hay cuentas ni nube. Ver [configurar Firebase](docs/V22_FIREBASE_SETUP.md) y [seguridad, privacidad y costos](docs/V22_SYNC_SECURITY.md).
- **Respaldo:** exportación e importación JSON versionada, por perfil o completa.
- **Comida:** búsqueda en catálogos públicos, medidas caseras, recetas, plantillas, etiquetas escritas o pegadas como texto, código de barras, tiempos de comida configurables y copia de comidas anteriores.
- **Entreno:** rutinas, sesión en vivo con descanso, récords, historial, planificación semanal con recordatorios opcionales y estado muscular ([método y fuentes](docs/V3_MUSCLE_RECOVERY.md)).
- **Salud y progreso:** peso, medidas, signos vitales, hidratación, sueño, actividad y gráficas. En Android, lectura opcional de Health Connect.
- **Adaptación energética (opcional):** estima el gasto a partir de los registros de comida y peso. Es una estimación, no una medición del metabolismo.
- **Tabla ICBF (TCAC):** no se incluye ni se redistribuye; cada persona puede importar su propio archivo.

Historial de versiones: [CHANGELOG.md](CHANGELOG.md).

## Fuentes y atribuciones

- USDA FoodData Central (CC0) · instantánea de Open Food Facts Colombia (ODbL 1.0 / DbCL 1.0).
- Ejercicios: datos de open-exercise-db (CC0 1.0; código MIT, © 2026 cwlumm), basados en free-exercise-db (Unlicense).
- Ilustraciones de ejercicios: **Exercise data by [RepDB (repdb.co)](https://repdb.co)** — RepDB Free Tier License v1.0 (uso dentro de la app, atribución visible, sin redistribución como conjunto de datos). Solo se incluyen las imágenes con correspondencia verificada; ver `data-pipeline/repdb/REPORT.md`.
- Figura anatómica: BodyParts3D (CC BY 4.0).
- Tipografía: Archivo (SIL Open Font License 1.1).

Atribuciones completas dentro de la app (Ajustes → Licencias y avisos de terceros) y en [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Desarrollo

```bash
npm install
npm run dev               # servidor local
npm test                  # pruebas unitarias (Vitest)
npm run lint              # oxlint
npx tsc -b --pretty false # comprobación de tipos
npm run test:e2e          # pruebas de extremo a extremo (Playwright, Edge)
npm run test:emulator     # reglas y sincronización contra los emuladores de Firebase
npm run build             # compilación de producción en dist/
```

Los scripts de `data-pipeline/` (Python 3.12) regeneran los catálogos de `public/data/` y las ilustraciones de `public/exercise-media/`.

## Android

Requisitos: JDK 21 y Android SDK (Platform 36 y Build-Tools 35, con sus licencias aceptadas). Compatible desde Android 8 (API 26).

```bash
npm run build:android                # web con rutas relativas + cap sync
npm run android:apk                  # gradlew assembleDebug
python scripts/verify-android-apk.py # versión, firma y contenido del APK
```

Para actualizar una instalación conserva el mismo paquete y la misma firma, y exporta antes un respaldo. Los datos de la app Android y los de la PWA del navegador están separados; se pasan de una a otra con Respaldo. La copia de seguridad automática de Android en la nube está desactivada para no subir datos de salud.

## Actualizaciones dentro de la app

La app Android puede recibir versiones nuevas de la interfaz sin reinstalar. Cada paquete va firmado (ECDSA P-256) y la app comprueba firma, tamaño, hash y compatibilidad antes de aplicarlo; si la interfaz nueva no arranca, vuelve sola a la anterior. La configuración pública (claves públicas, canal y dirección del manifiesto) está en `.env.android`; las claves privadas nunca están en el repositorio.

```bash
node scripts/ota-sign.mjs keygen <id> --out-dir <carpeta absoluta fuera del repositorio>
node scripts/ota-build.mjs --channel stable --out <carpeta externa> --key-file <clave privada> --key-id <id> --notes "<novedades>"
```
