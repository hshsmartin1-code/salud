# Changelog

## 3.2.1 — 2026-11-18 (paquete de interfaz)

- Búsqueda local por nombre, marca y código, con variantes colombianas y tolerancia a errores de escritura. Open Food Facts permite ampliar resultados y filtrar por Colombia.
- Registro de un alimento a partir de una frase o etiqueta pegada. Se revisan la cantidad, la base nutricional y la comida antes de guardar. Las entradas con nutrición pendiente se pueden completar desde el diario.
- En móvil, los resultados locales aparecen primero. La hoja de cantidad agrupa los detalles secundarios, mantiene la acción principal a mano y respeta el movimiento reducido.

## 3.2.0 — 2026-11-16 (paquete de interfaz)

Llega como actualización dentro de la app a una instalación 3.1.1 o posterior. Mismo esquema de datos; nada se migra.

- **Diario:** deslizar a izquierda o derecha cambia de día (las flechas, el calendario y «Hoy» siguen ahí). Sin bloque de datos incompletos ni triángulos: el `*` de un total parcial se puede tocar y explica qué falta. Sin sugerencias bajo cada comida: solo una línea discreta en la comida de la hora con lo que sueles registrar ahí. «Copiar comida anterior» en el menú de cada comida, eligiendo fecha, alimentos y cantidades, con Deshacer.
- **Tiempos de comida:** de uno a seis por perfil, con nombre, orden y hora habitual opcional (Ajustes → Tiempos de comida). Ocultar un tiempo no borra ni esconde sus registros.
- **Hoy:** primero el resumen del día y las acciones rápidas, después los indicadores. El entrenamiento solo aparece arriba cuando está planificado para hoy; sin meta de pasos no se dibuja progreso.
- **Mi planificación (Entreno):** días de entrenamiento y descanso por semana, rutina opcional por día, mover una sesión solo esta semana, próxima sesión y recordatorio opcional con hora. Planificar no crea ni cambia sesiones.
- **Correcciones:** ediciones simultáneas de preferencias, avisos huérfanos, identificadores de aviso, cantidades copiadas y validaciones del actualizador.

## 3.1.1 — 2026-11-16 (APK de arranque)

- Misma interfaz que 3.1.0 con las actualizaciones dentro de la app encendidas: comprobación automática al abrir y al volver (como mucho cada 6 horas, sin rastro si falla), aviso «Actualización disponible» con «Actualizar» y «Reiniciar», y «Novedades de esta versión» en Ajustes → Actualizaciones.
- Paquetes firmados y verificados, HTTPS, reversión automática si la interfaz nueva no arranca. Sin instalación silenciosa ni permisos nuevos.
- Es la última instalación manual necesaria mientras no cambie la parte nativa.

## 3.0.0 — 2026-11-16

### Entreno

- Sesión en vivo con valores de la vez anterior, marcado de series en un toque, tipos de serie, repeticiones en reserva, notas y descanso persistente.
- Al terminar se puede conservar lo escrito o descartar las series pendientes; Deshacer reabre la sesión cuando no sobrescribe cambios posteriores. Un fallo de guardado impide finalizar.
- Los récords aparecen al completar una serie y en la hoja de cierre. Las sugerencias de progresión y «Aplicar a las siguientes» permiten cambiar las series pendientes mediante una acción explícita.
- Biblioteca de rutinas con inicio directo, búsqueda, orden por arrastre y teclado, plantillas de partida, archivo y restauración. Calendario de cinco semanas y constancia semanal.
- Detalle de ejercicio con historial, récords, técnica y sustituciones; medios compartidos con ampliación, pausa, reintento y alternativa visual cuando falta ilustración.
- Mapa muscular con recencia del entrenamiento, series recientes y ventanas orientativas explicadas. Son estimaciones, con etiquetas y texturas además del color.

### Nutrición

- Alimentos frecuentes, repetición de otra comida y plantillas se registran con sus cantidades y valores guardados, con Deshacer. Los registros respetan el día y la comida elegidos.
- La búsqueda prioriza alimentos usados y separa los resultados con nombre en inglés. «Seguir agregando» mantiene abierta la búsqueda y recuerda la preferencia por perfil.
- Ideas para completar la energía, proteína o fibra restantes, basadas en los objetivos y registros del día, con explicación de los números y de la comida de destino.
- La comida sugerida por la hora se actualiza al pasar la medianoche y al reanudar; una selección explícita de comida se conserva.
- Recetas con notas, porciones y peso cocido; guardarlas dos veces ya no crea dos recetas. Los ingredientes admiten cantidades de preparación de hasta 50 kg o L y las recetas hasta 1.000 porciones.
- Etiquetas manuales o de texto pegado con revisión de datos inciertos, unidades y rangos visibles. Los límites distinguen masa de volumen y no suponen el peso de un envase sin tamaño declarado.
- Guardar una etiqueta dos veces, incluso antes de que termine de cargar su consulta de edición, conserva una sola fila; los fallos permiten reintentar sin perder el formulario.
- Deshacer una adición rápida protege una fila editada después y evita recuperar un estado de recientes ya deshecho.

### Salud

- Panel de peso y paneles compactos de las métricas con datos; periodo compartido, cobertura, fuente, detalle y comparación gráfica con el periodo anterior.
- Registro rápido de peso, agua, sueño, presión, glucosa y actividad desde hojas sobre la pantalla actual, con avisos de guardado y Deshacer.
- Las escrituras de presión y pulso se completan juntas; las series distinguen registros propios, importados y datos sin cobertura suficiente.
- Una sincronización conserva el texto del editor de mediciones y avisa si cambió la fila. Recargar descarta la edición; Guardar combina solo los campos modificados con los valores actuales, en una transacción.
- El detalle de sueño muestra la variación de las horas de acostarse y levantarse cuando hay suficientes noches con horario, teniendo en cuenta el cruce de medianoche.

### Hoy

- Acciones para iniciar o continuar el entrenamiento habitual, buscar comida para la hora actual y registrar agua, peso o sueño.
- El botón universal «Registrar» ofrece las acciones frecuentes desde cualquier pantalla y recipientes de agua en un toque.
- Hoy, Comida, Salud, Progreso y las vistas principales de Entreno siguen el cambio de fecha local y la reanudación de la aplicación.

### Sistema de diseño y gráficas

- Tipografía Archivo, escalas de texto y componentes comunes para filas, secciones, indicadores, hojas y estados vacíos en temas claro y oscuro.
- Gráficas compartidas con lectura por teclado y arrastre, tablas de datos, cobertura y selección del valor mostrado; Progreso deja las barras antiguas.
- Contornos más visibles para campos, chips y botones secundarios; animaciones y reproducción respetan la preferencia de movimiento reducido.

### Sincronización y respaldos

- Conflictos con etiquetas en español, fechas y unidades legibles; los valores nutricionales distintos se muestran con sus cifras. Las acciones que aceptan un borrado piden confirmación.
- Elegir una sola versión editada también pide confirmación. Los conflictos muestran un resumen por tipo de registro y todas sus diferencias, sin ocultarlas después del décimo campo.
- Reemplazar un respaldo pide confirmación y espera la entrega de una copia previa; si falla, no importa. Un respaldo de otro perfil conserva la identidad y preferencias del destino.
- La importación llama «Añadir a lo existente» a su modo no destructivo, para distinguirlo de Combinar versiones de un conflicto.
- La exportación no registra un respaldo exitoso cuando la plataforma no admite la entrega del archivo o se cancela. El nombre del archivo usa la fecha local.
- Se mantienen la sincronización opcional, la separación de perfiles y los formatos de datos existentes.

### Accesibilidad y rendimiento

- Las suites de accesibilidad y maquetación incluyen sesión en vivo, sesión terminada, Entreno, rutinas y Comida, además de las pantallas de Salud.
- Controles de sesión ampliados, nombres accesibles y hojas con gestión de foco. Las ilustraciones se cargan al necesitarlas; varias rutas y paneles usan carga diferida.
- Se muestran fallos de escritura y un aviso global de último recurso. Mejora de tiempo de carga y consumo de memoria de este corte: **no medido**.

### Datos y seguridad

- Finalización y Deshacer comprueban los cambios posteriores; el borrado de una sesión y sus series es atómico.
- Se conservan los nutrientes históricos al repetir registros y al editar su cantidad desde los valores guardados. Un dato ausente sigue siendo desconocido.
- Los números manuales rechazan agrupaciones mixtas mal formadas, espacios internos y separadores finales. Se conservan la coma decimal, los miles válidos y la regla de «1.200» = 1200; las etiquetas impresas mantienen su lectura propia de miles con espacios.
- Sin migración de Dexie, cambio de versión de respaldo, tablas de sincronización, códec o reglas de Firestore en esta entrega.

### Otros cambios

- **Escritorio:** Comida (diario a dos columnas con tabla de alimentos; búsqueda con el editor de cantidad en un panel lateral) y Entreno (banda semanal, dos columnas, biblioteca e historial como tablas) dejan de ser la columna del teléfono estirada. El teléfono no cambia.
- **Figura anatómica:** vistas más grandes en Estado muscular, vista ampliada «Mapa muscular» con Frente/Espalda y color ajustado en tema claro.
- **Android:** botón Atrás, exportación de respaldos y aviso de fin de descanso cableados con complementos nativos (ver Limitaciones).
- **Entreno al empezar la semana:** la comparación semanal es hasta el mismo día de la semana anterior; sin sesiones no hay flechas y se muestra la semana pasada como referencia; la media de volumen no cuenta la semana en curso.
- **Perfiles:** «Agregar perfil» ya no reinicia el asistente ni crea perfiles duplicados.
- **Números:** se rechazan entradas mal formadas («1.2,3»); una medición corporal en edición no se pisa por una sincronización.
- **Pruebas:** la suite de extremo a extremo corre con un reloj fijo y se comprobó en cuatro momentos (lunes 00:10, domingo 23:50, día 1 de mes, miércoles por la tarde).

### Limitaciones conocidas

- No probado en un dispositivo Android físico. El botón Atrás nativo (cierra hojas, respeta cambios sin guardar, minimiza la sesión), la exportación de respaldos a Documentos/Salud con «Compartir» como alternativa y el aviso de fin de descanso ya están cableados con los complementos oficiales de Capacitor (`@capacitor/app`, `filesystem`, `share`, `local-notifications`) y quedan registrados dentro del APK 3.0.0 de pruebas, pero solo se han verificado con pruebas unitarias y sustitutos web: permisos, segundo plano, retraso de la alarma inexacta, ubicación real del archivo, teclado y Health Connect requieren una prueba manual en un teléfono.
- Las ilustraciones cubren **171 de 873 ejercicios**; el resto usa una alternativa visual. El pack RepDB exige atribución y mantiene la incertidumbre documentada sobre publicar sus activos en un repositorio público.
- La figura anatómica usa BodyParts3D; versión y atribución en `docs/V3_MUSCLE_RECOVERY.md`.
- Siguen pendientes superseries/circuitos, arrastre de ejercicios dentro de la sesión, calculadora de discos, descanso por serie, fuerza relativa, proyección de peso objetivo, huecos semanales de micronutrientes, recordatorios de agua y exportación CSV.
- La progresión y recuperación requieren revisión de producto; el incremento sugerido para mancuernas es 2 kg. La pantalla permanece encendida solo si se activa el ajuste. El resumen terminado aún no compara con la última sesión ni muestra barras musculares; la constancia cuenta semanas con al menos una sesión.
- Hoy conserva la diferencia entre último peso y tendencia, el resumen largo y textos de hábitos ambiguos. Faltan uniformidad de textos de sueño/registro/repetición y migración visual de varias pantallas de datos. No hay selección múltiple de ejercicios ni acción rápida de alimento nuevo sin historial.
- Las consultas amplias de Hoy y del historial de ejercicios siguen pendientes de optimización; su impacto en uso prolongado está **no medido**. La dependencia Recharts se retiró.
- Quedan por remedir el área efectiva de chips de ejercicios, la alineación de algunas acciones y la cobertura accesible específica de las gráficas de Progreso. Las pruebas web no acreditan comportamiento nativo ni durabilidad antes de completar una escritura pendiente.
- Los límites de cantidades y tamaños son operativos: preparaciones por encima de 50 kg/L, recetas por encima de 1.000 porciones y tamaños de etiqueta superiores a los rangos del formulario siguen restringidos. El escáner necesita conexión para consultar Open Food Facts; el OCR de fotos está temporalmente desactivado.

## 2.2.1 — 2026-11-15

- Firebase activado para el proyecto propio: configuración web en `.env.local` y `google-services.json` en Android, ambos fuera de Git. Reglas e índices de Firestore publicados y verificados: sin sesión, todo se rechaza.
- APK con inicio de sesión nativo de Google: plugin `@capacitor-firebase/authentication` compilado y registrado, recursos de `google-services` y cliente OAuth web incluidos (versionCode 5, misma firma, se instala encima).
- Sincronización más robusta, sin cambiar la arquitectura:
  - un registro rechazado o demasiado grande ya no bloquea al resto;
  - un documento ilegible de la nube se omite;
  - un dispositivo detecta que otro borró y volvió a crear la nube (`cloud-reset`);
  - las sincronizaciones parciales se informan con conteos, nunca con datos.
- Las compilaciones del emulador ignoran el proyecto real de `.env.local`.
- Pruebas nuevas de integridad (nutrición, entreno, objetivos y preferencias entre dispositivos), del límite conocido de «ambos» en sesiones y del aislamiento. El verificador del APK comprueba la configuración de Firebase sin imprimir secretos.
- Verificación: 517 pruebas unitarias, 34 E2E, 16 pruebas en emulador, 1 E2E de cuenta, TypeScript, lint, build web y Android. El inicio de sesión real con Google y la sincronización contra el proyecto real no están probados en un teléfono.

## 2.2.0 — 2026-11-15

- Cuentas de Google opcionales **por perfil**: una instancia de Firebase por perfil local, así que dos personas pueden tener sesión a la vez en el mismo teléfono sin cruzar datos. Web con ventana de Google; Android con Credential Manager (`@capacitor-firebase/authentication`, solo compilado si existe `google-services.json`).
- Sincronización sin conexión primero con Cloud Firestore: Dexie sigue siendo la fuente principal; cola derivada de una sombra por fila (sobrevive a cierres), bajada incremental con solape, revisiones verificadas por el servidor, idempotencia ante respuestas perdidas, lápidas para borrados, retención de borrados masivos y conflictos que conservan ambas versiones hasta que la persona elige.
- Pantalla «Cuenta y sincronización»: vista previa de datos locales y de la cuenta, unir o descargar en un perfil nuevo, confirmación explícita (doble si el nombre no coincide), verificación por conteos, estado, conflictos, cerrar sesión, desvincular y borrar la nube.
- Esquema Dexie v5 aditivo (`syncLinks`, `syncShadow`, `syncConflicts`), fuera de los respaldos.
- `firestore.rules` (denegar por defecto, por uid, esquema estricto, revisión +1, hora del servidor) con pruebas en el emulador; guía de configuración, seguridad, costos del plan Spark y riesgos.
- Núcleo OTA firmado (ECDSA P-256), compatibilidad nativa y de esquema, integridad y reversión automática; **desactivado**, sin plugin nativo ni descargas. Hoja de ruta de Google Play In-App Updates.
- Fotos y Health Connect no se sincronizan. APK 2.2.0 (versionCode 4), misma firma; no probado en teléfono real.
- Verificación: 506 pruebas unitarias, 34 E2E, 14 pruebas en emulador de Firebase, 1 E2E de cuenta con emuladores, TypeScript, lint, build web y Android.

## 2.1.0 — 2026-11-15

- Medidas caseras por alimento: medidas de la fuente (USDA; OFF solo con unidad segura) primero, con chips rápidos, cantidades fraccionarias y equivalencia visible. Ninguna medida se reutiliza en otro alimento ni convierte g ↔ ml.
- Medidas propias por perfil (tabla `foodPortions`, esquema Dexie v4 aditivo): crear, editar y eliminar; incluidas en el respaldo, remapeadas al importar en otro perfil y validadas al restaurar.
- Los registros guardados conservan sus gramos y nutrientes aunque luego cambie o desaparezca la medida; editar un registro ofrece la opción «registro guardado».
- Open Food Facts: unidad de porción y de envase exigida y comprobada; se rechazan contradicciones, multipacks ambiguos y porciones mayores que el envase.
- Registro: «Seguir agregando alimentos» y «Repetir de otra fecha» (fecha y comida de origen elegibles).
- Centro de control: indicadores elegibles, ordenables y ocultables por perfil; aviso de resumen parcial cuando faltan macros.
- Etiquetas: lectura de fotos desactivada hasta medir su precisión con fotos reales; se mantienen escribir, pegar texto y código de barras. Parser corregido para rótulos en inglés y «Per 100 ml»; los campos inciertos exigen confirmación antes de guardar.
- Hojas modales ajustadas al teclado móvil (`visualViewport`), con el botón de guardar siempre visible.
- APK 2.1.0 (versionCode 3), mismo paquete y misma firma; sin modelo OCR empaquetado (14,0 MiB). No probado en teléfono real.
- Verificación: 465 pruebas unitarias, 34 E2E, TypeScript, lint, build web y Android.

## 2.0.0 — 2026-11-15

- Centro de control, navegación Salud y Más, signos vitales, agua y fotos por perfil.
- Health Connect de solo lectura mediante plugin Kotlin local: consentimiento por categoría, importación incremental, fuentes, exclusiones y desconexión. No validado en teléfono real.
- Esquema Dexie v3 aditivo; respaldo v2 con tablas explícitas, fotos opcionales, vista previa, ids deterministas e integridad.
- Biblioteca de ejercicios con filtros, favoritos, historial, alternativas y sustituciones; gasto adaptativo V2 y objetivos opcionales de pasos/agua.
- Estabilización: rechaza destinos de restauración compartidos, declaraciones de tablas ambiguas, perfiles repetidos y fechas imposibles; conserva historial inicial al activar categorías o reconectar; informa revocaciones y paginación incompleta.
- Prueba de actualización real Dexie v2 → v3, cobertura E2E V2, foco de teclado y restauración del foco en hojas modales.
- Carga diferida de respaldo, etiquetas e integraciones; avisos de terceros empaquetados, atribución de datos de ejercicios corregida.
- Versión web y Android 2.0.0; versionCode 2.

## 1.1.0

Rediseño, captura/OCR local de etiquetas, ilustraciones RepDB, energía adaptativa y contenedor Android. Base de V2: commit `850f764`.
