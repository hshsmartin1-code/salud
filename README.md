# Salud — Personal Health OS

Aplicación web progresiva (PWA), instalable y **offline-first**, para registrar nutrición, entrenamiento, composición corporal, actividad, sueño y hábitos de **dos perfiles completamente independientes** en el mismo dispositivo. También se puede empaquetar como app Android (Capacitor).

- **Privacidad:** todos los datos personales viven solo en el almacenamiento local (IndexedDB) del dispositivo. No hay servidor, cuentas ni sincronización. Este repositorio contiene únicamente el código y catálogos públicos.
- **Respaldo:** exportación/importación JSON versionada por perfil o completa (Más → Respaldo e importación).
- **Etiquetas nutricionales:** se escriben a mano, se pegan como texto o se fotografían; la foto se lee con OCR **en el propio dispositivo** (Tesseract.js, modelo en español incluido) y nada se guarda sin que revises y confirmes los valores.
- **Adaptación energética (opcional, por perfil):** estima el gasto a partir de tus registros de comida y peso y puede sugerir (o, si lo activas, aplicar) ajustes graduales de la meta. Es una estimación, no una medición del metabolismo.
- **Tabla ICBF (TCAC):** no se incluye ni se redistribuye; cada usuario puede importar su propio archivo privado.

## Fuentes y atribuciones

- USDA FoodData Central (CC0) · instantánea de Open Food Facts Colombia (ODbL 1.0 / DbCL 1.0).
- Ejercicios: open-exercise-db (MIT, © 2026 cwlumm) basada en free-exercise-db (Unlicense).
- Ilustraciones de ejercicios: **Exercise data by [RepDB (repdb.co)](https://repdb.co)** — RepDB Free Tier License v1.0 (uso dentro de la app, atribución visible, sin redistribución como conjunto de datos). Solo se incluyen las imágenes de los ejercicios con correspondencia verificada; ver `data-pipeline/repdb/REPORT.md`.
- OCR: Tesseract.js / tesseract.js-core y modelo `spa` de tessdata (Apache 2.0).
- Tipografía: Archivo (SIL Open Font License 1.1).

Atribuciones completas dentro de la app: Más → Ajustes y fuentes.

## Desarrollo

```bash
npm install
npm run dev        # servidor local (copia antes los archivos de OCR a public/ocr)
npm test           # pruebas unitarias (Vitest)
npm run test:e2e   # pruebas end-to-end (Playwright, Edge)
npm run build      # build de producción en dist/ (GitHub Pages, base /salud/)
```

Los scripts de `data-pipeline/` (Python 3.12) regeneran los catálogos de `public/data/` y las ilustraciones de `public/exercise-media/` (`python data-pipeline/repdb/build_repdb.py`).

## Android (APK de depuración)

Requisitos: JDK 21 y Android SDK (Android Studio o command-line tools). Gradle descarga lo que falte (plataforma 36, build-tools) la primera vez.

```bash
npm run build:android   # web con rutas relativas y sin service worker + cap sync
npm run android:apk     # gradlew assembleDebug → android/app/build/outputs/apk/debug/app-debug.apk
```

El script detecta `ANDROID_HOME`/`JAVA_HOME` o los busca en las rutas habituales. Para instalar: copia el APK al teléfono y ábrelo (permite «instalar apps desconocidas»), o `adb install -r app-debug.apk`. La app pide permiso de cámara solo al fotografiar una etiqueta.

**Los datos de la app Android y los de la PWA del navegador están separados** (cada una tiene su propio almacenamiento). Para pasar datos de una a otra usa Respaldo → exportar en una e importar en la otra. La copia de seguridad automática de Android en la nube está desactivada para no subir datos de salud.

Instalación, respaldo, fuentes, pruebas y limitaciones: ver [INFORME.md](INFORME.md).
