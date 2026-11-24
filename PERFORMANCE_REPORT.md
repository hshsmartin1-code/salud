# Informe de rendimiento

## Entorno y método

- Contenedor Linux, Node 22, Chromium en `/opt/pw-browsers/chromium` (Playwright), build de producción `VITE_SYNC_DISABLED=1 vite build` servido con `vite preview` (puerto 4206). Vite 8 / rolldown.
- CPU limitada 4× con CDP (`Emulation.setCPUThrottlingRate`), sin red limitada (localhost), caché HTTP desactivada y service worker bloqueado (arranque en frío).
- Los números son de una sola máquina y tienen ruido de ±10–15 %. «Antes» = commit `71e812f` (build en `perf-before`), «después» = HEAD de esta rama.
- Herramientas nuevas: `tools/perf-bundle.mjs <dist>` (tamaños), `tools/perf-startup.mjs` (arranque), `tools/perf-dataset.mjs` (perfil grande, `--profile` imprime las funciones más costosas).

## Bundle (bytes reales; kB = 1024 B)

| Medida | Antes | Después |
|---|---|---|
| Chunk de entrada `index-*.js`, raw | 501 908 B (490 kB) | 288 162 B (281 kB), -43 % |
| Chunk de entrada, gzip | 162 921 B (159 kB) | 92 761 B (91 kB), -43 % |
| JS de primera carga (entrada + modulepreload) raw | 955 817 B (933 kB, 24 archivos) | 736 438 B (719 kB, 23 archivos), -23 % |
| JS de primera carga, gzip | 312 465 B (305 kB) | 239 440 B (234 kB), -23 % |
| Precache PWA (workbox) | 119 entradas, 8 718 819 B | 130 entradas, 8 727 503 B (+0,1 %) |

El precache sigue incluyendo todos los chunks perezosos (`globPatterns` de `vite.config.ts`), así que el modo sin conexión no cambia; el total crece solo por los chunks nuevos.

## Arranque (dashboard visible, demo restaurada, CPU 4×, mediana de 11 ejecuciones en frío)

| | Antes | Después |
|---|---|---|
| Hasta `[data-testid=dashboard]` | 499–544 ms (dos tandas) | 440 ms |
| Transferido | 419 kB | 347 kB |

Mejora del orden de 12–18 %; en localhost la red no cuenta, en un móvil real la reducción de 72 kB transferidos y el parseo de JS pesan más.

## Pantallas con perfil grande (CPU 4×, mediana de 3)

Perfil sintético: 1 100 días × 6 comidas (6 600), 450 sesiones × 20 series (9 000 series), 1 100 pesos, 300 fotos de ~218 kB (JSON de 100 MB, importado por la ruta real de restauración en ~4–5 s).

| Pantalla | Antes | Después |
|---|---|---|
| Entreno (inicio) | 4 662 ms | 1 289 ms (-72 %) |
| Biblioteca de ejercicios | 794 ms | 643 ms (ruido) |
| Detalle de ejercicio | 389 ms | 643 ms (ruido; ver nota) |
| Comida (diario) | 330 ms | 248 ms |
| Salud | 320 ms | 449 ms (ruido) |
| Progreso | 825 ms | 848 ms |
| Fotos | 1 125 ms | 617 ms (-45 %) |

Nota: las pantallas que no se tocaron (biblioteca, detalle, salud, progreso, comida) oscilan ±200 ms entre tandas; no hay mejora ni regresión atribuible. En la primera medición del detalle (389 ms) y la segunda (643 ms) las muestras individuales van de 332 a 647 ms.

## Qué cambió

1. `APP_VERSION` pasó a `src/appVersion.ts` y `stableId` a `src/db/stableId.ts` (re-exportados desde `backup.ts`). El código eager los importaba de `db/backup.ts`, que arrastraba zod (361 kB) a la entrada. Los scripts `ota-release.mjs` y `verify-android-apk.py` leen la nueva ubicación.
2. `ExerciseLibraryPage`, `SessionPage` y `AdaptiveAutoRunner` son `lazy` en `App.tsx`; `TextFoodSheet` es lazy en `NutritionPage`. `isFoodNarrative` (solo regex) se movió a `foodNarrative.ts` para que `FoodSearch` no cargue el parser de etiquetas (`labelText`, 48 kB) hasta que se abre la hoja de texto.
3. `prsBySet` (récords) era cúbico en la práctica: cada serie se comparaba con todas las anteriores creando arrays. Ahora hace una pasada ordenada cuando las sesiones no se solapan en el tiempo (caso normal) y cae a la implementación de referencia si se solapan. Test de equivalencia aleatorio (`prsBySet.test.ts`, 350 casos con empates y solapes). `allRecords` ya no copia arrays con spread en cada serie.
4. Galería de fotos: lee las 48 más recientes por el índice `[profileId+date]` (`repo.latest`) con botón «Mostrar más fotos (n de total)» en vez de cargar todas las imágenes completas. Sin cambio de esquema: backup, restauración y sync no se tocan.

Verificado a mano que no cambian datos ni formatos; no se añadieron dependencias ni versiones de Dexie.

## Lo que no valió la pena (o queda pendiente)

- Notificaciones (27 kB), actualizaciones (40 kB), dashboard y estadísticas de entreno siguen en la entrada: los usan la primera pantalla o los recordatorios al arrancar; diferirlos con `requestIdleCallback` añade riesgo de comportamiento por pocos kB.
- Biblioteca de ejercicios (`ExerciseLibrary.tsx`, uso por ejercicio) y `useTrainingData` siguen leyendo todas las series: con 9 000 series cuesta ~0,3–0,6 s a 4×; acotarlo exigiría un índice o una tabla de resumen (versión de Dexie + migración) y el inicio de Entreno necesita todas las series para los récords. No se hizo.
- Fotos: con 300 fotos cada fila trae su imagen completa (limitación de IndexedDB, sin proyecciones). Separar `dataUrl` en otra tabla exigiría migración y cambios en backup; la paginación cubre el caso sin riesgo.
- Entrada restante de 281 kB: nutrición (159 kB, pestaña principal), entreno (122 kB, usado por Hoy y la barra de sesión en curso).
