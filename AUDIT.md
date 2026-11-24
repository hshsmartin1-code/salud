# Auditoría inicial — Salud v3.2.1

- **Fecha:** 2026-11-24
- **Rama / HEAD:** `evolucion/integral-2026-11` · `47e4dac` (según la auditoría técnica)
- **Fuentes consolidadas:** auditoría técnica (seguridad, sync, rendimiento, arquitectura), auditoría científica (fórmulas y umbrales), línea base medida por el coordinador y revisión visual (390×844 y 1366×900, claro/oscuro, semilla demo).
- **Naturaleza:** auditoría de solo lectura. No se modificó ningún archivo del proyecto. Este documento es el único cambio.
- **Escalas:** severidad CRÍTICO / ALTO / MEDIO / BAJO. Esfuerzo S (<1 día), M (1–3 días), L (>3 días).
- **Estado de los hallazgos:** todos "pendiente". El coordinador actualizará la tabla de la sección 10 a medida que lleguen los arreglos.

---

## 1. Resumen ejecutivo

- **Estado general:** base sólida. Tipos y build limpios, 2063 tests unitarios pasan y el diseño visual es coherente. **No hay hallazgos CRÍTICOS.**
- **Fortalezas:** respaldo transaccional con vista previa exacta; no hay secretos commiteados (ni en el historial); reglas de Firestore deny-by-default con aislamiento por uid; OTA firmada (ECDSA P-256) con anti-downgrade; sync con cola derivada de la shadow, concurrencia optimista y sin sobrescritura silenciosa en conflictos.
- **Riesgo ALTO 1 (coste):** la ventana de solape de 5 min relee todos los documentos recientes en cada sync. Tras vincular un historial grande puede agotar la cuota gratuita de Spark (50 000 lecturas/día).
- **Riesgo ALTO 2 (datos):** unir un perfil con datos en una cuenta con datos duplica registros equivalentes en silencio y puede doblar las kcal del día. Los hábitos suman el valor doble con dos toques rápidos.
- **Riesgo ALTO 3 (robustez):** no hay ningún ErrorBoundary. Un error de render (fila mal formada, chunk lazy 404 tras un deploy) deja la pantalla en blanco de forma persistente.
- **Riesgo ALTO 4 (proceso):** la CI solo ejecuta unit tests y build en push a `main`. No corre lint, e2e, tests de reglas ni checks en PR.
- **Riesgo ALTO 5 (ciencia):** recomendaciones de salud sesgadas: factores de actividad sin fuente (objetivo entre 500 y 750 kcal por debajo de la RIEN), TMB aplicada a menores y a embarazo sin modelar, y una etiqueta diagnóstica («Hipertensión etapa 2») sobre una sola toma.
- **Riesgo ALTO 6 (cumplimiento):** son datos de salud (dato sensible en la Ley 1581 de 2012), la nube no tiene cifrado de extremo a extremo y los respaldos son JSON en claro. Antes de comercializar se necesita revisión jurídica profesional.
- **Pruebas:** 5 fallos e2e reproducibles en serie. Dos pueden ser bugs reales de datos (pérdida del primer carácter al escribir un peso; restauración offline). Su diagnóstico está pendiente.

---

## 2. Línea base medida

Medida el 2026-11-24 en contenedor cloud de 4 núcleos, Node 22.23.5.

| Medida | Resultado |
|---|---|
| `npx tsc -b` | 0 errores (2,3 s) |
| `npx oxlint` | 0 errores, 1 aviso: `react/only-export-components` en `src/features/vitals/VitalsPage.tsx:24` |
| Vitest (unitarios) | 166 archivos, 2063 tests pasan (57 s) |
| `vite build` | OK |
| Chunk de entrada `index` | ≈ 495 kB (161 kB gzip) |
| `vendor-react` | 258 kB (82 kB gzip) |
| `vendor-db` (Dexie) | 99 kB (32 kB gzip) |
| Firestore (lazy, no precargado) | 560 kB (165 kB gzip) |
| Auth (lazy, no precargado) | 127 kB |
| CSS | 68 kB (13 kB gzip) |
| Precache PWA | 117 entradas, 8,41 MB |
| `public/data` | 5,8 MB: `foods-usda.json` 4,6 MB, `exercises.json` 972 kB, `foods-off-co.json` 212 kB |
| `public/exercise-media` | 7,0 MB (caché bajo demanda) |
| Playwright e2e (Chromium headless, 3 workers, con CPU cargada) | 748 tests: 722 pasan, 7 fallan, 19 omitidos (11,3 min) |
| Re-ejecución en serie de los 7 fallos | 2 pasan (inestables bajo carga), 5 fallan de forma reproducible (sección 9) |

**Notas sobre discrepancias entre fuentes (verificar antes de dar cifras por cerradas):**
- La auditoría técnica midió `npx oxlint` con **0 errores y 90 avisos**. La línea base mide **1 aviso**. Probablemente corresponde a otro estado del código o a otra configuración; hay que confirmarlo en el mismo commit.
- La auditoría técnica midió un chunk `index` de 483 kB y un precache de 8,35 MB / 118 entradas (sobre un `dist/` que otro proceso estaba regenerando). La línea base mide 495 kB y 8,41 MB / 117. Son tamaños orientativos de builds distintos.
- Un e2e en Chromium headless no equivale a Edge. Los fallos pueden venir del entorno (sección 9).

---

## 3. Arquitectura y calidad de código

**Fronteras (correctas):** `src/db` (Dexie, repo con aislamiento, backup) → `src/domain` (lógica pura) → `src/features/*` (UI y hooks). `src/sync` es independiente de Firebase mediante la interfaz `RemoteStore`, y Firebase se carga perezosamente (`firebase.ts:246`). No hay store global: el estado es IndexedDB vía `useLiveQuery` (108 usos), contexto de perfil y poco `localStorage`. Es adecuado para una app local-first.

**Problemas:**
- **Sin ErrorBoundary** (ARQ-01). `grep ErrorBoundary` devuelve 0. `App.tsx:119` lee `active.settings.adaptive`, y `profileSchema` (`backup.ts:48`) no exige `settings`.
- **Monolitos** (ARQ-02): `FoodSearch.tsx` (677 l., ~500 l. en un componente con 21 hooks), `ExerciseDetail.tsx` (707 l., 8 subcomponentes), `BackupPage.tsx` (685 l.), `AccountPage.tsx` (680 l.), `sync/engine.ts` (723 l.).
- **Lecturas completas** (ARQ-03): el patrón `r.all(tabla)` + filtro en JS aparece en 40 lugares. `TodayPage.tsx:106-129` lanza 19 consultas y 28 `count()` en un solo `liveQuery`, así que cualquier escritura del perfil recalcula todo.
- **Código muerto** (ARQ-04), verificado sin importaciones fuera de tests: `features/nutrition/LabelCapture.tsx` (221 l.) y `ocr.ts` (106 l.), que arrastran `tesseract.js` en `dependencies` (`package.json:38`), `@tesseract.js-data/spa` y `scripts/copy-ocr-assets.mjs`. También `hydration/useTodayHydration.ts`, `nutrition/repeatMeal.ts`, `nutrition/foodList.ts`, `engine.ts:495 pendingCount` y helpers de test dentro de `src/` (`ota/test-fixtures.ts`, `training/media/testZip.ts`). `health-connect/fake.ts` sí se usa como implementación web/demo.
- **Duplicación** (ARQ-06): `src/ui/charts.tsx` convive con `src/ui/charts/` sin `index`. Hay dos `DaySummary` con semánticas distintas de «restante» (origen del bug B2).
- **Acoplamiento** (ARQ-07): `APP_VERSION` y `stableId` viven en `db/backup.ts`, que define zod a nivel de módulo; por eso zod entra en el chunk inicial. La versión está duplicada a mano en `package.json:4` y `backup.ts:23` (3.2.1), y `android/app/build.gradle:23-24` (versionCode 8, versionName 3.1.1). Puede ser intencional (shell nativo 3.1.1 con bundle OTA 3.2.x), pero conviene una sola fuente con test.
- **Dexie** (ARQ-05, ARQ-09): índices que nunca se consultan (`recents`, `favorites`, `goals`, `customFoods`, `recipes`, `importedDaily/healthRecords`, `vitals`, `labelImages`; `schema.ts:82-124`). Índices globales `sessionId`, `status`, `externalId`, `habitId` sin `profileId` (en un dispositivo con varios perfiles leen filas ajenas). `byIndex` y `byProfileIndex` no están tipados. Quitar índices exige subir a v6 (solo cambio de stores), mejor junto a la próxima migración nativa.
- **Migraciones** (ARQ-08): v1→v5 son aditivas y sin `upgrade()` (`schema.ts:149-158`), así que son seguras. Faltan tests para v1 y v4 (`migration.test.ts` cubre v2/v3). No hay manejo de `VersionError` o `blocked`: un SW viejo con la BD ya subida de versión produce pantalla en blanco.
- **Textos obsoletos** (ARQ-10): `App.tsx:21` dice «Charts (Recharts)» y no hay Recharts. `exerciseProgress.ts:28-32` menciona un campo `kind` que ya existe. El manifiesto Android dice que la cámara es «solo para etiquetas» (`AndroidManifest.xml:61`), pero se usa para códigos de barras (`BarcodeScanner.tsx:28`).

**Bugs de lógica confirmados** (la mayoría de sync se detalla en la sección 4):
- **B1** — «Marcar día completo» (`dayMarks`) usa uuid aleatorio con unicidad semántica por fecha. Entre dispositivos quedan varias filas y `[0]` elige una de forma no determinista (`NutritionPage.tsx:489-502`).
- **B2** — Hoy y Nutrición muestran metas de kcal distintas con `addActivityKcal` activo. Hoy usa `goal.kcal` (`TodayPage.tsx:381-382`) y Nutrición usa `goal + actividad` (`useDayNutrition.ts:34`). (ARQ-11)
- **B4** — Los recordatorios del plan calculan «hoy» con la zona horaria del dispositivo, mientras el resto usa `APP_TZ = America/Bogota` (`plan.ts:97-98` frente a `dates.ts:5`). (SYNC-14)
- **B5** — Ajustes dice que el OCR de Tesseract está «incluido en la app», pero los assets no se empaquetan por defecto (`SettingsPage.tsx:196-198`, `scripts/copy-ocr-assets.mjs`). (ARQ-11)

---

## 4. Sincronización y datos

**Diseño (fortalezas):**
- La cola de pendientes se deriva de la shadow (`rev` + `hash` por fila). Es durable ante cierres, cubre todos los caminos de escritura y no pierde borrados (`engine.ts:9-20`).
- Concurrencia optimista en servidor con `rev == stored+1` (`firestore.rules:56-60`).
- Las tombstones (`del:true`) propagan borrados. Hay guard de borrado masivo (`deleteThreshold`, `engine.ts:69-71`) y detección de reseteo de la nube por época (`:463-469`).
- Sin sobrescritura silenciosa: en un conflicto se guardan las dos versiones. El `profileId` local no sale del dispositivo (`codec.ts`).
- Firestore usa caché en memoria, así que no hay segunda copia de la salud en IndexedDB (`firebase.ts:262`).
- Respaldo: formato versionado (`BACKUP_VERSION=2`) con migraciones por pasos, solo reemplaza tablas incluidas, todo en una transacción, «Reemplazar» exige copia previa (`BackupPage.tsx:298-306`).
- Aislamiento por perfil: `repo()` filtra y sella `profileId`; los hooks `creating/updating` bloquean filas sin dueño o movidas (`schema.ts:160-174`); `deleteProfile` es transaccional (`profiles.ts:25-36`); `isolation.test.ts` existe.
- Parseo de decimales con coma (es-CO) estricto (`domain/units.ts:22-48`, «1.200» → 1200, «72,5» → 72,5, ambiguos → null), con tests.

**Problemas:**

| ID | Sev. | Hallazgo y evidencia | Arreglo | Esf. |
|---|---|---|---|---|
| SYNC-01 | ALTO | El solape de 5 min relee la ventana completa en cada sync, más el eco de las propias escrituras. Tras `cursor=0` la segunda sync relee todo (`engine.ts:27`, `:307-308`, `:341`; `service.ts:138-143`; `firestoreRemote.ts:113`). Riesgo de agotar la cuota Spark (50 000 lecturas/día) | Solape de 70–90 s (plazo de un RPC de Firestore: 60 s); eco de escrituras con `ownEchoUntil`; test de coste con `memoryRemote` | S |
| SYNC-02 | ALTO | «Unir» un perfil con datos en una cuenta con datos duplica en silencio registros equivalentes con ids distintos, y las kcal del día salen dobles (`link.ts:153-177`; remapeo `backup.ts:305-307`). El asistente no avisa (`AccountPage.tsx:152-240`) | Detectar duplicados probables (foodLogs: fecha+comida+foodRef+cantidad; sets: fecha+exerciseId+setIndex; medidas: fecha+hora+peso) en la vista previa; ofrecer «descargar en perfil nuevo» o deduplicar | M |
| SYNC-03 | MEDIO | Ids aleatorios en tablas con unicidad semántica: `habitLogs`, `dayMarks` (B1), `energyAdjustments` y goals adaptativos (B3). Dos dispositivos crean filas «gemelas» que se suman o compiten sin conflicto | Ids deterministas por clave natural (`stableId('habitLog:'+habitId+date)`, `dayMark:date`, `adaptive:date`) | S |
| SYNC-04 | MEDIO | Hábitos: `setValue` borra las filas del día y crea otra con uuid nuevo, sin transacción y con datos del render. Dos toques rápidos o dos dispositivos dejan 2 filas y el valor se **suma doble**. Una tombstone por toque (`HealthPages.tsx:331-335`, llamado en `:375,:382,:388`; lectura `:329`) | `stableId(habitId+date)` + `put` dentro de `db.transaction` leyendo el valor actual | S |
| SYNC-05 | MEDIO | Conflictos espurios: el hash de conflicto incluye `updatedAt`/`createdAt`. Versiones idénticas que solo difieren en la marca de tiempo generan un conflicto que la UI no explica, porque esos campos están ocultos (`engine.ts:196`, `:218`; `fieldLabels.ts:25`). Además, `repo.update`/`put` siempre ponen `updatedAt=now`, así que las ediciones no-op suben escrituras inútiles (`repo.ts:93-101,171`) | Hash semántico sin campos de auditoría; si coincide, resolver solo quedándose con el `updatedAt` mayor; `update` no escribe si no hay cambios | S |
| SYNC-06 | MEDIO | `localChanges` serializa (stableStringify + hash) **todas** las filas sincronizadas del perfil dos veces por sync; durante un entreno se sincroniza cada ~15 s (`engine.ts:82-128`, `:353`, `:474`) | Tabla `syncDirty` por hooks de Dexie, o atajo `updatedAt`+`rowId` en la shadow | M |
| SYNC-07 | MEDIO | El perfil entero (nombre, metas, dashboard, comidas, plan, adaptativo) es **un solo documento** (`PROFILE_TABLE`). Editar ajustes distintos en 2 dispositivos da conflicto de toda la fila. La shadow guarda el hash, no la base, así que no hay fusión a 3 bandas por campo | Guardar la base en la shadow de tablas pequeñas (`_profile`, routines, goals) y fusionar por campo; o partir `settings` en filas por sección | M |
| SYNC-08 | MEDIO | `raiseSessionDeletionConflicts` recorre toda la colección página a página (`engine.ts:261-272`) cuando bastaría un `getDoc` por clave determinista | `RemoteStore.get(key)` (`getDocFromServer`) y su equivalente en `memoryRemote` | S |
| SYNC-09 | MEDIO | Tombstones eternas en Firestore y en `syncShadow` (hash null). Cada borrado o recreación (hábitos, hidratación «deshacer», plantillas) suma docs para siempre. Los pulls completos (revincular, `restoreDeletedFromCloud` en `:716-723`, cambio de `TABLES_VERSION`) los leen todos | Compactar tombstones >90 días cuando todos los dispositivos superaron ese cursor (cursor por dispositivo en meta); purgar shadows nulas antiguas | M |
| SYNC-10 | MEDIO | Restaurar un respaldo en un perfil vinculado sobrescribe la nube sin conflicto si la nube no cambió desde la última sync. Es lo esperado, pero la vista previa no lo menciona (`backup.ts`, `previewImport`) | Aviso explícito en la vista previa cuando el perfil está vinculado | S |
| SYNC-11 | MEDIO | Zona horaria: fechas locales `YYYY-MM-DD` con `APP_TZ` fijo en Bogotá (`dates.ts:5`). Coherente en la sync, pero quien está fuera de Colombia o de viaje registra en «el día de Bogotá». Recordatorios usan la TZ del dispositivo (B4) | TZ del perfil (por defecto la del dispositivo), guardada en el perfil; unificar `todayLocal` | M |
| SYNC-12 | BAJO | Timeout de 30 s sobre `writeBatch.commit()` (`firestoreRemote.ts:62-77`). El SDK mantiene la escritura en cola y puede confirmarla después; si el usuario edita la misma fila, aparece un conflicto contra su propia versión anterior | En timeout, `disableNetwork()`/`enableNetwork()` o `terminate()`; o solo transacciones | S |
| SYNC-13 | BAJO | `onMutated` ignora ediciones hechas durante una sync (`service.ts:128`). Con debounce de 15 s (`:132`) y sin flush al pasar a segundo plano, el último cambio espera a la siguiente apertura | Marcar «sucio» y reprogramar al terminar; `visibilitychange→hidden` dispara sync (best effort) | S |
| SYNC-14 | BAJO | Filas remotas validadas solo como «objeto JSON» (`codec.ts:210-218`) y escritas tal cual (`engine.ts:150-159`). Un cliente viejo o con bugs puede inyectar filas que rompen la UI (ARQ-01) | Validación zod por tabla en ingesta (sync y backup); inválidas cuentan como `unreadable` | M |
| SYNC-15 | BAJO | `mapStrings` reescribe **cualquier** string que empiece por `${profileId}|` o `@|`, incluido texto libre (`codec.ts:205,213`) | Reescribir solo campos de referencia conocidos | S |
| SYNC-16 | BAJO | Lotes de push cortados por número (200), no por bytes. Filas de hasta 200k caracteres pueden superar 10 MiB por petición; el error `invalid` se relanza (`engine.ts:376`) y bloquea la sync en bucle. Hoy es improbable | Agrupar por bytes (≤8 MiB) | S |
| SYNC-17 | BAJO | Cuota Spark: 20 000 escrituras/día. Vincular un historial grande falla parcialmente con `quota` y se reanuda al día siguiente, pero la UI no lo explica (S15 original) | Mensaje específico de `quota` con progreso | S |
| SYNC-18 | BAJO | `reopenSession` compara con `JSON.stringify` (`session.ts:283,291`); el orden de claves cambia tras una escritura de sync, así que «Deshacer» se rechaza sin motivo | Usar `stableStringify` | S |
| SYNC-19 | BAJO | Transacciones ausentes: `setValue` de hábitos y `DayCompleteMark` (D2); goal y energyAdjustment en `applyProposal` (`adaptive.ts:227-252`, D3). Un cierre a mitad pierde el valor | Envolver en `db.transaction` | S |

---

## 5. Seguridad y privacidad

**Secretos:** no hay ningún secreto commiteado ni en el historial (sin coincidencias de `AIza…`, PEM o tokens fuera del patrón de un test).
- `.env.android` contiene configuración pública de OTA: dos claves públicas EC P-256 (sin `d`), hosts y URL del manifiesto. `.env.emulator` solo tiene el host del emulador.
- `google-services.json`, keystores, `ota-keys/`, `.env.local` y `.firebaserc` están en `.gitignore`.

**Reglas de Firestore:** deny-by-default, aislamiento por uid, esquema de fila estricto (`hasOnly`/`hasAll`, tipos, `t ∈ tablas`, `at == request.time`, `d ≤ 200k`, `id ≤ 300`, clave ≤ 700) y `rev+1`. Las reglas no pueden expresar límite de documentos por usuario.

**Problemas:**

| ID | Sev. | Hallazgo y evidencia | Arreglo | Esf. |
|---|---|---|---|---|
| SEC-01 | MEDIO | Registro abierto a cualquier cuenta Google y sin App Check: cualquiera puede crear `users/{uid}` y llenar la cuota del proyecto (DoS de la sync en Spark) (`firestore.rules:49-63`; `docs/V22_FIREBASE_SETUP.md:93`: App Check «fase siguiente») | Lista de correos/uids permitidos en `isOwner` o blocking function; App Check (Play Integrity + reCAPTCHA Enterprise); alertas de cuota | S–M |
| SEC-02 | MEDIO | Sin CSP (`index.html`). En GitHub Pages no hay cabeceras. Un XSS tendría acceso a IndexedDB (toda la salud) y a los tokens de Firebase Auth (`firebaseLocalStorageDb`). No se hallaron sinks peligrosos (no hay `dangerouslySetInnerHTML`; el único `insertAdjacentHTML` es un sprite SVG estático, `AnatomyThumb.tsx:31`) | `<meta http-equiv="Content-Security-Policy">` con `default-src 'self'`, `script-src 'self' 'sha256-…'` (script del tema), `connect-src` limitado a Google/Firebase/OFF, `img-src 'self' data: blob:`, `object-src 'none'`, `base-uri 'self'`; en Android, igual en la build | S |
| SEC-03 | MEDIO | Datos en la nube sin cifrado de extremo a extremo. Documentado en `docs/V22_SYNC_SECURITY.md:42-52`: Google ve `d` en claro (comidas, peso, sueño, signos vitales) | Cifrar `d` con AES-GCM y clave por frase (PBKDF2/Argon2); `h` como HMAC. El motor lo permite sin cambios grandes | L |
| SEC-04 | MEDIO | Respaldos en JSON plano con toda la salud y las fotos. En Android van a `Documents/Salud` (`integrations/files/native.ts`) y se pueden compartir. `parseBackup` valida solo `id`/`profileId` (`backup.ts:47-48`); `profileSchema` no exige `settings`. Un archivo editado puede tumbar la app (ARQ-01) | Esquemas zod por tabla en campos usados por el render; normalizar `Profile.settings`; cifrado opcional con contraseña | M |
| SEC-05 | BAJO | Exportación: `JSON.stringify` completo (fotos en base64) dos veces en memoria, pasado por el bridge de Capacitor como un solo string (`BackupPage.tsx:129-136`, `saveFile.ts:138`, `backup.ts:168-170`, `native.ts:29`). Riesgo de OOM con muchas fotos | Tamaño con `Blob.size`; exportar por streaming o trozos; ZIP con fotos aparte | M |
| SEC-06 | BAJO | Android: `allowBackup="false"` y `fullBackupContent="false"` (`AndroidManifest.xml:5-6`), pero con targetSdk 36 eso **no** desactiva la transferencia dispositivo a dispositivo (Android 12+). Falta `android:dataExtractionRules` | `dataExtractionRules` con `<cloud-backup>` y `<device-transfer>` excluyendo todo | S |
| SEC-07 | BAJO | `FileProvider` con `<external-path path=".">` (`res/xml/file_paths.xml:3`) cubre todo el almacenamiento externo. No está exportado; riesgo bajo | Restringir a `Documents/Salud/` y caché | S |
| SEC-08 | BAJO | Permisos: CAMERA, POST_NOTIFICATIONS, Health Connect solo lectura (10 permisos) y almacenamiento con `maxSdkVersion=29` (correcto). El plugin añade SCHEDULE_EXACT_ALARM, que no se usa (`AndroidManifest`, comentario `:70-72`) | `tools:node="remove"` para SCHEDULE_EXACT_ALARM y RECEIVE_BOOT_COMPLETED si no hacen falta | S |
| SEC-09 | BAJO | OTA robusta: firma ECDSA P-256 sobre el texto exacto, `keyId` con `Object.hasOwn`, semver estricto contra downgrade, bloqueo de versiones fallidas, `schemaVersion` y `minNativeVersionCode`, HTTPS con hosts exactos, SHA-256 antes de descomprimir, rollback con una prueba de arranque (`ota/manifest.ts`, `installer.capgo.ts`). Debilidades: `github.com` admite cualquier repo; sin `expiresAt`, un manifiesto viejo válido se puede servir siempre; la descarga nativa sigue redirecciones sin política de hosts (el checksum mitiga) | `expiresAt` firmado y rechazo de manifiestos antiguos; limitar la ruta del manifiesto al prefijo del repo | S |
| SEC-10 | BAJO | `npm audit --omit=dev`: 5 high, todos por `@grpc/grpc-js@1.9.16`, transitiva de `@firebase/firestore@4.17.2` que **solo se usa en Node** (no entra en el bundle del navegador). El fix de npm (firebase 9.14) es un downgrade | `overrides` a `@grpc/grpc-js ^1.13.6` probado con tests de emulador, o aceptar el riesgo y documentarlo | S |
| SEC-11 | BAJO | Fotos de progreso re-codificadas por canvas, lo que elimina EXIF/GPS (`photos/image.ts:64-86`) ✔. Nunca se sincronizan (`syncTables.ts:37-43`) ✔. Pero sí van en los respaldos por defecto (`includeMedia ?? true`, `backup.ts:131`; copia previa a «Reemplazar», `BackupPage.tsx:301`) | Avisar en la exportación de que contiene fotos; desactivar fotos en la copia previa | S |
| SEC-12 | BAJO | Sin bloqueo de app (PIN o biometría). Quien tenga el teléfono desbloqueado ve todos los perfiles; cambiar de perfil no pide nada | Bloqueo opcional por perfil (WebAuthn/biometría en el shell) | M |
| SEC-13 | BAJO | Atribuciones de packs privados sin validar esquema (`privateManifest.ts:143`). React 19 bloquea `javascript:`, pero conviene exigirlo | Validar `https:` | S |
| SEC-14 | ALTO | **Cumplimiento (no técnico):** la app maneja datos de salud, que la Ley 1581 de 2012 (Colombia) trata como datos sensibles, con reglas especiales de tratamiento, autorización expresa y finalidad. Sin revisión jurídica no debe comercializarse. Lo técnico (SEC-03, SEC-04, SEC-01) es insumo para esa revisión | Revisión por abogado especializado en protección de datos antes de comercializar: política de tratamiento, autorización, aviso de privacidad, registro de bases de datos y responsable del tratamiento | M |

**Sesiones:** una app Firebase por perfil, con persistencia propia (`firebase.ts:203-268`). Al borrar un perfil se cierra su sesión (`ProfilePage.tsx:165-169`). `moveSession` deshace la copia si falla.

---

## 6. Rendimiento

**Build:**
- JS inicial ≈ 830 kB minificado (≈ 270 kB gzip). Firebase se carga perezosamente (correcto). Tesseract no se empaqueta (correcto).
- Precache de 8,35–8,41 MB, de los que 4,6 MB son `foods-usda.json`, ≈1 MB `exercises.json` y ≈670 kB chunks de Firebase que se precachean aunque nunca se use la sync (PERF-04).

| ID | Sev. | Hallazgo y evidencia | Arreglo | Esf. |
|---|---|---|---|---|
| PERF-01 | MEDIO | Lecturas completas en `useLiveQuery`: `PhotosPage.tsx:20` lee **todas las fotos completas** en cada cambio. Hay 40 `r.all()`, entre ellos `useTrainingData.ts:16` (todos los sets), `ExerciseLibrary.tsx:132`, `TodayPage.tsx:118` (todas las sesiones), `HealthConnectPage.tsx:90`, `merge.ts:81` | Tabla de miniaturas separada; agregados persistentes (último uso por ejercicio, stats por sesión); consultas por rango o índice compuesto | M |
| PERF-02 | MEDIO | Catálogo de 13 648 + 641 alimentos (4,6 MB, ≈0,9 MB gz) parseado e indexado **en el hilo principal** (`catalog.ts:44-74`, `foodSearchIndex.ts:58-79`, ≈7 regex por campo y alimento). En Android de gama media se notan cientos de ms al abrir la búsqueda. El `sha256` del manifiesto del catálogo no se verifica | Precalcular tokens normalizados en `data-pipeline`; índice en Web Worker; verificar sha256 | M |
| PERF-03 | MEDIO | Sync: O(N) ×2 por vuelta (SYNC-06) y relecturas de Firestore (SYNC-01) | Ver SYNC-01 y SYNC-06 | M |
| PERF-04 | BAJO | Precache de chunks de Firebase y JSON grandes (`vite.config.ts:40-43`, límite 14 MB) | `globIgnores` para `index.esm-*` de Firebase; `foods-usda` como CacheFirst bajo demanda con indicador «disponible sin conexión» | S |
| PERF-05 | BAJO | Rutas eager: `NutritionPage`, `TodayPage`, `ExerciseLibraryPage`, `SessionPage` y el runner adaptativo (`App.tsx:9-17`). OTA (manifest/updater) entra en el chunk inicial también en web. zod también (ARQ-07) | Lazy salvo Hoy; cargar OTA solo con `isNativeShell()` | S |
| PERF-06 | BAJO | `TodayPage` recalcula unas 20 series en cada cambio. Gráficas SVG memoizadas, tamaño acotado por días (`TimeSeriesChart.tsx:284-292`, correcto) | Hooks por tarjeta | S |

---

## 7. Rigor científico

Revisión línea a línea de energía, composición corporal, nutrientes, hidratación, signos vitales y entrenamiento. Fuentes con PMID revisadas en PubMed; Res. 810/2021 verificada en el normograma del INVIMA; resumen de la RIEN (Res. 3803/2016) verificado en el PDF del ICBF. Lo no verificado se marca como tal.

### 7.1 Errores confirmados

| ID | Dónde | Problema | Corrección |
|---|---|---|---|
| CIE-01 (E1) | `training/exerciseProgress.ts:299`, `SettingsPage.tsx:212`, `domain/training.ts:28-31` | Dice que Epley es «válida de 1 a 15 repeticiones». Reynolds, Gordon & Robergs (2006, PMID 16937972) concluyen que no deben usarse más de 10 repeticiones en ecuaciones lineales; LeSuer 1997 validó hasta 10; Brzycki 1993 la propuso para <10 | `E1RM_MAX_REPS = 10`; 11–12 como «baja precisión»; corregir el texto |
| CIE-02 (E2) | `domain/bodycomp.ts:79, 87, 95, 264-266` | Jackson & Pollock declarada válida de 18 a 61 años también para mujeres. La muestra de Jackson, Pollock & Ward (1980, PMID 7402053) fue de mujeres de 18 a 55 años, y los autores piden cautela por encima de 40 | Rango por sexo (H 18–61, M 18–55) y aviso de cautela en mujeres >40 |
| CIE-03 (E3) | `domain/nutrients.ts:75-80`, `labelConvert.ts:169-172`, `features/nutrition/off.ts:203-205` | Comprobación Atwater con 4 × carbohidratos **totales**. La Res. 810/2021 (Art. 11.1, Tabla 4) usa 4 kcal/g de **disponibles**; totales incluyen fibra y polialcoholes (Art. 3.8). Sin alcohol (7 kcal/g). Impacto bajo por la tolerancia del 25 %, pero hay falsos positivos en bebidas alcohólicas y alimentos ricos en fibra | Una función compartida: `4P + 9F + 4·CHOdisp + 2·fibra + 7·alcohol (+2,4·polioles)`, usada en los tres puntos |
| CIE-04 (E4) | `features/settings/SettingsPage.tsx:209` | «Gasto basal: Mifflin-St Jeor × factor de actividad». TMB × factor es el gasto **total** (GET), no el basal | «Gasto total estimado = TMB (Mifflin-St Jeor) × factor de actividad» |

### 7.2 Riesgos (correcto en lo formal, puede dar resultados engañosos o inseguros)

| ID | Sev. | Dónde | Problema | Corrección |
|---|---|---|---|---|
| CIE-05 | ALTO | `domain/energy.ts:7-18` | Factores de actividad 1,2–1,9 sin fuente citada. La RIEN colombiana (Res. 3803/2016) calcula TMB (Schofield) × PAL, con ligera/sedentaria 1,40–1,69. Ejemplo: hombre de 30 años, 70 kg, 170 cm, sedentario: app 1941 kcal; RIEN 2445–2951 kcal. Mujer de 25 años, 60 kg, 165 cm: app 1614; RIEN 1926. Con déficit de 400 kcal, el objetivo inicial puede quedar 700–1100 kcal por debajo del gasto real | Citar fuente; describir 1,2 como «muy poca actividad»; con pasos medidos sugerir nivel (Tudor-Locke & Bassett 2004); añadir método RIEN (Schofield × PAL) |
| CIE-06 | ALTO | `energy.ts:93`, `GoalEditor.tsx:66` | Sin pisos de seguridad coherentes ni límites fisiológicos. Mifflin no está validada por debajo de 19 años; se permiten 14 años y `goal: 'lose'` sin advertencia | Con edad <18: avisar de validación, desactivar déficit y adaptativo automático, sugerir valoración profesional. Mínimo 18 (o 14 con advertencia bloqueante) |
| CIE-07 | ALTO | `domain/energy.ts`, `domain/adaptiveEnergy.ts` (`estimateObservedTdee`) | No existe embarazo ni lactancia. Ni Mifflin × factor ni el déficit aplican. El aumento de peso gestacional se interpreta como superávit (`TDEE = ingesta − tendencia·7700/7`), y en modo automático **bajaría las kcal** | `Profile.physiologicalState: 'none' | 'pregnant' | 'lactating'`; si no es `'none'`, desactivar déficit y adaptativo, ocultar sugerencias y mostrar «Requiere valoración profesional». Referencias IOM 2005 (+340/+452 kcal; +330 lactancia) como contexto |
| CIE-08 | MEDIO | `energy.ts:127-132` y `adaptiveEnergy.ts:608` | Pisos incoherentes: `computeTargets` solo impide bajar de la TMB; `proposeAdjustment` usa `max(TMB, 1200 M / 1500 H, 1000)`. Mujer de 45 años, 48 kg, 152 cm: objetivo 1044 kcal, mientras el adaptativo nunca baja de 1200. Ninguno tiene base experimental | Un `safetyFloor(sex, bmr, ffmKg?)` compartido, rotulado como «mínimo orientativo, no un requerimiento»; con MLG medida, ≥30 kcal/kg MLG (§12.6 del documento) |
| CIE-09 | MEDIO | `energy.ts:87, 96`, `GoalEditor.tsx:70` | Proteína: se acepta 0,5 g/kg sin aviso (RDA 0,8 IOM 2005). Se calcula sobre peso total: 120 kg × 1,8 = 216 g, 45 % de la energía con 1900 kcal (AMDR IOM 10–35 %, RIEN adultos 14–20 %) | Peso de referencia (IMC 25) si IMC ≥30; avisos si <0,8 g/kg o >35 % de energía |
| CIE-10 | MEDIO | `energy.ts:88, 97, 138-145`, `GoalEditor.tsx:71` | Grasa de 10 a 60 % sin aviso; carbohidratos sin límite (RDA IOM 130 g/día) | Avisos no bloqueantes: grasa fuera de 20–35 % (AMDR); carbohidratos <130 g/día |
| CIE-11 | MEDIO | `adaptiveEnergy.ts:13-16, 63-64, 85, 302, 483, 583`; `adaptive.ts:119-131` | Densidad energética fija de 7700 kcal/kg. Hall (2008) muestra que solo vale con >~30 kg de grasa inicial; en delgados la densidad real es ≈5500–6800 kcal/kg. Con G ≈15 kg, el TDEE observado sale sobrestimado ≈100 kcal/día. `resolveSettings` ni siquiera lee `energyPerKgKcal` guardado | Usar ρ(G) de Forbes/Hall cuando haya %GC reciente (§12.4 del documento); mostrar el valor usado y por qué |
| CIE-12 | ALTO | `domain/vitals.ts:82-84`, `VitalsPage.tsx:45, 146` | Cada toma suelta recibe etiqueta diagnóstica («Hipertensión etapa 2»). ACC/AHA y ESH exigen promedio de ≥2 lecturas en ≥2 ocasiones; 141/85 aparece como etapa 2 | Para una toma: «Lectura en rango de etapa 2 (una toma no basta para clasificar)»; clasificar el promedio de 7 días (protocolo §12.9 del documento) |
| CIE-13 | MEDIO | `vitals.ts:97-101` | SpO₂ <92 % sin tener en cuenta la altitud. MinSalud estima para Bogotá SaO₂ ≈94 % (<30 años) a 92 % (>70 años); Rojas-Camayo 2018 (Thorax) muestra caída por encima de 2500 m. En Bogotá, Tunja o Pasto, adultos sanos verían «Saturación baja» | Altitud de residencia en el perfil; avisar con <90 % por encima de 2500 m; etiquetar como orientativo |
| CIE-14 | MEDIO | `features/dashboard/TodayPage.tsx:193-201` | «Energía consumida (kcal/día)» promedia también días marcados incompletos y parciales: ingesta sesgada a la baja, no cuadra con el adaptativo | Reutilizar `intakeExclusionReason`; «media de N días completos de 7» (aplicar también a proteína y fibra) |
| CIE-15 | MEDIO | `off.ts:28`, `labelConvert.ts:178`, `units.ts:202-203` | Open Food Facts: en productos europeos `carbohydrates_100g` son **disponibles**; la app los guarda siempre como «totales». Producto rico en fibra (p. ej., chía) dispara «la fibra supera los carbohidratos totales» siendo correcto. El pipeline TCAC (`data-pipeline/tcac2015.py:724-750`) sí lo resuelve | En `offToRefFood`: si fibra > carbohidratos o país UE/UK sin CO/EE. UU., guardar `carbsAvail`, sumar fibra y marcar `carbs_basis_inferred` |
| CIE-16 | MEDIO | `training.ts:53-78`, `sets.ts:63-72`, `exerciseProgress.ts:244-251` | 1RM y récords en ejercicios de peso corporal: dominadas con +10 kg × 8 dan «1RM 12,7 kg» (falta la masa corporal). `metricsFor` excluye el e1RM en `bodyweight_reps`, pero `recordList` y `prsBySet` no. En asistidos (`fedb:Band_Assisted_Pull-Up`, `weight_reps`) los récords quedan invertidos | Pasar `trackingType` a `prsBySet` y `recordList`; omitir e1RM en `bodyweight_reps`, o usar masa corporal + lastre; marcar asistidos |
| CIE-17 | MEDIO | `trainingStats.ts:148-166`, `muscles.ts:69-93`, `recovery.ts:18` | Series semanales por músculo cuentan solo el principal, mientras la recuperación usa 0,5 por secundario: dos «series semanales» distintas. Pelland et al. (2025, PMID 41343037) dan la evidencia más fuerte al método fraccional | Conteo fraccional único (principal 1, secundario 0,5) en `muscles.ts`, compartido por Entreno, Recuperación y rutinas |
| CIE-18 | MEDIO | `health/series.ts:469` | «Tendencia de X kg/semana» con 4 puntos, sin error estándar ni descarte de atípicos | Reutilizar `weightTrend()` y `detectWeightOutliers()`; exigir ≥14 días entre primer y último pesaje; si no, «tendencia poco fiable» |
| CIE-19 | MEDIO | §11 y §12.1 del documento | No hay adecuación de micronutrientes, sodio ni azúcares libres, aunque el catálogo guarda Ca, Fe, Mg, P, Zn, K, Na, A, C, D, E, B12 y folato con marca de datos parciales | Adecuación por RIEN/IOM (EAR, probabilidad con Φ(z), AI sin conclusión de deficiencia) con cobertura ≥85 % de kcal; rotular como estimación |
| CIE-20 | BAJO | `nutrients.ts:75-80`, `labelConvert.ts:169-172` | Alcohol ausente en Atwater (cerveza ≈16 kcal calculadas por Atwater; vino y aguardiente saltan `atwater_mismatch` aunque las kcal sean correctas) | Nutriente `alcohol` en g (USDA 1018; OFF `alcohol_100g` × 0,789 × 10); usar en CIE-03 |
| CIE-21 | BAJO | `units.ts:193` | Sal ↔ sodio 400 mg/g y ÷2,5: correcto (factor legal UE 1169/2011 Anexo I; estequiométrico 2,542). En Colombia la etiqueta declara sodio | Añadir en el texto «factor legal de la UE» |
| CIE-22 | BAJO | `training.ts:18-26` | `brzycki()` exportada sin protección: con r ≥37 devuelve infinito o negativo. Hoy solo se llama vía `e1rm()`, limitado a 15 | Protección dentro de la función (y limitar a 10 con CIE-01) |
| CIE-23 | BAJO | `progression.ts:1-59` | Paso absoluto de doble progresión: 2,5 kg sobre 5 kg en elevación lateral es +50 %. ACSM 2009 recomienda 2–10 % | `step = min(equipmentStep, roundToPlate(weight*0.10))` con mínimo de placa disponible |
| CIE-24 | BAJO | `recovery.ts:78` | Series al fallo no amplían la ventana. Morán-Navarro 2017 (PMID 28965198): el fallo retrasa la recuperación 24–48 h más. El documento debe corregir su resumen de ese estudio | `windowFor(sets, failureSets) = (sets>=8 || failureSets>=3) ? 72 : 48`, rotulado como heurística |
| CIE-25 | BAJO | `controlCenter.ts:102-118` | EWMA α = 0,1 correcta, pero retraso ≈9 días (línea ≈0,6 kg sobre el peso real con −0,5 kg/semana), primer valor sin filtrar y sin descarte de atípicos | Pasar por `detectWeightOutliers`; inicializar con mediana de 3–5 pesajes; texto de método |
| CIE-26 | BAJO | `hydration.ts:48-51` | Meta de hasta 10 L sin aviso. Riesgo de hiponatremia (cifra de excreción no verificada en esta sesión) | Avisar por encima de 5 L: «muy por encima de las ingestas de referencia» |
| CIE-27 | BAJO | `bodycomp.ts:38-49` | Sitios de medición: pectoral en mujeres (JP7) debe ser un tercio de la distancia (ACSM); abdominal «vertical (o horizontal)» (JP/ACSM: vertical); suprailíaco según ACSM en línea axilar anterior **[definición exacta no verificada]** | Fijar un sitio por protocolo y documentarlo |
| CIE-28 | BAJO | `bodycomp.ts:160-181`, `:14-24`, `:183-191` | Durnin: mujeres empiezan a 16 años pero el aviso es «<17» para ambos; estudio hasta 72 H / 68 M sin aviso. FFMI normalizado derivado en hombres (Kouri 1995). Siri/Brozek suponen MLG 1,100 g/cm³ (varía por población; valores hispanos colombianos **no verificados**) | `minAge` 16 (M) / 17 (H), `maxAge` 68 / 72; avisos de población |
| CIE-29 | BAJO | `vitals.ts:88-95` | Glucosa en ayunas bien clasificada (ADA). Falta aviso de que un glucómetro no diagnostica (ISO 15197:2013 ±15 mg/dL) y no se admite mmol/L | Aviso de diagnóstico; admitir mmol/L (×18,016) guardando mg/dL |
| CIE-30 | BAJO | `vitals.ts:71-86` | Umbrales ACC/AHA 2017 correctos; la guía 2025 mantuvo categorías y renombró «crisis» por «hipertensión severa» (>180/>120) | `BP_SOURCE` explícito; etiqueta «Valores muy altos (hipertensión severa)» |
| CIE-31 | BAJO | `ideas.ts`, `suggestions.ts`, `hydration`, `TodayPage` | Verificar texto nuevo de la Res. 2066/2024 que modifica el numeral 32.2 de la Res. 810 desde 23-04-2026 **[no verificado]** antes de implementar sellos (§12.3 del documento). «Azúcares añadidos» no equivale a «azúcares libres» | Revisar antes de implementar sellos de advertencia |
| CIE-32 | BAJO | `docs/` (referencias) | Referencias con erratas: título de Morton et al. 2018 truncado («RET-induced gains…»); Pelland 2025 con volumen de 2026 «en línea en 2025»; enlace AHA con barra invertida; citas «de memoria» pendientes de verificar (Jackson & Pollock 1978, Durnin 1974, Siri 1961, etc.) | Completar y verificar referencias antes de publicar el documento de metodología |

**Lo que está bien (conservar):**
- Coeficientes exactos de Mifflin-St Jeor, JP3, JP7 (ambos sexos), Durnin-Womersley (todas las franjas), Siri, Brozek, FFMI de Kouri, IMC, ICT, ACC/AHA y ADA. Factor kJ↔kcal 4,184 y sal↔sodio 2,5.
- Sin conversión g↔ml sin densidad, y porciones no reutilizadas entre crudo y cocido ni entre marcas (`units.ts:85-137`, `portions.ts:229-238`).
- Lo desconocido no cuenta como 0 y las sumas se marcan parciales (`nutrients.ts:39-65`).
- Adaptativo: detrend con Theil-Sen, atípicos con MAD (Iglewicz-Hoaglin), corrección AR(1) del error estándar, combinación por varianza inversa con prior de DE 15 %, plausibilidad, límites de ritmo (Helms 2014; Iraki 2019), espera y piso. No suma la actividad registrada (evita contarla dos veces). Días sin registro excluidos por criterios declarados.
- Tendencia de peso del módulo adaptativo, Epley y Brzycki (fórmulas), calentamientos fuera del volumen, recuperación muscular con fuentes PMID y heurísticas declaradas (`docs/V3_MUSCLE_RECOVERY.md`, modelo a seguir).
- Ideas y sugerencias: aritmética sobre hábitos propios, sin afirmaciones de salud.
- Fibra 14 g/1000 kcal (base de la AI del IOM 2005).

---

## 8. UX/UI

Revisión visual con capturas de 390×844 y 1366×900, claro/oscuro, semilla demo. **Juicio general:** diseño limpio y consistente (neutros grafito, color reservado para datos, fuente Archivo, tokens). No tiene aspecto de plantilla genérica.

| ID | Sev. | Hallazgo | Propuesta | Esf. |
|---|---|---|---|---|
| UX-01 | MEDIO | Hoy: cuadrícula de 8 tarjetas de indicadores y filas de insight con triángulos de advertencia para promedios informativos. Iconografía de alarma para información no alarmante | Reservar advertencia para alertas reales; neutro o informativo para promedios | S |
| UX-02 | MEDIO | Entreno (inicio) muy largo en móvil, ≈3 200 px: resumen semanal, plan, rutinas, calendario de 5 semanas, mapa muscular completo (6 filas), historial reciente | Colapsar secciones; priorizar la siguiente sesión; mapa muscular plegado | M |
| UX-03 | MEDIO | Peso: la cifra principal es el último peso con delta de 7 días, no la tendencia suavizada | Tendencia suavizada (CIE-25) como cifra principal, último peso secundario | S |
| UX-04 | BAJO | Salud (hub): muro de tarjetas pequeñas, ≈2 160 px | Agrupar por frecuencia de uso; mostrar 3–4 destacadas | M |
| UX-05 | BAJO | Búsqueda de alimentos rápida (recientes con «+» de un toque), pero sin multi-selección ni entrada rápida de solo macros visible | Entrada rápida de macros y selección múltiple | M |
| UX-06 | MEDIO | Sin reporte diario de micronutrientes frente a referencias, aunque el catálogo tiene 28 nutrientes | Ver CIE-19 (requiere criterio científico) | L |

---

## 9. Pruebas

**Suites actuales:**
- Unitarios (Vitest): 166 archivos, 2063 tests, todos pasan (57 s). Buena cobertura de dominio y de sync con `memoryRemote`.
- Emulador: 5 suites de reglas y sync en `emulator-tests/` y 2 e2e de emulador. **No corren en CI.**
- Playwright e2e: 40 specs. En la corrida de línea base (Chromium headless en lugar de Edge, 3 workers, CPU cargada): 748 tests, 722 pasan, 7 fallan, 19 omitidos.

**Fallos e2e.** En serie, 2 de los 7 pasan (inestables bajo carga) y 5 fallan de forma reproducible. La causa no está determinada: puede ser del entorno (Chromium frente a Edge) o un bug real.

| ID | Spec | Fallo observado | Sev. | Hipótesis a verificar |
|---|---|---|---|---|
| TST-01 | `v3-training-persistence.spec.ts:45` | Peso escrito «72,5» y cierre brusco: se recibe «2,5», se pierde el primer carácter | ALTO | Posible bug real de entrada numérica al cerrar la hoja. Reproducir sin carga y en Edge |
| TST-02 | `backup-offline.spec.ts:4` | Objetivo de importación no encontrado tras el borrado | ALTO | Posible bug real de restauración sin conexión, o condición de carrera tras el wipe |
| TST-03 | `v3-session.spec.ts:66` | Barra fija del modo enfoque (sticky) | MEDIO | Dependiente de layout o viewport; comprobar en 390×844 |
| TST-04 | `v3-session.spec.ts:434` | Pista de progresión | MEDIO | Posible dependencia de timing o de datos de semilla |
| TST-05 | `v32-plan.spec.ts:224` | Quitar el plan no vuelve al estado vacío | MEDIO | Posible bug real de estado; comprobar la limpieza de la vista |

**Huecos de cobertura:**
1. **CI** (TST-06, ver también la sección 10): no corren reglas, emulador, e2e ni lint. Es el hueco más grave porque las reglas son la frontera de seguridad.
2. **Scheduler de sync** (`service.ts`): solo se prueba `backoff`. Faltan disparadores, descarte de ediciones durante la sync (SYNC-13), parada en `auth`/`permission` y un solo `runSync` por perfil (TST-07).
3. **Coste de Firestore**: ningún test cuenta lecturas por sync. Añadir contadores a `memoryRemote` y aserciones (p. ej., «sync sin cambios ≤2 lecturas») (TST-08).
4. **Concurrencia de UI**: doble toque en hábitos (SYNC-04), `dayMarks` en dos dispositivos (B1), `AdaptiveAutoRunner` (B3, sin test del runner).
5. **Datos inválidos**: render con perfil sin `settings`, fila de sync con campos faltantes, chunk lazy fallido. No hay ErrorBoundary que probar (ARQ-01).
6. **Conflictos solo de timestamp** (SYNC-05) y fusión de `_profile` por campo (SYNC-07).
7. **Migraciones**: v1→v5 y v4→v5 (`migration.test.ts` cubre solo 2 y 3) (ARQ-08).
8. **Catálogo**: `catalog.ts` y `useFoods.ts` sin tests (fallback de manifiesto, error parcial); presupuesto en ms para `indexFoods`.
9. **Exportación grande**: respaldo con N fotos (memoria y tamaño) y Filesystem nativo con strings grandes.
10. **Paridad de hosts OTA**: test de que `github.com` solo admite la ruta del repo, si se implementa SEC-09.
11. **Fórmulas**: casos de regresión para CIE-01 (reps >10), CIE-02 (rango por sexo), CIE-05 (factores) y CIE-07 (embarazo y menores).

---

## 10. Tabla consolidada de hallazgos

Estados iniciales: todos «pendiente». Esfuerzo S/M/L. Las evidencias son rutas relativas a la raíz del proyecto.

| ID | Área | Sev. | Evidencia | Impacto | Esf. | Acción propuesta | Estado |
|---|---|---|---|---|---|---|---|
| ARQ-01 | Arquitectura | ALTO | `src/main.tsx`, `src/App.tsx:119,121-173`; 0 usos de ErrorBoundary | Error de render deja pantalla en blanco persistente | S | ErrorBoundary por ruta y global, con Reintentar/Recargar/Respaldo; reintentar `import()` ante ChunkLoadError | pendiente |
| ARQ-02 | Arquitectura | MEDIO | `FoodSearch.tsx` (677 l.), `ExerciseDetail.tsx` (707 l.), `BackupPage.tsx` (685 l.), `AccountPage.tsx` (680 l.), `sync/engine.ts` (723 l.) | Mantenibilidad; cambios con alto riesgo de regresión | M | Extraer hooks y subcomponentes; `conflicts.ts` y `sessionGuards.ts` desde engine | pendiente |
| ARQ-03 | Arquitectura / rendimiento | MEDIO | `TodayPage.tsx:106-129`; 40 `r.all()` | Cualquier escritura recalcula 19 consultas y 28 `count()` | M | Contadores/flags en `meta`; hooks por tarjeta | pendiente |
| ARQ-04 | Arquitectura | BAJO | `features/nutrition/LabelCapture.tsx`, `ocr.ts`, `package.json:38`, `scripts/copy-ocr-assets.mjs` | Código y dependencia inalcanzables; peso en build | S | Eliminar código muerto y `tesseract.js` (tras confirmar) | pendiente |
| ARQ-05 | Datos (Dexie) | BAJO | `db/schema.ts:82-124` | Índices sin uso: coste de escritura y espacio | S | Retirar índices en la migración v6 | pendiente |
| ARQ-06 | Arquitectura | BAJO | `src/ui/charts.tsx` vs `src/ui/charts/`; `DaySummary` ×2 | Confusión de imports; origen de B2 | S | Renombrar a `ui/charts/mini.tsx`; `remainingKcal` en domain | pendiente |
| ARQ-07 | Arquitectura / build | BAJO | `db/backup.ts:23,177`; `android/app/build.gradle:23-24` | zod y OTA en chunk inicial; versión duplicada | S | `app/version.ts` con `define`; `domain/hash.ts`; test de versión única | pendiente |
| ARQ-08 | Datos (migraciones) | BAJO | `db/schema.ts:149-158`; `migration.test.ts` | Sin test v1/v4; `VersionError`/`blocked` sin manejo → pantalla en blanco | S | Casos v1/v4; manejo de `blocked` y `VersionError` | pendiente |
| ARQ-09 | Datos (Dexie) | BAJO | `db/repo.ts:134-137`; índices globales | Tipado débil; lecturas de filas ajenas en multi-perfil | S | Tipar índices por tabla; `[profileId+...]` | pendiente |
| ARQ-10 | Arquitectura | BAJO | `App.tsx:21`; `AndroidManifest.xml:61`; `exerciseProgress.ts:28-32` | Comentarios incorrectos | S | Corregir textos | pendiente |
| ARQ-11 | UX / datos | MEDIO | `TodayPage.tsx:381-382`; `useDayNutrition.ts:34` (B2); `SettingsPage.tsx:196-198` (B5) | Metas distintas entre Hoy y Nutrición; texto falso sobre OCR | S | Unificar `remainingKcal`; corregir texto OCR | pendiente |
| SYNC-01 | Sync | ALTO | `engine.ts:27,307-308,341`; `service.ts:138-143`; `firestoreRemote.ts:113` | Relectura masiva; agotamiento de cuota Spark y bloqueo en `quota` | S | Solape 70–90 s; eco de escrituras; test de coste con contador | pendiente |
| SYNC-02 | Datos / sync | ALTO | `link.ts:153-177`; `backup.ts:305-307`; `AccountPage.tsx:152-240` | Duplicados silenciosos y kcal dobles al unir | M | Detector de duplicados en vista previa; opción de perfil nuevo | pendiente |
| SYNC-03 | Sync | MEDIO | `habitLogs`, `dayMarks`, `energyAdjustments`, goals adaptativos | Filas gemelas entre dispositivos | S | Ids deterministas por clave natural | pendiente |
| SYNC-04 | Datos (hábitos) | MEDIO | `features/health/HealthPages.tsx:331-335` (llamado en `:375,:382,:388`) | Valor sumado doble con toques rápidos; tombstone por toque | S | `stableId(habitId+date)` + `put` en transacción | pendiente |
| SYNC-05 | Sync | MEDIO | `engine.ts:196,218`; `fieldLabels.ts:25`; `repo.ts:93-101,171` | Conflictos espurios; escrituras no-op | S | Hash semántico; `update` sin escritura si no hay cambios | pendiente |
| SYNC-06 | Sync / rendimiento | MEDIO | `engine.ts:82-128,353,474` | O(N) ×2 por sync; batería en entrenos | M | `syncDirty` por hooks de Dexie | pendiente |
| SYNC-07 | Sync | MEDIO | `PROFILE_TABLE`; shadow sin base | Conflicto de documento completo entre dispositivos | M | Fusión por campo en tablas pequeñas o partir `settings` | pendiente |
| SYNC-08 | Sync | MEDIO | `engine.ts:261-272` | Recorrido completo de colección | S | `RemoteStore.get(key)` | pendiente |
| SYNC-09 | Sync | MEDIO | `engine.ts:716-723`; tombstones en Firestore | Crecimiento sin límite de docs | M | Compactación de tombstones con cursor por dispositivo | pendiente |
| SYNC-10 | Datos (restauración) | MEDIO | `backup.ts` (`previewImport`) | Sobrescritura de nube sin aviso al restaurar | S | Aviso en vista previa si el perfil está vinculado | pendiente |
| SYNC-11 | Datos (TZ) | MEDIO | `db/dates.ts:5`; `plan.ts:97-98` (B4) | Día mal asignado fuera de Colombia | M | TZ del perfil; `todayLocal` unificado | pendiente |
| SYNC-12 | Sync | BAJO | `firestoreRemote.ts:62-77` | Conflicto contra la propia versión anterior tras timeout | S | Reset de red o transacciones | pendiente |
| SYNC-13 | Sync | BAJO | `service.ts:128,132` | Último cambio espera a la siguiente apertura | S | Marcar sucio; flush en `hidden` | pendiente |
| SYNC-14 | Sync | BAJO | `codec.ts:210-218`; `engine.ts:150-159` | Filas inválidas pueden romper la UI | M | Validación zod por tabla | pendiente |
| SYNC-15 | Sync | BAJO | `codec.ts:205,213` | Texto libre reescrito por error | S | Reescribir solo campos de referencia | pendiente |
| SYNC-16 | Sync | BAJO | `engine.ts:376` | Lote >10 MiB bloquea la sync en bucle | S | Lotes por bytes (≤8 MiB) | pendiente |
| SYNC-17 | Sync / UX | BAJO | Límite `quota` de Spark | Vinculación parcial sin explicación | S | Mensaje de `quota` con progreso | pendiente |
| SYNC-18 | Datos | BAJO | `session.ts:283,291` | «Deshacer» rechazado sin motivo | S | `stableStringify` | pendiente |
| SYNC-19 | Datos | BAJO | `HealthPages.tsx` (`setValue`), `DayCompleteMark`, `adaptive.ts:227-252` | Pérdida de valor si se corta a mitad | S | Transacciones | pendiente |
| SEC-01 | Seguridad | MEDIO | `firestore.rules:49-63`; `docs/V22_FIREBASE_SETUP.md:93` | DoS de cuota por cuentas arbitrarias; sin App Check | S–M | Lista de permitidos; App Check; alertas | pendiente |
| SEC-02 | Seguridad | MEDIO | `index.html`; `AnatomyThumb.tsx:31` | Sin CSP; XSS tendría acceso a IndexedDB y tokens | S | CSP con hashes y `connect-src` acotado | pendiente |
| SEC-03 | Seguridad / privacidad | MEDIO | `docs/V22_SYNC_SECURITY.md:42-52` | Google ve datos de salud en claro | L | Cifrado AES-GCM de `d`, HMAC en `h` | pendiente |
| SEC-04 | Seguridad / datos | MEDIO | `backup.ts:47-48`; `profileSchema`; `native.ts` | Respaldo en claro; archivo editado puede tumbar la app | M | Zod por tabla; cifrado opcional | pendiente |
| SEC-05 | Rendimiento / datos | BAJO | `BackupPage.tsx:129-136`; `saveFile.ts:138`; `backup.ts:168-170` | OOM con muchas fotos al exportar | M | Exportar por streaming o ZIP | pendiente |
| SEC-06 | Seguridad (Android) | BAJO | `AndroidManifest.xml:5-6` | Transferencia dispositivo a dispositivo permitida | S | `dataExtractionRules` | pendiente |
| SEC-07 | Seguridad (Android) | BAJO | `res/xml/file_paths.xml:3` | FileProvider con todo el almacenamiento externo | S | Restringir a `Documents/Salud/` y caché | pendiente |
| SEC-08 | Seguridad (Android) | BAJO | `AndroidManifest` (SCHEDULE_EXACT_ALARM), comentario `:70-72` | Permisos no usados | S | `tools:node="remove"` | pendiente |
| SEC-09 | Seguridad (OTA) | BAJO | `ota/manifest.ts`; `installer.capgo.ts` | Congelamiento con manifiesto viejo válido; host github.com amplio | S | `expiresAt` firmado; prefijo de repo | pendiente |
| SEC-10 | Dependencias | BAJO | `npm audit --omit=dev`: 5 high en `@grpc/grpc-js@1.9.16` | Solo Node (Firestore); no entra en el bundle del navegador | S | `overrides` o aceptar y documentar | pendiente |
| SEC-11 | Privacidad | BAJO | `backup.ts:131`; `BackupPage.tsx:301` | Fotos en respaldos por defecto sin aviso | S | Aviso; fotos desactivadas en copia previa | pendiente |
| SEC-12 | Seguridad | BAJO | Sin bloqueo de app | Acceso a todos los perfiles con el teléfono desbloqueado | M | Bloqueo opcional con biometría | pendiente |
| SEC-13 | Seguridad | BAJO | `privateManifest.ts:143` | Atribuciones sin validar `https:` | S | Validar esquema | pendiente |
| SEC-14 | Cumplimiento | ALTO | Datos de salud (Ley 1581 de 2012) | Riesgo legal para comercialización | M | Revisión jurídica profesional antes de comercializar | pendiente |
| PERF-01 | Rendimiento | MEDIO | `PhotosPage.tsx:20`; `useTrainingData.ts:16`; `TodayPage.tsx:118` | Lecturas completas de fotos y sets en cada cambio | M | Tabla de miniaturas; agregados persistentes | pendiente |
| PERF-02 | Rendimiento | MEDIO | `catalog.ts:44-74`; `foodSearchIndex.ts:58-79` | Cientos de ms en hilo principal al abrir búsqueda | M | Tokens precalculados; Web Worker; verificar sha256 | pendiente |
| PERF-03 | Rendimiento | MEDIO | Ver SYNC-01 y SYNC-06 | Coste de sync | M | Ver SYNC-01 y SYNC-06 | pendiente |
| PERF-04 | Rendimiento | BAJO | `vite.config.ts:40-43` | ≈670 kB de Firebase y JSON precacheados sin uso | S | `globIgnores`; CacheFirst bajo demanda | pendiente |
| PERF-05 | Rendimiento | BAJO | `App.tsx:9-17` | Chunk inicial mayor de lo necesario (zod, OTA) | S | Lazy salvo Hoy; OTA solo en shell nativo | pendiente |
| PERF-06 | Rendimiento | BAJO | `TimeSeriesChart.tsx:284-292`; `TodayPage` | ~20 series recalculadas en cada cambio | S | Hooks por tarjeta | pendiente |
| CIE-01 | Ciencia (error) | MEDIO | `exerciseProgress.ts:299`; `SettingsPage.tsx:212`; `training.ts:28-31` | Epley anunciada hasta 15 reps; evidencia hasta ~10 | S | `E1RM_MAX_REPS = 10` | pendiente |
| CIE-02 | Ciencia (error) | MEDIO | `bodycomp.ts:79,87,95,264-266` | Jackson & Pollock aplicada a mujeres de 56–61 años | S | Rango por sexo y aviso >40 | pendiente |
| CIE-03 | Ciencia (error) | BAJO | `nutrients.ts:75-80`; `labelConvert.ts:169-172`; `off.ts:203-205` | Atwater con totales; falsos positivos con fibra | S | Función compartida con carbohidratos disponibles | pendiente |
| CIE-04 | Ciencia (error) | BAJO | `SettingsPage.tsx:209` | «Basal» en vez de gasto total | S | Corregir texto | pendiente |
| CIE-05 | Ciencia (riesgo) | ALTO | `domain/energy.ts:7-18` | Objetivo 500–750 kcal por debajo de la RIEN | M | Citar fuente; método RIEN; redefinir 1,2 | pendiente |
| CIE-06 | Ciencia (riesgo) | ALTO | `energy.ts:93`; `GoalEditor.tsx:66` | Déficit y adaptativo en menores de 19 | S | Avisos; bloqueo de déficit <18 | pendiente |
| CIE-07 | Ciencia (riesgo) | ALTO | `adaptiveEnergy.ts` (`estimateObservedTdee`) | Embarazo: el adaptativo podría bajar las kcal | M | `physiologicalState`; desactivar déficit y adaptativo | pendiente |
| CIE-08 | Ciencia (riesgo) | MEDIO | `energy.ts:127-132`; `adaptiveEnergy.ts:608` | Pisos incoherentes (1044 frente a 1200) | S | `safetyFloor` compartido | pendiente |
| CIE-09 | Ciencia (riesgo) | MEDIO | `energy.ts:87,96`; `GoalEditor.tsx:70` | Proteína sobre peso total; 0,5 g/kg sin aviso | S | Peso de referencia; avisos | pendiente |
| CIE-10 | Ciencia (riesgo) | MEDIO | `energy.ts:88,97,138-145`; `GoalEditor.tsx:71` | Grasa y carbohidratos sin límites | S | Avisos no bloqueantes | pendiente |
| CIE-11 | Ciencia (riesgo) | MEDIO | `adaptiveEnergy.ts:13-16`; `adaptive.ts:119-131` | 7700 kcal/kg fijo; ≈100 kcal/día de sesgo | M | ρ(G) de Forbes/Hall con %GC | pendiente |
| CIE-12 | Ciencia (riesgo) | ALTO | `vitals.ts:82-84`; `VitalsPage.tsx:45,146` | Diagnóstico por una sola toma | S | Etiqueta de toma única; promedio de 7 días | pendiente |
| CIE-13 | Ciencia (riesgo) | MEDIO | `vitals.ts:97-101` | Alerta de SpO₂ en altitud | S | Altitud en perfil; umbral por altitud | pendiente |
| CIE-14 | Ciencia (riesgo) | MEDIO | `TodayPage.tsx:193-201` | Promedio semanal con días incompletos | S | Solo días completos; «N de 7» | pendiente |
| CIE-15 | Ciencia (riesgo) | MEDIO | `off.ts:28`; `labelConvert.ts:178`; `units.ts:202-203` | Carbohidratos disponibles guardados como totales | S | Inferencia por país y fibra; marca | pendiente |
| CIE-16 | Ciencia (riesgo) | MEDIO | `training.ts:53-78`; `sets.ts:63-72`; `exerciseProgress.ts:244-251` | Récords de peso corporal y asistidos incorrectos | S | `trackingType` en PR; omitir e1RM | pendiente |
| CIE-17 | Ciencia (riesgo) | MEDIO | `trainingStats.ts:148-166`; `recovery.ts:18` | Dos definiciones de series semanales | M | Conteo fraccional único | pendiente |
| CIE-18 | Ciencia (riesgo) | MEDIO | `health/series.ts:469` | Tendencia con 4 puntos | S | `weightTrend`; mínimo 14 días | pendiente |
| CIE-19 | Ciencia (mejora) | MEDIO | Catálogo (28 nutrientes), §11 del documento | Sin adecuación de micronutrientes | L | Adecuación RIEN/IOM con cobertura ≥85 % | pendiente |
| CIE-20 | Ciencia (riesgo) | BAJO | `energy.ts`; `nutrients.ts` (alcohol) | Vino y licores marcados como incoherentes | M | Nutriente alcohol | pendiente |
| CIE-21 | Ciencia (texto) | BAJO | `units.ts:193` | Falta indicar factor legal UE | S | Texto | pendiente |
| CIE-22 | Ciencia (robustez) | BAJO | `training.ts:18-26` | `brzycki()` sin protección r ≥37 | S | Protección en la función | pendiente |
| CIE-23 | Ciencia (riesgo) | BAJO | `progression.ts:1-59` | Paso absoluto de 2,5 kg (+50 % en ejercicios ligeros) | S | Paso relativo 2–10 % | pendiente |
| CIE-24 | Ciencia (mejora) | BAJO | `recovery.ts:78` | Fallo no amplía la ventana de recuperación | S | Ventana de 72 h con fallo; rotulado | pendiente |
| CIE-25 | Ciencia (riesgo) | BAJO | `controlCenter.ts:102-118` | EWMA con retraso y sin descarte de atípicos | S | Descarte y arranque con mediana | pendiente |
| CIE-26 | Ciencia (riesgo) | BAJO | `hydration.ts:48-51` | 10 L sin aviso | S | Aviso por encima de 5 L | pendiente |
| CIE-27 | Ciencia (medición) | BAJO | `bodycomp.ts:38-49` | Sitios de pliegues inconsistentes con ACSM/JP | S | Un sitio por protocolo | pendiente |
| CIE-28 | Ciencia (rango) | BAJO | `bodycomp.ts:160-191` | Durnin y FFMI sin avisos de rango | S | minAge/maxAge; avisos | pendiente |
| CIE-29 | Ciencia (texto) | BAJO | `vitals.ts:88-95` | Glucómetro sin aviso de diagnóstico; sin mmol/L | S | Aviso; conversión | pendiente |
| CIE-30 | Ciencia (texto) | BAJO | `vitals.ts:71-86` | Fuente de umbrales sin versión 2025 | S | `BP_SOURCE`; etiqueta de hipertensión severa | pendiente |
| CIE-31 | Ciencia (verificar) | BAJO | Res. 810/2021 Art. 32.2 (Res. 2066/2024) | Sellos pueden quedar desactualizados **[no verificado]** | S | Verificar antes de implementar | pendiente |
| CIE-32 | Ciencia (documentación) | BAJO | `docs/` (referencias) | Erratas y citas no verificadas | S | Completar y verificar | pendiente |
| UX-01 | UX | MEDIO | Hoy: 8 tarjetas e insights con triángulos | Alarma visual para info no alarmante | S | Iconografía informativa | pendiente |
| UX-02 | UX | MEDIO | Entreno (inicio), ≈3 200 px en móvil | Pantalla larga; siguiente acción poco visible | M | Colapsar; priorizar sesión | pendiente |
| UX-03 | UX | MEDIO | Tarjeta de peso | Cifra principal ruidosa frente a la tendencia | S | Tendencia suavizada como principal | pendiente |
| UX-04 | UX | BAJO | Hub de Salud, ≈2 160 px | Muro de tarjetas | M | Agrupar y destacar | pendiente |
| UX-05 | UX | BAJO | Búsqueda de alimentos | Sin multi-selección ni entrada de macros | M | Entrada rápida y selección múltiple | pendiente |
| UX-06 | UX / ciencia | MEDIO | Catálogo de 28 nutrientes sin reporte | Falta reporte diario de micronutrientes | L | Ver CIE-19 | pendiente |
| TST-01 | Pruebas (e2e) | ALTO | `v3-training-persistence.spec.ts:45` | Pérdida del primer carácter al escribir un peso | S–M | Diagnosticar en Edge y sin carga | pendiente |
| TST-02 | Pruebas (e2e) | ALTO | `backup-offline.spec.ts:4` | Restauración sin conexión no encuentra destino | S–M | Diagnosticar tras el wipe | pendiente |
| TST-03 | Pruebas (e2e) | MEDIO | `v3-session.spec.ts:66` | Barra fija de modo enfoque | S | Diagnosticar layout | pendiente |
| TST-04 | Pruebas (e2e) | MEDIO | `v3-session.spec.ts:434` | Pista de progresión | S | Diagnosticar timing/semilla | pendiente |
| TST-05 | Pruebas (e2e) | MEDIO | `v32-plan.spec.ts:224` | Estado vacío tras quitar el plan | S | Diagnosticar estado | pendiente |
| TST-06 | Pruebas (CI) | ALTO | `.github/workflows/deploy.yml:26-28` | Reglas, e2e, emulador y lint no corren antes de desplegar | M | Workflow de PR con lint, tsc, vitest, emulador y e2e en subconjunto; actions fijadas por SHA | pendiente |
| TST-07 | Pruebas (sync) | MEDIO | `sync/service.ts` | Scheduler sin tests salvo backoff | M | Tests de disparadores y estados | pendiente |
| TST-08 | Pruebas (coste) | MEDIO | `memoryRemote` | Sin conteo de lecturas por sync | S | Contadores y aserciones | pendiente |
| TST-09 | Pruebas | BAJO | `catalog.ts`, `useFoods.ts`, `migration.test.ts` | Huecos en catálogo y migraciones | S | Tests (ver sección 9) | pendiente |
