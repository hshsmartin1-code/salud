# Salud — Personal Health OS

Aplicación web progresiva (PWA), instalable y **offline-first**, para registrar nutrición, entrenamiento, composición corporal, actividad, sueño y hábitos de **dos perfiles completamente independientes** en el mismo dispositivo.

- **Privacidad:** todos los datos personales viven solo en el almacenamiento local del navegador (IndexedDB) del dispositivo. No hay servidor, cuentas ni sincronización. Este repositorio contiene únicamente el código y catálogos públicos.
- **Respaldo:** exportación/importación JSON versionada por perfil o completa (Más → Respaldo e importación).
- **Catálogos públicos incluidos:** USDA FoodData Central (CC0), instantánea de Open Food Facts Colombia (ODbL 1.0), ejercicios de open-exercise-db (MIT) + free-exercise-db (Unlicense). Atribuciones completas en la app (Más → Ajustes y fuentes).
- **Tabla ICBF (TCAC):** no se incluye ni se redistribuye; cada usuario puede importar su propio archivo privado.

## Desarrollo

```bash
npm install
npm run dev        # servidor local
npm test           # pruebas unitarias (Vitest)
npm run test:e2e   # pruebas end-to-end (Playwright, Edge)
npm run build      # build de producción en dist/
```

Los scripts de `data-pipeline/` (Python 3.12) regeneran los catálogos de `public/data/`.

Instalación, respaldo, fuentes, pruebas y limitaciones: ver [INFORME.md](INFORME.md).
