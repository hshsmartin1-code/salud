# Informe — Salud V1.1

Fecha: 15 de noviembre de 2026 · Versión de la app: 1.1.0 · Evolución de la V1 (sin reescritura; la V1 se documenta más abajo).

## V1.1 · 1. Archivos modificados

**Nuevos**
- Dominio (puro, con pruebas): `src/domain/labelText.ts` (lector de texto de etiquetas), `src/domain/labelConvert.ts` (conversión de bases), `src/domain/adaptiveEnergy.ts` (gasto adaptativo), cada uno con su `*.test.ts`.
- Funcionalidades: `src/features/nutrition/LabelCapture.tsx` (foto, giro, recorte), `src/features/nutrition/ocr.ts` (Tesseract.js local), `src/features/energy/adaptive.ts` + `AdaptiveEnergyCard.tsx` + `AdaptiveAutoRunner.tsx` (+ `adaptive.test.ts`), `src/features/training/exerciseMedia.tsx` (miniaturas, ilustraciones, atribución), `src/app/accent.ts` (color por perfil).
- Datos: `data-pipeline/repdb/` (`build_repdb.py`, `overrides.csv`, `REPORT.md`), `public/data/exercise-media.json`, `public/exercise-media/*.webp`.
- Android: `capacitor.config.ts`, `android/` (proyecto Capacitor), `scripts/android-apk.mjs`; `scripts/copy-ocr-assets.mjs`.
- Pruebas: `e2e/v11.spec.ts`, `e2e/fixtures/etiqueta-sintetica.png` (etiqueta inventada).

**Modificados**: `index.css`, `tailwind.config.js`, `main.tsx`, `ui/kit.tsx`, `ui/AppShell.tsx`, `ui/fields.tsx`, `ui/Icon.tsx`, `App.tsx`, `app/profile.tsx`; base de datos `db/schema.ts`, `db/tables.ts`, `db/types.ts`, `db/repo.ts`, `db/backup.ts` (versión); pantallas `TodayPage`, `NutritionPage`, `DaySummary`, `NutrientView`, `QuantitySheet`, `LabelPage`, `food.ts`, `RecipesPage`, `TrainingPage`, `SessionPage`, `ExerciseLibrary`, `BodyPage`, `HealthPages`, `ProfilePage`, `GoalEditor`, `SettingsPage`, `BackupPage`; `phase0.ts` (renombre interno para el linter); `vite.config.ts`, `package.json`, `.gitignore`, `README.md`.

**Base de datos**: versión 2 **solo agrega tablas** (`labelImages`, `dayMarks`, `energyAdjustments`); ninguna tabla ni índice de la v1 cambia (prueba dedicada), no hay función de migración y los datos existentes se conservan. Los respaldos v1 se siguen importando; las tablas nuevas entran en el respaldo.

## V1.1 · 2. Rediseño

- Neutros grafito fríos, paneles planos con bordes finos y sombra solo en capas flotantes (hojas, temporizador). Botones principales en tinta; el color se reserva para datos y para el **perfil activo** (cada perfil tiñe acentos con su color, en claro y oscuro).
- Tipografía Archivo variable: cifras condensadas y tabulares (`.readout`) para que los números se lean de un vistazo; títulos anchos; etiquetas en minúscula inicial (sin mayúsculas sostenidas).
- Elemento distintivo: la barra graduada tipo cinta métrica (`ScaleBar`, con `role="meter"`) para kcal, macros y progreso de datos.
- Diario como libro único por comidas; resumen del día con energía grande, restante/excedido y barras por macro; selector de cantidad con atajos (50–300 g, porciones) y comidas como chips; sesión en vivo con filas de serie de 44 px, temporizador fijo con barra que se vacía; tiras de métricas (`metric-strip`) en Hoy, Entreno, Cuerpo, Actividad y Sueño; títulos que ya no se cortan en móvil.
- Movimiento corto y solo como respuesta (hoja, aparición, confirmación de serie); desactivado con «reducir movimiento». Foco visible, objetivos táctiles ≥ 42 px, radios jerárquicos.

## V1.1 · 3. Ilustraciones de ejercicios (RepDB)

- Fuente: [RepDB/exercise-dataset](https://github.com/RepDB/exercise-dataset) en el commit fijo `f12da458a90f`; licencia **RepDB Free Tier v1.0**: uso dentro de apps y webs, imágenes redimensionables, **atribución visible obligatoria** y prohibido republicarlas como conjunto de datos/API.
- Atribución «**Exercise data by RepDB (repdb.co)**» con enlace en: Ajustes y fuentes, cada ficha con ilustración y el README. Las atribuciones previas (open-exercise-db MIT, free-exercise-db Unlicense, USDA, OFF) se mantienen.
- Resultado: RepDB tiene 708 ejercicios (523 con poses inicio/final, 185 con una sola). De los 873 ejercicios del catálogo, **171 tienen imagen** (153 confianza alta: 91 revisados a mano + 62 por nombre exacto; 18 media, rotulados «ejercicio equivalente»); **702 quedan sin imagen** (16 bloqueados a mano tras revisar la imagen). 170 miniaturas (160 px) + 334 imágenes de detalle (512 px, sin reescalar hacia arriba): **5,9 MB**.
- Los ids `fedb:` no cambian; los metadatos de imagen viven en `exercise-media.json`, separado del catálogo. Sin imagen verificada → panel neutro «Sin ilustración verificada». Las imágenes se guardan en caché al verse (no se precargan), así que sin conexión solo aparecen las ya vistas.
- Duda residual: la licencia no menciona explícitamente repositorios públicos; RepDB indica empaquetar las imágenes con la app y su propio ejemplo lo hace en un repo público. Para certeza total, confirmar con support@repdb.co.

## V1.1 · 4. Lector de etiquetas (texto pegado u OCR)

- «Crear desde etiqueta» tiene tres entradas: **Escribir**, **Pegar texto** y **Foto**. El texto se interpreta y **solo rellena el formulario**; nada se guarda hasta pulsar «Guardar alimento». Todos los campos son editables y los dudosos se marcan en ámbar con la razón.
- Reglas: detecta columnas (por 100 g / 100 ml / porción / envase) y nunca las mezcla (si una fila trae más valores que columnas, no se importa y se avisa); kJ y kcal no se convierten entre sí automáticamente (hay un botón «Calcular kcal desde kJ» que el usuario pulsa); mg ↔ g solo con unidad impresa (sodio en g → mg, trans en mg → g, marcados); **%VD nunca se lee como cantidad**; lo no impreso queda **vacío, no 0** («trazas» = 0 marcado); carbohidratos totales y disponibles se guardan por separado; formatos «1,5», «1.5», «<1 g», «aprox.»; sal → sodio marcado como estimado.
- Conversión (`labelConvert`): por 100 g/ml se guarda igual; por porción con peso → por 100 + porción rápida; **por porción sin peso → solo se registra por porciones**; por envase con peso → por 100; porciones «aprox.» nunca dividen valores. Se conservan los valores impresos y su base original, el texto fuente, el método de ingreso y (opcional) la foto reducida.
- Validaciones: kcal vs. macros (Atwater ±25 %), kJ/kcal incoherentes, azúcares > carbohidratos, grasa saturada > total, sodio implausible («¿estaba en g?»), macros > base.
- Huecos conocidos: OCR en columnas separadas (todas las etiquetas y luego todos los números) no se empareja; dos nutrientes en una misma línea sin separador no se importan; solo se corrigen confusiones O/l/I/9 del OCR (no S→5, B→8).

## V1.1 · 5. OCR local

- Tesseract.js 7 con el modelo español «best_int» (Apache 2.0). Trabajador, motor WASM y modelo se sirven desde la propia app (`public/ocr/`, copiados de `node_modules` al compilar; ~6 MB descargados la primera vez y luego en caché). **La foto nunca sale del dispositivo**: la prueba e2e verifica que no hay peticiones a otros hosts.
- Flujo: tomar foto o elegir imagen → girar → recortar arrastrando → «Reconocer texto» (escala de grises, contraste, reescalado) → texto editable con la confianza → «Interpretar texto» → revisión.
- Limitaciones: depende mucho de la foto (brillo, curvatura, letra pequeña, tablas en dos columnas); confunde «g» con «9» o comas con puntos (el lector rechaza o marca esas filas); la primera ejecución necesita conexión para traer los archivos desde la app; consume 30–60 MB de memoria mientras corre (se libera al salir). En la etiqueta sintética de prueba reconoció el texto con 92 % de confianza y leyó kcal y proteína correctamente.

## V1.1 · 6. Adaptación energética

- Por perfil y **desactivada por defecto**. Modos: Desactivado (solo muestra la estimación), Sugerir (tú aceptas cada cambio) y Automático (requiere confirmación explícita).
- Conceptos separados: factor de actividad (elección inicial) · gasto por fórmula (Mifflin-St Jeor × factor, con el peso actual) · gasto observado (de tus registros) · gasto adaptativo (mezcla) · meta de la fase · actividad registrada (**no se suma**: ya se refleja en el peso).
- Algoritmo: ventana de 28 días que termina ayer. Días de comida válidos ≥ máx(14, 60 % de la ventana) = 17; se excluyen días marcados «incompleto», días con alimentos sin kcal o con muy pocas kcal sin confirmar, y valores absurdos. Pesos: ≥ 8 días en ≥ 14 días de rango, sin valores aproximados ni excluidos; los picos (agua, báscula) se eliminan con un criterio robusto. Tendencia por regresión con error inflado por autocorrelación. Gasto observado = ingesta media − tendencia × 7700 kcal/kg ÷ 7. Se mezcla con la fórmula por precisión (la fórmula pesa como un dato con ±15 %). Confianza alta/media/baja según error y cobertura.
- Salvaguardas: datos mínimos; detección de registros inconsistentes (gasto < 90 % de la TMB, > 1,8× la fórmula, cambio de peso > 1,5 %/semana, demasiados atípicos); ritmo limitado por fase (déficit −0,25 a −1 %/sem, superávit +0,1 a +0,5 %/sem); **máx. 150 kcal por ajuste**; **14 días de espera** entre ajustes (también tras definir un objetivo a mano); piso = máx(TMB, 1200 mujer / 1500 hombre); **una meta manual nunca cambia sola**; con confianza baja el modo automático solo sugiere; cambios < 50 kcal se ignoran.
- Aplicar crea un **objetivo nuevo** desde hoy (proteína y grasa iguales; la diferencia va a carbohidratos) y una fila en el historial de ajustes; el anterior queda en el historial de objetivos. Pantalla: Perfil → «Adaptación energética» (fórmula, adaptativo, meta, fase, ritmo, periodo, días válidos, pesos, confianza, último ajuste, explicación, historial, días excluidos). Aviso en Hoy tras un ajuste automático. En el diario se puede marcar cada día como completo o incompleto.
- Supuestos: 7700 kcal/kg es una aproximación (los primeros días de cambio son agua y glucógeno); los días sin registro se parecen a los registrados; el subregistro sistemático no se puede detectar, solo resultados imposibles. Todas las explicaciones dicen que es una estimación y **no una medición del metabolismo**.

## V1.1 · 7. Aislamiento de perfiles

- Las tres tablas nuevas son personales (`profileId` + índice `[profileId+date]`) y solo se acceden con `repo(profileId)`; la prueba de registro de tablas las cubre automáticamente y la de aislamiento siembra y borra todas las tablas por perfil.
- Los cálculos adaptativos leen solo el repo del perfil activo (prueba con dos perfiles: el segundo no ve datos del primero). Copiar un alimento de etiqueta a otro perfil crea una copia independiente **sin la foto**.
- Nada de esto envía datos fuera del dispositivo. En Android la copia automática de Google está desactivada (`allowBackup=false`).

## V1.1 · 8. Estado del APK

- **Se compiló un APK de depuración**: `android/app/build/outputs/apk/debug/app-debug.apk` (≈ 19 MB; paquete `app.salud.personal`, versión 1.1.0, minSdk 24, targetSdk 36). Gradle 8.14 con JDK 21 (Temurin) y el SDK local; Gradle instaló la plataforma 36 y build-tools 35.
- Verificado en el paquete: permisos `INTERNET` y `CAMERA` (cámara opcional), copia de seguridad desactivada, app web, catálogos, imágenes y OCR incluidos. Se corrigió que el empaquetador de Android descomprime `*.gz` (el modelo OCR se pide sin `.gz` en Android) y se comprobó ese modo en el navegador con la misma disposición de archivos.
- **No se instaló ni se ejecutó en un teléfono ni en un emulador** (no hay emulador en este equipo). Es un APK de depuración, sin firma de publicación; no se generó AAB ni build de Play Store.

## V1.1 · 9. Pruebas

- Vitest: 17 archivos, **305/305** (incluye 70 del lector de etiquetas, 22 de conversión, 60 del módulo adaptativo, 9 de integración adaptativa con IndexedDB simulada, migración v1→v2).
- TypeScript estricto: sin errores. oxlint: 0 errores (quedan advertencias previas de estilo React). Build de producción: OK.
- Playwright (Edge): las 12 pruebas de la V1 + 5 nuevas (texto pegado → revisión → registro por ml; foto → OCR local → texto editable → formulario sin peticiones externas; ilustración con crédito y respaldo sin imagen; adaptación desactivada por defecto y confirmación del modo automático; marca de día completo). Resultado: **17/17**.
- El OCR también se probó contra la build de Android con el modelo sin comprimir.

## V1.1 · 10. Errores y limitaciones conocidos

- Lector/OCR: ver puntos 4 y 5 (columnas separadas, letras confundidas, fotos con brillo). Siempre revisar antes de guardar.
- Ilustraciones: solo 171 de 873 ejercicios; las poses de inicio no se revisaron una por una (las miniaturas sí); sin conexión solo se ven las ya cargadas.
- Adaptación: necesita ≈ 4 semanas de registros constantes; no detecta subregistro sistemático; el modo automático actúa al abrir la app (no hay procesos en segundo plano).
- Android: sin probar en un dispositivo real; ícono y pantalla de inicio son los de Capacitor por defecto; los datos del APK y de la PWA están separados.
- El paquete JS principal pesa ~780 kB (240 kB comprimido); Tesseract y las gráficas se cargan aparte.

## V1.1 · 11. Publicación en GitHub Pages

Cada `git push` a `main` ejecuta `.github/workflows/deploy.yml`: `npm ci` → pruebas unitarias → `npm run build` (copia los archivos de OCR desde `node_modules`) → publica `dist/` en https://hshsmartin1-code.github.io/salud/. Las instalaciones existentes muestran «Hay una versión nueva» → **Actualizar**. La base de datos pasa sola de v1 a v2 sin perder datos (conviene exportar un respaldo antes, como siempre).

## V1.1 · 12. Compilar e instalar el APK

1. Requisitos: Node 24, JDK 21 y Android SDK (Android Studio o command-line tools). `ANDROID_HOME`/`JAVA_HOME` son opcionales: el script los busca.
2. `npm install`
3. `npm run build:android` — compila la web con rutas relativas y sin service worker y la sincroniza con `android/`.
4. `npm run android:apk` — ejecuta `gradlew assembleDebug` y muestra la ruta del APK solo si se generó.
5. Instalar: copiar `app-debug.apk` al teléfono y abrirlo (permitir «instalar apps desconocidas»), o `adb install -r android/app/build/outputs/apk/debug/app-debug.apk`.
6. Pasar datos desde la PWA: Respaldo → Exportar en el navegador → Importar en la app Android (cada instalación tiene su propio almacenamiento).

## V1.1 · 13. Pendiente

- Probar el APK en un teléfono real (cámara, OCR, rendimiento) y crear ícono/splash propios; firma de publicación si se quiere distribuir.
- OCR: emparejar tablas en columnas, más correcciones de caracteres y un modo «recortar fila».
- Más ilustraciones (ampliar `overrides.csv` revisando cada imagen) y botón para guardarlas todas sin conexión.
- Adaptación: gráfica de gasto observado vs. fórmula en Progreso y recordatorio para marcar días completos.
- Confirmación escrita de RepDB sobre el repositorio público.

---

# Informe V1 (referencia)

Fecha: 15 de noviembre de 2026 · Versión de la app: 1.0.0

## 1. Dónde está

| Qué | Dónde |
|---|---|
| App publicada | https://hshsmartin1-code.github.io/salud/ |
| Código | repositorio público `salud` (solo código y catálogos públicos) |
| Build de producción | `npm run build`, que genera `dist/`. GitHub Actions corre las pruebas unitarias, construye y publica en GitHub Pages en cada push a `main` |
| Datos personales | solo en el navegador de cada dispositivo (IndexedDB, base `salud-pho`). No hay servidor, cuentas ni sincronización |

## 2. Arquitectura

**Stack**
- Vite 8, React 19 y TypeScript estricto.
- Tailwind con tokens de color en variables CSS (tema claro y oscuro).
- Dexie 4 sobre IndexedDB.
- React Router con `HashRouter`.
- Zod para validar los respaldos y Recharts para las gráficas (se cargan solo al abrir Progreso).
- vite-plugin-pwa / Workbox.

**Aislamiento de perfiles**
- Cada registro personal lleva `profileId`.
- Toda lectura y escritura pasa por `repo(profileId)`, que agrega y filtra ese campo.
- Los hooks de Dexie rechazan cualquier escritura sin `profileId`.
- Al cambiar de perfil se vuelve a montar toda la interfaz, así que no queda estado del perfil anterior.
- Ningún tablero suma datos de los dos perfiles.

**Catálogos públicos**
- Son JSON estáticos en `public/data/`. Se cargan una vez en memoria.
- La búsqueda normaliza el texto (minúsculas, sin tildes) y expande términos del español al inglés (pollo → chicken, cocido → cooked…).
- Los alimentos con nombre curado en español aparecen primero.

**Sin conexión**
- El service worker precachea 20 archivos (unos 7 MB), catálogos incluidos.
- Después de la primera carga la app abre y registra sin internet.
- Cuando hay una versión nueva aparece un aviso con el botón "Actualizar".

**Estructura**

| Carpeta | Contenido |
|---|---|
| `src/domain/` | Cálculos puros con pruebas: nutrientes, unidades, Mifflin-St Jeor, composición corporal, entrenamiento, estadísticas, búsqueda |
| `src/db/` | Esquema, `repo`, catálogo, respaldo |
| `src/features/` | Un módulo por área |
| `src/ui/` | Componentes compartidos |
| `data-pipeline/` | Scripts Python que generan los catálogos |
| `e2e/` | Pruebas Playwright |

## 3. Componentes reutilizados

- **No se copió código de otras apps.** OpenNutriTracker (GPL) y LiftTrace (AGPL) solo sirvieron como referencia de ideas. Forme no tiene licencia y no se usó.
- **Librerías npm de código abierto:** React, Dexie, React Router, Zod, Recharts, Workbox, Tailwind, Vitest y Playwright.
- **Datos de terceros:** ver la sección 4. Las atribuciones también están en la app, en Más → Ajustes y fuentes.

## 4. Fuentes y cantidades

| Fuente | Registros en la app | Licencia | Notas |
|---|---|---|---|
| USDA FoodData Central | 13.648 alimentos (Foundation 424 · SR Legacy 7.793 · FNDDS 5.431) | CC0 | 504 con nombre en español curado a mano; las demás muestran el nombre en inglés y la etiqueta USDA |
| Open Food Facts Colombia | 641 productos empacados | ODbL 1.0 / DbCL 1.0 | De 1.000 descargados quedaron 641; 359 se descartaron por no tener energía o nombre, o por valores imposibles. OFF lista 10.092 productos colombianos, pero la API anónima solo entrega los primeros 1.000 |
| Ejercicios | 873 | MIT (open-exercise-db, © 2026 cwlumm) y Unlicense (free-exercise-db) | Nombres e instrucciones en español, alias de gimnasio colombianos, sin imágenes |
| ICBF TCAC 2015 | 901 alimentos | No se redistribuye | Archivo privado generado en este computador. **No está en el repositorio ni en el sitio publicado.** Se importa desde el propio dispositivo |

**Reglas de datos**
- Un nutriente faltante se muestra como "—" y nunca se cuenta como 0.
- Los totales con datos faltantes se marcan como parciales (`*`).
- Los alimentos crudos y cocidos son entradas separadas.
- Cada registro guarda una copia de los valores del alimento al momento de registrarlo.

**Validación de los catálogos**
- Coherencia de Atwater (dentro de ±25 %): 97,9 % en USDA y 95,5 % en OFF.
- Ninguna fila tiene más de 105 g de macronutrientes por 100 g.
- Valores de referencia comprobados (±3 %): pechuga asada 165 kcal y arroz blanco cocido 130 kcal por 100 g, entre otros.
- Detalle completo en `data-pipeline/REPORT.md`.

## 5. Módulos implementados

- **Perfiles**
  - Dos perfiles independientes, con selector siempre visible.
  - El primer arranque guía la creación y permite restaurar un respaldo.
- **Objetivos**
  - Mifflin-St Jeor × factor de actividad, ± déficit o superávit, y metas de macronutrientes.
  - Se muestra el método; todo es editable a mano y queda con historial por fecha.
- **Comida**
  - Búsqueda (con filtros por fuente, tipo y crudo/cocido, favoritos y recientes) y registro por peso o porción.
  - Registro desde la etiqueta: por 100 g/ml, o por porción. Si la etiqueta no da el peso de la porción, solo se registra en porciones; no se inventa la densidad.
  - Código de barras con Open Food Facts: búsqueda manual siempre, y cámara donde el navegador soporta `BarcodeDetector`.
  - Recetas con totales y valores por porción; por 100 g solo si se ingresa el peso cocido.
  - Plantillas de comida, y copia de un alimento propio al otro perfil.
  - Resumen del día contra la meta.
- **Entreno**
  - Biblioteca de 873 ejercicios con filtros, y ejercicios propios.
  - Rutinas.
  - Sesión en vivo: series con el rendimiento anterior, temporizador de descanso que sobrevive a recargas, PR (peso máximo, 1RM estimado, más repeticiones con ese peso, mayor volumen en una serie) y volumen.
  - Historial.
- **Cuerpo**
  - Peso, perímetros y pliegues: JP3, JP7 e ISAK. Con ISAK se guarda solo la suma de pliegues.
  - El % de grasa (Siri) se guarda aparte de los datos medidos y siempre como "estimado".
  - Sin fecha de nacimiento no se calcula.
- **Actividad, sueño, recuperación y hábitos**
  - Registros por perfil, incluidos los suplementos.
  - Las kcal de actividad son informativas y solo se suman al presupuesto si el perfil lo activa.
- **Hoy y Progreso**
  - Tablero diario y resúmenes de 7, 30 y 90 días.
  - Gráficas solo con datos guardados: peso con media móvil de 7 días, kcal y proteína vs. meta, reparto de macros, volumen semanal, e1RM por ejercicio, cintura, % de grasa o suma de pliegues, sueño y pasos.
  - Cada gráfica tiene vista de tabla, y aparece un aviso cuando no hay datos suficientes.
- **Respaldo e importación**
  - Exportación JSON versionada, por perfil o completa.
  - Importación con dos modos, combinar o reemplazar; reemplazar descarga antes una copia de seguridad.
  - Importación opcional del historial de la fase 0 y de la tabla ICBF.
- **Ajustes**
  - Tema claro, oscuro o del sistema.
  - Fuentes y licencias, "Cómo se calcula" y aviso de privacidad.

## 6. Lo que no está hecho

- **Sin inteligencia artificial en V1.** No hay reconocimiento de fotos de comida ni interpretación automática.
- **La instantánea de Open Food Facts es parcial**: 641 de unos 10.000 productos. Con internet, el código de barras y la búsqueda en OFF completan el resto y guardan cada producto en el dispositivo.
- **ICBF:**
  - La TCAC 2018 no se importó: el PDF es solo imagen y necesitaría OCR.
  - De la TCAC 2015 quedaron fuera 68 alimentos sin análisis proximal (sin energía ni macros).
- **Sin imágenes de ejercicios**, porque su licencia no es clara.
- **Sin sincronización entre dispositivos.** Para pasar datos de uno a otro se usa el archivo de respaldo.
- **Sin equivalente en USDA** para algunos alimentos colombianos: panela, arracacha, pandebono, masarepa, papa criolla, buñuelo y tomate de árbol. Se cubren con la TCAC privada o registrando la etiqueta.
- **Sin recordatorios ni notificaciones.**

## 7. Resultados de las pruebas

| Prueba | Resultado |
|---|---|
| Vitest (unitarias) | **143 de 143 pasan** en 13 archivos: cálculos, aislamiento de perfiles en todas las tablas, respaldo de ida y vuelta, combinación idempotente, importación a otro perfil, filtro e importación de fase 0, TCAC |
| Playwright en Edge (412×915, es-CO, America/Bogota) | **12 de 12 pasan**: dos perfiles con metas visibles; cambio de perfil que cambia tablero, registros e historial; persistencia tras recargar; registro por peso, por etiqueta (por 100 g y por porción), por receta y por plantilla; búsqueda en la instantánea de OFF; rutina → sesión → PR → historial; medición con pliegues; exportar → borrar todo → importar; uso sin conexión con service worker; gráficas solo con datos reales. Cualquier error de consola hace fallar la prueba |
| TypeScript | sin errores en modo estricto |
| CI (GitHub Actions) | pruebas unitarias y build en cada push; despliegue correcto |
| Sitio publicado | revisado el 15/11/2026: carga la versión actual, service worker activo, manifiesto válido, sin errores de consola, sin archivos privados |

Las pruebas usan solo perfiles sintéticos. Las pruebas de extremo a extremo corren en local (`npm run test:e2e`), no en CI.

## 8. Limitaciones

- **Los datos viven en el navegador.** Si se borran los datos del sitio o se desinstala el navegador, se pierden. Por eso conviene exportar respaldos con frecuencia. La app pide almacenamiento persistente; su estado se ve en Respaldo → Almacenamiento.
- **Cada navegador y cada dispositivo tienen su propia copia**: la app instalada en el celular no ve los datos del computador.
- **Las metas y la composición corporal son estimaciones**: Mifflin-St Jeor, Jackson-Pollock con Siri y relación cintura/estatura. No reemplazan el criterio de un profesional de la salud.
- **Los valores de la fase 0 leídos de gráficas** se marcan como aproximados y quedan fuera de los promedios.
- **Los datos de Open Food Facts** son aportes de la comunidad y pueden tener errores; se marcan los casos dudosos.
- **La cámara para códigos de barras** depende del navegador: funciona en Chrome para Android y suele no estar disponible en Edge o Chrome de Windows. La entrada manual del código siempre funciona.
- **No probado:** iPhone/Safari, ni la instalación en un dispositivo Android físico. Sí se verificó que el sitio cumple los requisitos de instalación: manifiesto y service worker activos.

## 9. Instalación

La primera vez que se abre la app descarga los catálogos (unos 7 MB). Espera el aviso "Lista para usarse sin conexión" antes de quedarte sin internet.

### Android (Chrome)
1. Abre https://hshsmartin1-code.github.io/salud/ en Chrome.
2. Toca el menú ⋮ y luego **Instalar app** (en algunas versiones aparece como **Agregar a la pantalla principal → Instalar**).
3. Abre **Salud** desde la pantalla de inicio. Se abre como una app, sin barra del navegador.

### Windows (Edge o Chrome)
1. Abre https://hshsmartin1-code.github.io/salud/.
2. Haz clic en el ícono de instalar de la barra de direcciones. En Edge también está en ⋯ → **Aplicaciones → Instalar este sitio como una aplicación**.
3. Si quieres, ancla Salud a la barra de tareas o al menú Inicio.

Las actualizaciones llegan solas: cuando hay una versión nueva aparece el aviso "Hay una versión nueva de la aplicación" con el botón **Actualizar**.

## 10. Respaldo

**Exportar**
1. Ve a Más → **Respaldo e importación** → Exportar.
2. Elige **Perfil de …** (solo el perfil activo) o **Todos los perfiles**.
3. Se descarga `salud-respaldo-<perfil>-<fecha>.json`. Contiene datos de salud: guárdalo en un lugar privado.

**Restaurar o mover a otro dispositivo**
1. En un dispositivo nuevo, la primera pantalla ofrece **¿Ya usabas la app? Restaurar un respaldo**. Si ya hay perfiles, ve a Más → Respaldo e importación → **Importar respaldo**.
2. Elige el archivo y el perfil de destino: un perfil nuevo o uno existente.
3. Elige el modo:
   - **Combinar** agrega lo que falta y, si un registro está en ambos lados, conserva el más reciente.
   - **Reemplazar** deja solo lo del archivo, y antes descarga una copia automática de lo que había.

Recomendación: exportar **Todos los perfiles** al menos una vez por semana y antes de borrar datos del navegador o cambiar de teléfono.

**Importaciones opcionales**, en la misma pantalla:
- **Historial previo (fase 0):** elige el archivo de importación de la fase 0 (privado, generado en este computador) y asigna cada persona del archivo (A/B) a un perfil existente, a uno nuevo o a ninguno. Antes de importar se ven los conteos. Se puede repetir sin duplicar registros.
- **Tabla ICBF (TCAC 2015):** elige el archivo privado `tcac2015.json`. Hay que importarla en cada dispositivo.

## 11. Siguiente fase

1. **Open Food Facts completo** a partir de su exportación masiva (CSV/Parquet) en el pipeline, en lugar de la API anónima.
2. **OCR de la TCAC 2018** y nombres en español para más alimentos colombianos.
3. **Registro asistido por IA con confirmación obligatoria** (foto o texto → propuesta → el usuario confirma), sin claves en el frontend y sin enviar datos de salud sin consentimiento explícito.
4. **Sincronización opcional** entre dispositivos, por ejemplo con un archivo cifrado en una carpeta que el usuario elija, solo con consentimiento.
5. **Recordatorios** de comidas, pesaje, suplementos y respaldo.
6. **Imágenes de ejercicios** con licencia clara.
7. **Pruebas:** e2e en CI, prueba en iPhone/Safari y en dispositivos Android reales.
