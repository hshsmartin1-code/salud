# Registro de implementación — evolución integral 2026-11

Rama: `evolucion/integral-2026-11` (desde `47e4dac`, Salud 3.2.1). Cada bloque se desarrolló en un worktree aislado, se revisó críticamente y se integró con `merge --no-ff`. Las pruebas listadas se ejecutaron de verdad. Los resultados globales están en [QA_REPORT.md](QA_REPORT.md).

Leyenda: ✅ implementado y verificado · 🟡 parcial (con límites declarados) · 🔧 corrección de error

---

## Herramientas y proceso

- ✅ **Playwright configurable** (`playwright.config.ts`). `PW_EXECUTABLE` usa un Chromium local y `PW_CHANNEL=chromium` el Chromium de Playwright (para CI). `PW_PORT` y `PW_WORKERS` también son configurables. Por defecto sigue siendo Edge, como en el equipo del propietario.
- ✅ **Capturas reproducibles** (`tools/capture-screens.mjs`). Restaura la semilla demo sintética por el flujo de importación de la app y captura 27 pantallas por tamaño (360, 390, 820 y 1366 px) y tema. También informa la altura de página y el desbordamiento horizontal.
- ✅ **CI para PR y ramas** (`.github/workflows/ci.yml`). Corre tipos, lint, pruebas unitarias, build, e2e en Chromium (con trazas si falla) y las reglas de Firestore en el emulador (Java 21). Antes solo había pruebas unitarias y build al publicar en `main`.

## Nutrición

- ✅ **Informe «Nutrientes»** (`/comida/nutrientes`). Se abre desde el resumen del diario.
  - Periodos de día, 7 días y 30 días. Los promedios cuentan solo los días con registros y excluyen los marcados como incompletos.
  - Valores de referencia NASEM/IOM por sexo y grupo de edad (14–18, 19–30, 31–50, 51–70 y >70): RDA/AI, UL y CDRR de sodio (2019). El UL que aplica solo a suplementos (magnesio, ácido fólico, vitamina E, retinol preformado) no se marca como exceso.
  - Fibra de 14 g por 1000 kcal según la meta, con la AI absoluta al lado.
  - Límites de salud pública: sodio (OMS < 2000 mg y CDRR 2300 mg), grasa saturada y azúcares añadidos (< 10 % de la energía).
  - AMDR de proteína, carbohidratos y grasa (Atwater 4/4/9) y distribución de la energía por comida.
  - **Cobertura de datos**: qué parte de la energía registrada proviene de alimentos con ese nutriente. «Sin dato» nunca se trata como cero.
  - Unidades declaradas con honestidad: vitamina A en µg EAR, vitamina E como α-tocoferol y folato total de alimentos (no DFE).
  - «Cómo se calcula» explica que son referencias poblacionales para personas sanas y no un diagnóstico. También aclara que embarazo y lactancia no están modelados y que la RIEN 2016 es la referencia colombiana. El módulo ya admite un segundo conjunto de referencia (`referenceSet`).
  - **Verificación del coordinador**: cada valor de la tabla se contrastó con las tablas resumen NASEM en todos los grupos de edad y sexo.
  - Archivos: `src/domain/dri.ts`, `src/domain/nutrientReport.ts`, `src/features/nutrition/nutrientRows.ts` y `NutrientsPage.tsx`, con sus pruebas, y `e2e/v4-nutrients.spec.ts`.

## Entrenamiento

- ✅ **Calculadora de discos** (`src/domain/plates.ts`). Resuelve exactamente con inventario limitado (no es voraz), usa la menor cantidad de discos y da el peso logrado y los pesos alcanzables más cercanos por debajo y por encima. La hoja de discos tiene una barra visual con cada disco rotulado con su número, «Usar este peso» y un editor de barra e inventario por perfil. Solo aparece en ejercicios con barra. El módulo admite libras, pero la interfaz es solo en kg porque la app no tiene preferencia de libras.
- ✅ **Generador de calentamiento** (`src/domain/warmup.ts`, `warmupSets.ts`). La rampa es barra × 10, ~40 % × 5, ~60 % × 3 y ~80 % × 1, redondeada a pesos cargables y antes de la primera serie de trabajo. Se inserta en una transacción, con Deshacer. Las series de calentamiento siguen excluidas del volumen y de los récords.
- ✅ **1RM estimado visible** en la cabecera del ejercicio, calculado sobre las series de trabajo hechas.
- 🔧 **Pérdida del primer carácter al escribir una serie** (`SetRow.tsx`). La fila seleccionaba su valor un cuadro después del foco, así que una tecla pulsada antes de ese cuadro quedaba seleccionada y la siguiente la reemplazaba: «72,5» se guardaba como «2,5». Ahora solo selecciona si no se escribió nada desde el foco. Se reprodujo de forma determinista antes de corregirlo.
- 🔧 **Guardar una rutina ya no devuelve a quien salió del editor** (`RoutineEditor.tsx`). La navegación posterior al guardado asíncrono se omite si el editor ya se desmontó.

## Datos y portabilidad

- ✅ **Exportación CSV** (Respaldo → Exportar CSV). Hay tres archivos: entrenamientos (una fila por serie hecha), comida (una fila por registro, con nutrientes vacíos cuando se desconocen) y peso/medidas. Usan RFC 4180, UTF-8 con BOM y CRLF. Por defecto el formato es «Excel en español» (`;` y coma decimal); la opción «Estándar» usa `,` y punto decimal.
- 🟡 **Importación de historiales de Hevy y Strong** desde sus exportaciones CSV oficiales.
  - Detecta el formato, el separador y las unidades (kg o lb por encabezado; si no se indican, se pregunta).
  - Empareja los ejercicios con el catálogo y los alias, con un nivel de confianza. En la revisión se puede asignar, crear como ejercicio propio u omitir.
  - Los ids son deterministas, así que reimportar no duplica. Todo se escribe en una sola transacción, con Deshacer, y el origen queda en `sourceRef`. No cambia el esquema de sincronización.
  - *Límite*: los formatos se tomaron de guías públicas de terceros y fixtures sintéticos; no se validaron contra un archivo real exportado hoy. Las superseries de Hevy se ignoran.

## Fiabilidad e integridad

- ✅ **Límites de error de React**, global y por ruta. La pantalla de reserva, en español, ofrece Reintentar, Recargar y un enlace a Respaldo. Ante un fallo de carga de un fragmento tras una actualización, la app se recarga sola una vez, con una guarda en `sessionStorage`. Además, `normalizeProfile` tolera respaldos sin `settings`.
- 🔧 **Hábitos duplicados**: el id ahora es determinista (perfil, hábito, fecha) y la escritura es transaccional. La lectura toma el último valor y nunca suma.
- 🔧 **Marcas de día completo/incompleto duplicadas entre dispositivos**: misma corrección.
- 🔧 **Objetivo calórico distinto entre Hoy y Comida** con `addActivityKcal`: ahora una sola función, `calorieTarget()`, usa la serie de actividad sin duplicados (manual más Health Connect).
- 🔧 **Ajuste adaptativo automático aplicado dos veces el mismo día** (dos pestañas o dos dispositivos): la comprobación y la escritura van en una transacción, y los ids se derivan de (perfil, fecha).
- ✅ **Recordatorios de entreno**: se verificó que usar la hora del dispositivo es intencional (es una alarma de reloj). Se añadió una prueba que cubre todas las zonas horarias.
- 🔧 **Texto de Ajustes sobre OCR**: ahora dice la verdad (OCR desactivado y sin recursos incluidos).

## Seguridad

- ✅ **Content-Security-Policy en el build web**, inyectada en tiempo de build según la configuración:
  - Open Food Facts siempre. Los hosts de Firebase Auth y Firestore solo si hay un proyecto real configurado.
  - `object-src 'none'`, `base-uri 'self'` y `frame-src 'none'` sin Firebase.
  - El script de tema salió del HTML en línea a `public/theme-init.js`, así que ya no queda ningún script en línea.
  - Se recorrieron las 27 pantallas en el build de producción sin violaciones de CSP.
  - No se aplica al APK, porque no hay SDK de Android para probarlo aquí.

## Pruebas: fallos de la línea base resueltos

- 🔧 `backup-offline.spec.ts:4`: era un problema de entorno. Chromium sin cabeza no entrega a un input de archivo una ruta con caracteres no ASCII («→» en el título de la prueba). Ahora se pasan los mismos bytes exportados.
- 🔧 `v32-plan.spec.ts:224` y `v3-session.spec.ts` (8 pruebas intermitentes): el ayudante esperaba `/rutinas/[^/]+$`, que también coincide con `/rutinas/nueva`, y competía con el guardado. Se corrigió la expresión en 8 lugares y la app (ver arriba).
- 🔧 `v3-training-persistence.spec.ts:45`: era un error real de la app (primer carácter perdido, ver arriba). La prueba ahora también verifica el valor antes del cierre brusco.
