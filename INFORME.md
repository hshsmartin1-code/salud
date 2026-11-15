# Informe final — Salud V1

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
