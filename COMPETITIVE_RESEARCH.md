# Salud: investigación competitiva (nutrición, entrenamiento, salud)

Fecha de la investigación: noviembre de 2026 (acceso a fuentes: 2026-11-24). Versión de Salud evaluada: v3.2.1.

---

## 1. Método y limitaciones

### Método
- Búsquedas web (modo "standard") por app y por tema (precios, límites del plan gratuito, quejas, changelogs) y lectura de páginas concretas: precios oficiales de MacroFactor y Cronometer, centro de ayuda de Fitia, notas de versión de MacroFactor, comunicados de Apple, páginas de Garmin/Google Health, fichas de App Store.
- Cada afirmación lleva una etiqueta:
  - **[verificado: N]** = confirmada en una página consultada, donde N es el número en la sección 8. Las páginas de fabricantes cuentan como verificación primaria. Las de blogs competidores solo verifican precios que otras fuentes confirman.
  - **[reportado por usuarios / terceros: N]** = viene de reseñas, blogs comparativos, agregadores de reseñas o foros. Puede estar sesgada.
  - **[conocimiento previo, no re-verificado en 2026]** = cosas que conozco de versiones anteriores de la app y que no pude confirmar con una fuente de 2026. Úsalas como hipótesis.

### Limitaciones (importante)
- **No pude leer hilos de Reddit ni reseñas completas de App Store/Play.** El buscador no devolvió hilos de r/MacroFactor, r/Hevy ni r/fitness. Lo que digo de "quejas frecuentes" proviene de agregadores de reseñas, blogs de reseña y notas de versión, no de lectura directa de la comunidad. Trátalo como orientativo.
- **Mucha de la información de precios viene de blogs de empresas competidoras** (Nutrola, NutriScan, SensAI, Fitia comparando con rivales). Solo di por bueno un precio cuando una fuente oficial lo confirma o varias fuentes independientes coinciden. Los demás aparecen como "reportado".
- **No logré verificar con fuente primaria** los tap-counts de registro (cuántos toques toma registrar un alimento). Las cifras de "flujo de registro" son descripciones cualitativas, no mediciones. Si se quiere un benchmark real, hay que cronometrar manualmente cada app (propuesta en sección 4, ítem 12).
- Sin datos verificados de 2026 sobre: StrengthLog (precio y límites), Lyfta (precio), Samsung Health (plan de pago: solo "exploran" uno), Withings Health Mate, Yazio y Lose It! (precios por región contradictorios), Athlytic (precio y fórmula), cobertura real de alimentos latinoamericanos de Fitia.
- Los precios están en USD de la tienda de EE. UU. salvo indicación. Los de Colombia pueden diferir por moneda e impuestos.
- Las puntuaciones de recuperación/esfuerzo de WHOOP, Oura, Athlytic y Bevel no publican su fórmula completa [verificado: 7, 14]. No se puede copiar su algoritmo, solo su presentación.

---

## 2. Fichas por app

### 2.1 Entrenamiento

#### Hevy
- **Diferenciales:** registro rápido con valores de la sesión anterior precargados en cada serie, súper-series y drop sets nativos, temporizador de descanso automático, feed social con seguidores y PRs que se puede ocultar [verificado: 6]. Mapa de calor de distribución muscular durante el entrenamiento (nota de versión 2.5.6) [verificado: búsqueda de changelog, 17]. "Hevy Trainer" (feb. 2026) genera programas y progresa pesos con reglas simples (sube el peso al completar el tope de repeticiones en todas las series) [verificado: 6]. Envío del entrenamiento a ChatGPT/Claude desde la pantalla de fin (v3.1.x, sept. 2026) [verificado: 17]. Sincronización completa con Strava desde junio 2026 [verificado: 17].
- **Navegación:** se reportó un rediseño nativo de navegación en 2026 [verificado: 17]. La estructura clásica es feed / perfil / entrenar / ejercicios / ajustes [conocimiento previo, no re-verificado en 2026].
- **Flujo de registro:** iniciar rutina, tocar las series, los valores previos ya están ahí, marcar con el check, el temporizador arranca solo [verificado: 6].
- **Visualizaciones:** gráficos por ejercicio, volumen y distribución muscular. El historial gratuito se limita a 3 meses [verificado: 3, 6].
- **Quejas frecuentes:** cap de rutinas en gratis, ceiling del Trainer basado en reglas, sin entradas de recuperación (sueño, HRV) [verificado: 6; solo la parte del Trainer]. Sobre bugs de sync y el ritmo de nuevas funciones: [reportado por usuarios, no leí los hilos].
- **Peticiones:** no pude verificarlas con una fuente de 2026.
- **Plan gratuito:** registro ilimitado, sin anuncios, 4 rutinas, 7 ejercicios personalizados, 3 meses de gráficos [verificado: 3, 6, 8]. Exportación CSV gratis [verificado: 8].
- **Precio:** Pro 2.99 USD/mes (existe un SKU de 3.99), 23.99 USD/año, 74.99 USD de por vida [verificado: 3, 6; ambos son blogs de SensAI, competidor, pero coinciden con varias fuentes].
- **Plataformas:** Wear OS gratis, app web, importa CSV de Strong [verificado: 8].

#### Strong
- **Diferenciales:** diseño minimalista de registro personal sin feed social [reportado: búsqueda de comparativas 8]. Calculadora de calentamiento y mediciones corporales en Pro [verificado: 8].
- **Plan gratuito:** 3 rutinas, gráficos solo en Pro, datos nunca bloqueados [verificado: 3, 8].
- **Precio:** Pro 4.99 USD/mes, 19.99 USD/6 meses, 29.99 USD/año, 99.99 USD de por vida [verificado: 3, dato de blog competidor].
- **Plataformas:** Wear OS en beta cerrada, sin web [verificado: 8].
- **Quejas / peticiones:** gráficos detrás de paywall [verificado: 3]. Lo demás no se pudo verificar.

#### StrengthLog
- **Diferenciales:** descrito como uno de los trackers gratuitos más generosos del App Store. El premium agrega el catálogo de más de 200 programas, estadísticas avanzadas y mapa anatómico de músculos trabajados [reportado por terceros: búsqueda 8].
- **Importación:** Hevy lista StrengthLog entre sus orígenes de importación [reportado: 8].
- **Precio y límites:** **no verificado.**

#### Lyfta
- **Diferenciales:** biblioteca de más de 5,000 ejercicios con muchas variaciones, rutinas ilimitadas gratis, herramientas web gratuitas (1RM, niveles de fuerza, generador con IA), Wear OS gratis, importa de Hevy, Strong, Fitbod y más [verificado: 8; es marketing del propio Lyfta].
- **Precio:** no verificado.

#### Fitbod
- **Diferenciales:** genera la rutina del día según historial, equipo y recuperación muscular [conocimiento previo, no re-verificado en 2026].
- **Plan gratuito:** ninguno. Prueba de 7 días con tarjeta. Después puedes ver el historial pero no registrar [verificado: 3].
- **Precio:** 15.99 USD/mes o 95.99 USD/año según una fuente [verificado: 3]. Otros reportes dan 12.99 o 19.99 USD/mes con planes legados, así que varía [reportado: 18, 23].
- **Quejas:** entrenamientos repetitivos, caídas y lentitud, navegación engorrosa, problemas de facturación con suscripciones de App Store, precio creciente sin funciones nuevas [reportado por usuarios / reseñas: 18, 23].

### 2.2 Nutrición

#### MacroFactor
- **Diferenciales:** el algoritmo de gasto energético (expenditure) y peso tendencia, con metas que se ajustan semanalmente. Herramientas opcionales añadidas a fines de 2025 para actividad, enfermedad o viajes [reportado: 19, blogs; el algoritmo en sí es conocimiento previo]. Base de alimentos curada y verificada, exportación de datos [reportado: 19]. Explorador de nutrientes: hasta 8 nutrientes fijados en el panel [verificado: búsqueda de notas de versión, 9]. App de entrenamiento "Workouts" lanzada en enero de 2026 [verificado: 1].
- **Navegación:** panel (dashboard), diario, y secciones de progreso y ajustes [conocimiento previo, no re-verificado].
- **Flujo de registro:** los widgets de Android abren directamente la búsqueda de alimentos, el registro de peso o el diario con un toque [verificado: 9].
- **Widgets:** cuatro tipos (colección de nutrientes, con atajos, enfoque, actual y restante) con temas de color o Material You. La compañía admitió que los widgets eran la función más pedida por un margen amplio (2023) [verificado: 9].
- **Quejas:** precio alto, falta de registro con foto de IA [reportado por competidores: 19]. Afirman también que no rastrea micronutrientes, lo cual contradice las propias páginas de MacroFactor [verificado: 9]. Considera esa queja un error.
- **Plan gratuito:** ninguno, solo prueba (duración no indicada en la página oficial) [verificado: 1].
- **Precio:** 11.99 USD/mes, 47.99 USD/semestre, 71.99 USD/año. Paquete Nutrición + Workouts: 89.99 USD/año. Suscriptores anteriores a 2026 tienen Workouts gratis hasta el 12 de enero de 2027 [verificado: 1].

#### Cronometer
- **Diferenciales:** base de datos de más de 1 millón de alimentos verificados en laboratorio, hasta 95 nutrientes con metas personalizadas [verificado: 2]. Escáner de código de barras gratis [verificado: 2]. Gold agrega foto, voz, importador de recetas, programador de macros por día de la semana, temporizador de ayuno, biométricos personalizados, puntajes de nutrición, sugerencias de alimentos, "Crono Coach" con IA y un plugin de ChatGPT [verificado: 2].
- **Plan gratuito:** registro de comida, ejercicio, biométricos, 95 nutrientes, metas personalizadas, sincronización con dispositivos, escáner, alimentos y recetas propios, pero gráficos y reportes solo de 7 días [verificado: 2]. Con anuncios [reportado: 4, 20].
- **Precio:** Gold 59.99 USD/año (4.99 al mes) o 10.99 USD/mes [verificado: 2]. Otras fuentes citan 49.99 USD/año, así que parece haber subido [reportado: 4, 20].
- **Quejas:** anuncios en el plan gratis, historial limitado, y duplicados en la base con entradas de usuarios [conocimiento previo, no re-verificado].
- **Barras de % de nutrientes por DRI:** funcionalidad central [conocimiento previo, coherente con 2].

#### Fitia
- **Diferenciales:** enfoque hispanohablante, metas calóricas personalizadas, planes de comida automáticos con lista de compras, y entrada por texto, voz y foto [verificado: 5, 10].
- **Plan gratuito:** metas de calorías y macros, registro con la mayoría de la base verificada, escáner y registro por texto, **hasta 4 comidas al día**, y solo seguimiento de peso [verificado: 5].
- **Premium:** planes automáticos, planificador semanal, recetas, lista de compras, sincronización de planes entre varias personas, foto y voz, Apple Health y Google Health, grasa corporal, fotos de progreso y medidas, coach 24/7 [verificado: 5].
- **Precio en Colombia:** un listado de terceros indica unos 15,900 COP/mes, 37,900 COP/3 meses, 54,900 COP/6 meses y 95,900 COP/año [reportado: 10, verificar en la tienda]. Prueba de 3 días solo en el plan anual [reportado: 10].
- **Valoración en Colombia:** 4.92/5 con unas 8,700 reseñas en Google Play. Quejas: fallos al cambiar de plan tras pagar, y la sensación de que casi todo está en Premium [reportado por usuarios: 10].
- **No verificado:** el tamaño y calidad de su catálogo de alimentos colombianos.

#### MyFitnessPal
- **Diferenciales:** la base de datos más grande (colaborativa) e integraciones numerosas [conocimiento previo].
- **Quejas:** escáner de código de barras pasado a Premium desde el 1 de octubre de 2022 [verificado: 11]. Un análisis de 202 reseñas negativas de Google Play de julio de 2026 encontró que el escáner es la función más citada (27 reseñas) [reportado por agregador: 21]. Aumento de anuncios [reportado: 21]. Datos erróneos en entradas colaborativas [conocimiento previo].
- **Precio:** Premium 79.99 USD/año o 19.99 USD/mes, Premium+ 99.99 USD/año o 24.99 USD/mes [reportado: búsqueda 2026]. Un blog da 49.99 y 79.99 USD/año [reportado: 4], es decir, hay contradicción.
- **Plan gratuito:** con anuncios, sin escáner [reportado].

#### Yazio, Lose It!, MyNetDiary
- **Yazio:** Pro entre 29.99 y 47.90 USD/año según fuente y región [reportado: contradictorio]. Plan gratis limitado y con anuncios [reportado: 4].
- **Lose It!:** Premium reportado entre 39.99 y 79.99 USD/año. Un reporte dice que se duplicó en 2026 [reportado: contradictorio]. Foto básica gratis, con anuncios [reportado: 4].
- **MyNetDiary:** Premium 8.99 USD/mes y hasta 59.99 USD/año, foto en Premium, coach de IA en Premium Plus [reportado].
- **Todo lo demás de estas tres** (navegación, flujo, quejas específicas): **no verificado en esta investigación.**

### 2.3 Salud y analítica

#### Apple Health
- En septiembre de 2026, Apple anunció un rediseño de Health con pestaña de "Insights" que resume corazón, sueño, preparación (readiness), fitness, signos vitales y ciclo durante el día, y un puntaje de Readiness de 0 a 10 que combina sueño, oxígeno en sangre, HRV, frecuencia respiratoria y frecuencia cardiaca en reposo (solo Series 12 y Ultra 4) [verificado: 16; detalle del puntaje: reportado, búsqueda].
- Importación de laboratorios con tendencias [reportado].
- Es el único de los wearables comparados que escribe HRV en Apple Health [reportado: 7].

#### Samsung Health
- Sin plan de pago confirmado. Samsung dijo que explora suscripciones, con el nivel gratuito conservado [reportado: búsqueda Garmin/Fitbit]. El resto: no verificado.

#### Garmin Connect
- Connect+ cuesta 6.99 USD/mes o 69.99 USD/año con 30 días de prueba. Garmin afirma que todas las funciones existentes siguen gratis [reportado, medios: 12]. El lanzamiento (2025) generó críticas fuertes por "paywall" [reportado: 12].

#### WHOOP
- Membresía obligatoria: One 199, Peak 239, Life 359 USD/año [reportado: 7]. Strain 0-21 (esfuerzo cardiovascular en 24 h), Recovery 0-100% [reportado: búsqueda].
- Una revisión de 2025 encontró que ninguno de 14 puntajes compuestos publica su fórmula [reportado: 7].

#### Oura
- Ring 5 a 399 USD más 69.99 USD/año. Sin membresía solo se ven tres puntajes diarios [reportado: 7]. Readiness con líneas base personales [reportado].
- Mejor concordancia de HRV nocturna contra ECG en un estudio de 2025 [reportado: 7].

#### Fitbit / Google Health
- Fitbit Premium se renombró Google Health Premium el 19 de mayo de 2026 y sube a 9.99 USD/mes y 99.99 USD/año (antes 79.99/año). Gratis con Google AI Pro/Ultra [reportado: 13].

#### Withings
- **No verificado.** Solo conocimiento previo: básculas y presión arterial conectadas con la app Health Mate, sin suscripción obligatoria para lo básico.

#### Guava Health
- Rastreador de salud con laboratorios (carga de fotos/PDF o importación desde portales), gráficos de tendencias con rango normal, síntomas, medicación, estado de ánimo, ciclo. Premium agrega asistente con IA [reportado, marketing propio: 15].
- Precio Premium: 78 USD/año u 8 USD/mes [reportado, marketing propio: 15]. Tablero para profesionales a 6 USD/paciente activo al mes [reportado: 15].

#### Athlytic y Bevel (otras relevantes)
- **Athlytic:** recuperación a partir de HRV y frecuencia cardiaca en reposo; gratis con compras integradas y 1 semana de prueba [reportado: 14]. Precio y fórmula no verificados (un solo listado habla de 29.99 USD/año).
- **Bevel:** puntaje de Strain con componente activo (FC y movimiento en entrenos) y pasivo (movimiento, FC y pasos). "Target Strain" diario sugerido a partir del historial, la recuperación reciente y la actividad. Pro 5.99 USD/mes o 49.99 USD/año [verificado: 14; ficha de App Store de 2025, puede haber cambiado]. No publica la fórmula completa.

---

## 3. Matriz competitiva

Leyenda: ✓ = existe; parcial = existe con limitaciones o solo en pago; ✗ = no existe; ? = no verificado. **Las celdas de Salud se basan en la lista de funciones v3.2.1. Las de los competidores mezclan verificado y conocimiento previo; donde no tengo base, pongo ?.**

### 3.1 Entrenamiento

| Capacidad | Salud | Hevy | Strong | StrengthLog | Lyfta | Fitbod |
|---|---|---|---|---|---|---|
| Biblioteca de ejercicios con ilustraciones | ✓ | ✓ | ✓ | ✓ | ✓ (5,000+) | ✓ |
| Rutinas y plantillas | ✓ | parcial (4 gratis) | parcial (3 gratis) | ✓ | ✓ | ✓ (generadas) |
| Valores de la sesión anterior en línea | ? | ✓ | ✓ | ? | ? | ? |
| Temporizador de descanso | ✓ | ✓ | ✓ | ? | ? | ? |
| Tipos de serie (calentamiento, drop, fallo) | ✓ | ✓ | ✓ | ? | ? | ? |
| RIR / RPE | ✓ (RIR) | ✓ | ✓ | ? | ? | ? |
| PRs automáticos | ✓ | ✓ | ✓ | ✓ | ? | ✓ |
| Sugerencia de progresión | ✓ | ✓ (Trainer, reglas) | ✗ | parcial | ✗ | ✓ |
| Calculadora de calentamiento | ✗ | ? | parcial (Pro) | ? | ✗ | ? |
| Calculadora de discos | ✗ | ? | ? | ? | ? | ? |
| Mapa de recuperación / músculos | ✓ ("estimado") | ✓ (mapa de distribución) | ✗ | ✓ | ? | ✓ |
| Sustitución de ejercicio | ✓ | ? | ? | ? | ? | ✓ |
| Plan semanal con recordatorios | ✓ | ? | ? | ? | ? | ✓ |
| Social / feed | ✗ | ✓ | ✗ | ? | ? | ✗ |
| Wear OS / reloj | ✗ | ✓ | ✗ (beta) | ? | ✓ | ? |
| Importar desde otras apps (CSV) | ✗ | ✓ | ✗ | ? | ✓ | ✗ |
| Funciona sin conexión | ✓ | ? | ? | ? | ? | ? |

### 3.2 Nutrición

| Capacidad | Salud | MacroFactor | Cronometer | Fitia | MFP | Yazio | Lose It! | MyNetDiary |
|---|---|---|---|---|---|---|---|---|
| Base local, búsqueda rápida y difusa | ✓ | ? | ✓ | ? | ✓ | ? | ? | ? |
| Alimentos colombianos | ✓ (OFF CO + variantes de nombre) | ✗ | ✗ | parcial (?) | ✗ | ✗ | ✗ | ✗ |
| Escáner de código de barras gratis | ✓ | ✗ (sin gratis) | ✓ | ✓ | ✗ | ? | ? | ? |
| Foto con IA | ✗ (OCR desactivado) | ✗ | parcial (Gold) | parcial (Premium) | parcial | ? | parcial | parcial (Premium) |
| Entrada en lenguaje natural | ✓ (un alimento) | ? | parcial (voz, Gold) | ✓ (texto, gratis) | ? | ? | ? | ? |
| Porciones caseras | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Recetas con porciones y peso cocido | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Plantillas de comida / copiar días | ✓ | ✓ | parcial | ✓ | ✓ | ✓ | ✓ | ✓ |
| Comidas configurables (1-6) | ✓ | ✓ | ✓ | parcial (4 gratis) | ✓ | ✓ | ✓ | ✓ |
| Micronutrientes con metas DRI y % | parcial (no verificado en la lista de Salud: fibra) | ✓ (8 fijables) | ✓ (hasta 95) | ✗ | parcial | parcial | parcial | ✓ |
| Gasto adaptativo (tendencia peso + ingesta) | ✓ (opcional) | ✓ (referencia) | ✗ | parcial (ajuste automático, Premium) | ✗ | ✗ | ✗ | ✗ |
| Sugerencias para completar kcal/proteína | ✓ ("ideas") | ? | parcial (Gold) | ✓ (planes, Premium) | ✗ | ✗ | ✗ | ✗ |
| Plan de comidas y lista de compras | ✗ | ✗ | ✗ | ✓ (Premium) | parcial | ✓ | ✗ | ✓ |
| Widgets de pantalla de inicio | ? | ✓ | ? | ? | ? | ? | ? | ? |
| Sin anuncios | ✓ | ✓ | parcial (Gold) | ? | ✗ (gratis) | ✗ (gratis) | ✗ (gratis) | ? |
| Gratis y completo | ✓ | ✗ | parcial | parcial | ✗ | ✗ | ✗ | ✗ |

### 3.3 Salud y analítica

| Capacidad | Salud | Apple Health | Samsung | Garmin | WHOOP | Oura | Fitbit/Google | Withings | Guava | Athlytic/Bevel |
|---|---|---|---|---|---|---|---|---|---|---|
| Peso con tendencia | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✓ | ✓ | ✓ | ✗ |
| Medidas con protocolos de pliegues | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ? | parcial | ✗ |
| Presión arterial / glucosa | ✓ | ✓ | ✓ | parcial | parcial | ✗ | parcial | ✓ | ✓ | ✗ |
| Laboratorios con rango normal | ✗ | ✓ | ? | ✗ | parcial (análisis de sangre) | ? | ✗ | ? | ✓ | ✗ |
| Hidratación / sueño | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | parcial | ✓ |
| Puntaje de recuperación / readiness | ✗ | ✓ (nuevo, 0-10) | ? | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✓ |
| Puntaje de esfuerzo (strain) | ✗ | ✗ | ✗ | parcial | ✓ | ✗ | ✗ | ✗ | ✗ | ✓ |
| Comparativas por período | ✓ | ✓ | ? | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Fotos de progreso | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Perfiles múltiples locales | ✓ | parcial (Family) | parcial | ✗ | ✗ | ✗ | parcial | ✓ | ✗ | ✗ |
| Funcionamiento sin conexión y sin cuenta | ✓ | ✓ | parcial | parcial | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Fórmula del puntaje publicada | n/a | ✗ | ? | ✗ | ✗ | ✗ | ✗ | n/a | n/a | ✗ |

Nota: esta tercera tabla es de conocimiento previo en buena parte. Solo son verificadas las filas de readiness de Apple, Oura/WHOOP, Bevel y Guava (secciones 2.3 y fuentes 7, 14, 15, 16).

---

## 4. Patrones que vale la pena adaptar

Esfuerzo: S = menos de 1 semana, M = 1-3 semanas, L = más de 3 semanas.

1. **Peso tendencia (EWMA) como número principal, con puntos crudos atenuados.**
   - Por qué: es el eje de MacroFactor. El peso diario varía por agua y sodio, y la tendencia evita la desmotivación. Salud ya calcula una tendencia para el gasto adaptativo, así que el dato existe.
   - Cómo en Salud: mostrar la línea suavizada como cifra grande, los pesajes como puntos tenues, y la tasa semanal (kg/semana, % del peso). Documentar el factor de suavizado en la pantalla de ayuda.
   - Esfuerzo: S.

2. **Gráfico de gasto energético con intervalo y explicación.**
   - Por qué: es el diferenciador percibido de MacroFactor. Ya tienes la estimación.
   - Cómo: gráfico de línea del gasto estimado por semana, con la banda de incertidumbre y un texto "basado en N días de registro y X pesajes". Mostrar un aviso cuando faltan datos en lugar de un número falso.
   - Esfuerzo: M.

3. **Valores previos en línea y objetivo por serie (Hevy/Strong).**
   - Por qué: reduce toques durante el entrenamiento, que es el momento de mayor fricción.
   - Cómo: cada fila de serie muestra "anterior: 80 kg x 8" como placeholder, tocar lo copia. Si ya existe, verificar que sea visible sin abrir el ejercicio.
   - Esfuerzo: S.

4. **Calculadora de discos y de calentamiento.**
   - Por qué: la calculadora de calentamiento es un motivo de pago en Strong [verificado: 8]. Para Salud puede ser gratis y local.
   - Cómo: dado el peso de trabajo, proponer 3-4 series (por ejemplo 40%, 60%, 80% del peso) con repeticiones decrecientes, editable. Calculadora de discos con la barra configurable (20 kg, 15 kg, discos en kg y lb) y un perfil de gimnasio.
   - Esfuerzo: S.

5. **Metas de nutrientes por DRI con barras de porcentaje (Cronometer).**
   - Por qué: tu usuario es estudiante de nutrición, así que es una ventaja clara. Cronometer lo limita a Gold en parte (informes más allá de 7 días) [verificado: 2].
   - Cómo: tabla de DRI por edad y sexo (fuentes: IOM/NASEM, o las Recomendaciones de Ingesta de Energía y Nutrientes para la población colombiana, RIEN, del ICBF/Minsalud, si se desea ser local). Barras de % con colores de "bajo / suficiente / excesivo" y UL cuando exista. Atender el hecho de que Open Food Facts rara vez trae micronutrientes: mostrar "sin dato" distinto de "cero".
   - Esfuerzo: L (datos DRI + cobertura de nutrientes en la base).

6. **Widgets y atajos de acceso rápido (MacroFactor).**
   - Por qué: los widgets fueron la función más pedida de MacroFactor [verificado: 9] y reducen el flujo de registro a un toque.
   - Cómo: widget de Android con kcal/proteína restantes y un botón que abre directo la búsqueda de alimentos o el escáner. Capacitor requiere plugin nativo, por eso M.
   - Esfuerzo: M.

7. **Explicar el puntaje con una pantalla de metodología (WHOOP/Athlytic/Bevel, y el hallazgo de que ninguno publica fórmula).**
   - Por qué: los puntajes compuestos sin fórmula son una queja y una oportunidad [verificado: 7].
   - Cómo: Salud ya marca el mapa de recuperación como "estimado". Extender: cada puntaje tiene una pantalla "cómo se calcula" con la fórmula, los datos de entrada, su fecha de última actualización y sus límites. Para un "esfuerzo de entrenamiento" local, usar volumen-carga (series efectivas, RIR) en lugar de FC.
   - Esfuerzo: S para la pantalla, M para un puntaje nuevo.

8. **Pestaña de "Resumen / Insights" estilo Apple Health.**
   - Por qué: Apple la incluyó en su rediseño de 2026 [verificado: 16].
   - Cómo: tarjetas del día con reglas fijas y transparentes (por ejemplo "tu proteína promedio de 7 días es 18% menor a tu meta", "bajaste 0.4 kg/semana"). Sin IA: plantillas con umbrales documentados.
   - Esfuerzo: M.

9. **"Target strain" / recomendación diaria derivada del historial (Bevel).**
   - Por qué: convierte datos en una acción [verificado: 14].
   - Cómo: sugerir "hoy: entrenamiento fuerte / moderado / descanso" a partir del plan semanal, series recientes por músculo y sueño registrado. Mostrar las reglas.
   - Esfuerzo: M.

10. **Plan de comidas simple y lista de compras (Fitia, Premium).**
    - Por qué: es lo que Fitia reserva para pagar [verificado: 5] y encaja con tu perfil de nutrición.
    - Cómo: reutilizar las plantillas de comida y asignarlas a días de la semana, con una lista de compras agregada por alimento y gramos. Sin generación automática al inicio.
    - Esfuerzo: M.

11. **Importación y exportación CSV (Lyfta importa desde Hevy, Strong, Fitbod [verificado: 8]).**
    - Por qué: reduce la barrera para empezar y es una promesa de privacidad ("tus datos son tuyos").
    - Cómo: importar CSV de Hevy y Strong a rutinas e historial, y exportar CSV legible además del JSON actual.
    - Esfuerzo: M.

12. **Benchmark propio de tiempo de registro.**
    - Por qué: no pude verificar tap-counts. Hacerlo tú mismo es más fiable.
    - Cómo: cronometrar 5 tareas (alimento frecuente, comida completa, código de barras, receta, copiar ayer) en Salud, MacroFactor, Cronometer y Fitia, con 3 repeticiones, y registrar toques y segundos.
    - Esfuerzo: S.

13. **Laboratorios con rango normal (Guava, Apple).**
    - Por qué: encaja con "salud" y con el perfil de dietética (glucosa, colesterol, hemoglobina).
    - Cómo: entrada manual de resultados con unidad y rango de referencia editable, gráfico con la banda normal. Sin OCR.
    - Esfuerzo: M.

---

## 5. Oportunidades de diferenciación para Salud

1. **Gratis completo, sin anuncios y sin límites arbitrarios.** Competidores: Hevy limita rutinas, ejercicios y gráficos, Strong limita rutinas y gráficos, Cronometer limita reportes a 7 días y muestra anuncios, MacroFactor no tiene plan gratis, Fitia limita a 4 comidas [verificado: 2, 3, 5, 8]. Salud puede poner todo eso sin límite.
2. **Alimentos colombianos y nombres locales.** Ninguna app grande verificó cobertura propia: Fitia es la más cercana pero no pude validar su catálogo. El snapshot de Open Food Facts Colombia con variantes de nombres (por ejemplo "arepa", "caldo", "panela") es una ventaja real. Invertir en una lista curada de platos típicos colombianos con porciones caseras y fuente indicada (por ejemplo la Tabla de Composición de Alimentos Colombianos del ICBF).
3. **Funcionamiento sin conexión y privacidad por defecto.** Datos locales, perfiles múltiples locales, nube opcional. Ninguna app de peso (WHOOP, Oura) funciona sin cuenta [conocimiento previo]. Es un argumento para familias y parejas.
4. **Transparencia científica.** Los puntajes compuestos no publican su fórmula [verificado: 7]. Salud puede publicar la metodología de cada indicador, las fuentes y los límites, y marcar lo "estimado". Esto encaja con un público de nutrición.
5. **Una sola app para nutrición, entrenamiento y salud con datos cruzados.** MacroFactor lanzó Workouts en 2026 como producto aparte con paquete de 89.99 USD/año [verificado: 1], Hevy y Strong no tienen nutrición. Salud puede cruzar volumen de entrenamiento, ingesta de proteína y tendencia de peso en una misma pantalla.
6. **Mediciones antropométricas con protocolos de pliegues cutáneos.** Pocas apps los tienen. Es un nicho de dietistas y nutricionistas.
7. **Importación desde Hevy/Strong.** Facilita que otras personas prueben Salud sin perder su historial.
8. **Español neutro con modismos de Colombia** (por ejemplo "tinto", "almuerzo", "onces") como diferenciador de UX.

---

## 6. Anti-patrones a evitar

1. **Paywall de funciones básicas ya conocidas.** El escáner de MyFitnessPal pasó a Premium en 2022 [verificado: 11] y sigue siendo la función más citada en reseñas negativas de 2026 [reportado: 21]. Garmin recibió críticas por Connect+ aunque dijo que lo existente seguía gratis [reportado: 12].
2. **Gráficos e historial con tope temporal.** Hevy corta a 3 meses, Cronometer a 7 días en gratis [verificado: 2, 3]. No limitar el acceso a los propios datos.
3. **Anuncios en el plan gratuito** [reportado: 4, 20, 21].
4. **Puntajes inflados sin metodología** (strain, readiness, "scores") [verificado: 7]. Si se agrega uno, publicar entradas, fórmula y límites.
5. **Sincronización forzada o cuenta obligatoria.** Mantener la nube opcional por perfil. Las quejas sobre cuentas y sync en Fitbod y Fitia son sobre facturación y sincronización [reportado: 10, 18].
6. **Facturación confusa y suscripciones que fallan** (Fitia al cambiar de plan, Fitbod con App Store) [reportado: 10, 18]. Si en el futuro se comercializa: precio claro, restaurar compras, cancelar en un toque.
7. **Planes de entrenamiento generados que se repiten** (Fitbod) [reportado: 18]. Si se agrega generación, que el usuario pueda fijar, bloquear y variar.
8. **Bases de datos colaborativas sin verificación** (MFP: datos erróneos) [conocimiento previo]. Marcar la fuente de cada alimento (USDA, OFF, usuario) y su nivel de confianza.
9. **Subidas de precio sin funciones nuevas** (Lose It! reportado, Fitbod, Google Health Premium) [reportado: 13, 18, búsqueda de Lose It]. Fijar una política de precios previsible.
10. **OCR/IA con precisión baja activada por defecto.** Salud ya lo mantiene desactivado, lo cual es la decisión correcta hasta validar la precisión.

---

## 7. Panorama de monetización

Precios en USD de EE. UU. salvo indicación. "Reportado" = proviene de blogs o listados de terceros.

| App | Plan gratuito (límites) | Mensual | Anual | De por vida | Fuente |
|---|---|---|---|---|---|
| Hevy | Registro ilimitado, 4 rutinas, 7 ejercicios propios, 3 meses de gráficos, sin anuncios | 2.99 (hay SKU de 3.99) | 23.99 | 74.99 | verificado: 3, 6 |
| Strong | 3 rutinas, gráficos solo Pro | 4.99 | 29.99 (6 meses: 19.99) | 99.99 | verificado: 3 (blog competidor) |
| StrengthLog | Generoso (sin cifras) | ? | ? | ? | no verificado |
| Lyfta | Rutinas ilimitadas, herramientas web | ? | ? | ? | no verificado |
| Fitbod | Ninguno (prueba de 7 días) | 15.99 (otros: 12.99, 19.99) | 95.99 | solo promoción | verificado: 3; reportado: 23 |
| MacroFactor | Ninguno (prueba) | 11.99 | 71.99 (semestre: 47.99) | no | verificado: 1 |
| MacroFactor + Workouts | Ninguno | n/a | 89.99 | no | verificado: 1 |
| Cronometer Gold | Registro, escáner, 95 nutrientes, reportes de 7 días | 10.99 | 59.99 (otros: 49.99) | no | verificado: 2 |
| Fitia Premium | Hasta 4 comidas/día, solo peso | ~15,900 COP | ~95,900 COP | ? | reportado: 10 |
| MyFitnessPal Premium | Con anuncios, sin escáner | 19.99 | 79.99 (Premium+ 99.99) | ? | reportado (contradictorio: 4) |
| Yazio Pro | Limitado, con anuncios | ~6.99 | 29.99 a 47.90 | ? | reportado (contradictorio) |
| Lose It! Premium | Con anuncios | ? | 39.99 a 79.99 | 99 a 149 (promos) | reportado (contradictorio) |
| MyNetDiary Premium | Existe versión gratis | 8.99 | hasta 59.99 | ? | reportado |
| Garmin Connect+ | Todo lo existente sigue gratis | 6.99 | 69.99 | no | reportado: 12 |
| WHOOP | Ninguno (membresía + banda) | n/a (reportado: ya no estándar) | 199 / 239 / 359 | no | reportado: 7 |
| Oura | 3 puntajes sin membresía | ? | 69.99 (+ anillo 399) | no | reportado: 7 |
| Google Health Premium (ex Fitbit) | Básico gratis | 9.99 | 99.99 | no | reportado: 13 |
| Bevel Pro | App gratis con compras | 5.99 | 49.99 | ? | verificado: 14 (ficha 2025) |
| Athlytic | Gratis con compras, 1 semana de prueba | ? | ~29.99 | ? | reportado: 14 (un listado) |
| Guava Premium | App gratis | 8 | 78 | ? | reportado, marketing propio: 15 |
| Samsung Health | Gratis, plan de pago en estudio | n/a | n/a | n/a | reportado |

Lectura: el entrenamiento se cobra barato (2 a 5 USD/mes) y con compra de por vida. La nutrición se cobra entre 5 y 12 USD/mes, y MacroFactor es la única que no ofrece nada gratis. Si Salud se comercializa, la referencia razonable es un modelo tipo Hevy: núcleo completo gratis y un nivel de pago por nube/sincronización/IA, o un pago único.

---

## 8. Fuentes consultadas (acceso 2026-11)

Las que dicen "lectura directa" las abrí. Las que dicen "resultado de búsqueda" las usé solo a partir del fragmento que devolvió el buscador.

1. https://macrofactor.com/workouts/price/ (lectura directa)
2. https://cronometer.com/gold (lectura directa)
3. https://www.sensai.fit/blog/fitness-app-pricing-free-tier-comparison (lectura directa; blog de un competidor)
4. https://nutrola.app/en/blog/calorie-tracker-pricing-guide-free-vs-premium-comparison-2026 (lectura directa; blog de un competidor)
5. https://fitia.app/es/ayuda/articulos/free-vs-premium-fitia (lectura directa)
6. https://www.sensai.fit/blog/hevy-review-2026 (lectura directa; blog de un competidor)
7. https://www.sensai.fit/blog/best-whoop-alternatives-2026 (lectura directa; blog de un competidor)
8. https://www.lyfta.app/vs/hevy-vs-strong (lectura directa; marketing de Lyfta)
9. https://macrofactor.com/version-4-1-0/ (lectura directa); además notas relacionadas: https://macrofactor.com/micronutrients-nutrient-explorer/ (resultado de búsqueda)
10. https://apptail.io/app/fitia-diet-meal-planner-WQG/colombia (resultado de búsqueda, precios y reseñas de Colombia)
11. https://blog.myfitnesspal.com/barcode-scan-moving-to-myfitnesspal-premium/ (resultado de búsqueda)
12. https://www.tomsguide.com/wellness/smartwatches/garmin-launches-a-paywall-here-are-all-the-premium-connect-features-that-will-cost-you-usd6-99-a-month y https://dcrainmaker.com/2025/03/garmin-connect-plus-subscription-walkthrough.html (resultado de búsqueda)
13. https://androidauthority.com/google-health-premium-price-inclusions-features-3664507/ (resultado de búsqueda)
14. https://www.bevel.health/blog/what-is-strain-score y https://apps.apple.com/us/app/bevel-all-in-one-health-app/id6456176249 y https://apps.apple.com/CA/app/id1543571755 (Athlytic) (resultados de búsqueda)
15. https://guavahealth.com/plans y https://guavahealth.com/ (resultado de búsqueda)
16. https://apple.com/newsroom/2026/09/apple-advances-health-and-fitness-capabilities-using-apple-intelligence/ y https://macrumors.com/guide/ios-27-health-app-new-features (resultado de búsqueda)
17. https://www.hevyapp.com/community-updates/july-26/ y la ficha de Hevy en App Store (resultado de búsqueda)
18. https://dr-muscle.com/fitbod-workout-app-review/ y https://www.trustpilot.com/review/fitbod.me (resultado de búsqueda)
19. https://nutrola.app/en/blog/why-is-macrofactor-so-bad-now y https://nutrola.app/en/blog/is-macrofactor-worth-it-2026 (resultado de búsqueda; blog de un competidor, sesgado)
20. https://nutrola.app/en/blog/is-cronometer-free-2026 (resultado de búsqueda; blog de un competidor)
21. https://kimola.com/reports/unlock-user-insights-myfitnesspal-feedback-analysis-report-google-play-en-us-142066 y https://unstar.app/blog/is-myfitnesspal-premium-worth-it-paywall-app-reviews-2026 (resultado de búsqueda; agregadores de reseñas)
22. https://nutrola.app/en/blog/how-much-does-lose-it-cost-2026 (resultado de búsqueda; precios contradictorios)
23. https://www.techradar.com/health-fitness/fitbod-app-review y https://www.garagegymreviews.com/fitbod-review (resultado de búsqueda)
24. https://www.lyfta.app/usage/best-fitness-log-app y https://www.boostcamp.app/best/workout-apps (resultado de búsqueda; StrengthLog)
25. https://www.sensai.fit/blog/hevy-vs-caliber-2026 (resultado de búsqueda; precios de Hevy)
