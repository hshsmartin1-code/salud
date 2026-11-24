# Salud — hoja de ruta priorizada

Fecha: 2026-11-24 · Base: v3.2.1 · Rama de trabajo: `evolucion/integral-2026-11`

Fuentes de la priorización: [AUDIT.md](AUDIT.md) (auditoría técnica, de seguridad y científica), [COMPETITIVE_RESEARCH.md](COMPETITIVE_RESEARCH.md) (21 apps) y la revisión visual con capturas reales (390×844 y 1366×900, claro/oscuro, semilla demo).

## Criterios

Cada oportunidad se puntúa con **impacto** (beneficio real para quien registra a diario: tiempo ahorrado, fiabilidad del dato, decisiones mejor informadas), **esfuerzo** (S ≤ 1 día, M 2–4 días, L > 1 semana de una persona), **riesgo** (posibilidad de perder datos o romper la sincronización) y **dependencias**. Primero va lo que protege los datos y la exactitud de los números. Después, lo que ahorra tiempo en el registro diario. Las funciones nuevas van al final.

Principios que no se negocian:
- Los datos existentes se conservan. Las migraciones son aditivas y probadas.
- Una estimación nunca se presenta como medición. Toda cifra calculada tiene metodología escrita ([docs/METODOLOGIA.md](docs/METODOLOGIA.md)).
- No hay muros de pago, anuncios ni telemetría. Ninguna función personal existente se limita.
- Primero el móvil, con una mano y sin conexión.

## Estado por oleadas

Leyenda: ✅ implementado y verificado · 🟡 parcial · ⏳ en curso · ⬜ pendiente

### Oleada 1 — profundidad funcional diferencial (en paralelo, worktrees aislados)

| # | Oportunidad | Referencia | Impacto | Esfuerzo | Riesgo | Estado |
|---|---|---|---|---|---|---|
| 1.1 | Informe de nutrientes del día, 7 y 30 días frente a valores de referencia (NASEM/IOM; estructura lista para la RIEN 2016), cobertura de datos, AMDR, límites de salud pública y distribución por comida | Cronometer | Alto (perfil de nutricionista) | M | Bajo (solo lectura) | ⏳ |
| 1.2 | Sesión activa: calculadora de discos, generador de calentamiento y 1RM estimado visible | Strong, Hevy | Alto | M | Medio (sesión persistente) | ⏳ |
| 1.3 | Portabilidad: exportación CSV (series, comida, peso) e importación de historiales de Hevy y Strong desde sus exportaciones oficiales, idempotente | Hevy, Strong | Alto (adquisición y confianza) | M | Medio (escritura masiva) | ⏳ |

### Oleada 2 — fiabilidad, exactitud y coste

| # | Oportunidad | Origen | Impacto | Esfuerzo | Riesgo | Estado |
|---|---|---|---|---|---|---|
| 2.1 | Límites de error en React y recarga ante fallos de carga de fragmentos tras una actualización | Auditoría ALTO | Alto | S | Bajo | ⏳ |
| 2.2 | Hábitos y marcas de día completo con id determinista y transacción (valores duplicados) | Auditoría, error confirmado | Medio | S | Bajo | ⏳ |
| 2.3 | Un solo cálculo del objetivo calórico para Hoy y Comida (`addActivityKcal`) | Auditoría, error confirmado | Medio | S | Bajo | ⏳ |
| 2.4 | El ajuste adaptativo automático no se aplica dos veces el mismo día | Auditoría, error confirmado | Medio | S | Bajo | ⏳ |
| 2.5 | Sincronización: menos lecturas de Firestore por ciclo, sin conflictos solo de marca de tiempo y con detección de duplicados probables al «Unir» | Auditoría ALTO | Alto (plan Spark) | M | Alto (se prueba con memoryRemote) | ⏳ |
| 2.6 | Correcciones científicas: rango válido del 1RM (≤ 10 reps), edades de Jackson-Pollock en mujeres, verificación energía-macros con carbohidratos disponibles y fibra, terminología | Auditoría científica | Alto (credibilidad) | S | Bajo | ⏳ |
| 2.7 | Método RIEN Colombia (Schofield × PAL) opcional, avisos no bloqueantes en objetivos, estado fisiológico (embarazo/lactancia), densidad energética según % de grasa, PA como «lectura aislada», SpO₂ y altitud, promedios sin días incompletos | Auditoría científica | Alto | M | Medio (campos opcionales nuevos) | ⏳ |
| 2.8 | `docs/METODOLOGIA.md`: todas las fórmulas, fuentes, supuestos y límites | Auditoría científica | Alto | S | Nulo | ⏳ |
| 2.9 | CI para PR y ramas: tipos, lint, unitarias, build, e2e en Chromium y reglas en el emulador | Auditoría ALTO | Alto | S | Nulo | ✅ |

### Oleada 3 — experiencia diaria y rendimiento

| # | Oportunidad | Referencia | Impacto | Esfuerzo | Riesgo | Estado |
|---|---|---|---|---|---|---|
| 3.1 | Investigar y corregir los 5 e2e que fallan de forma reproducible (incluye un valor de peso que pierde su primer carácter tras un cierre brusco) | QA | Alto | S–M | Medio | ⬜ |
| 3.2 | Densidad de Hoy, Entreno y Salud: menos tarjetas, más filas y bandas, menos desplazamiento, iconografía no alarmista para promedios informativos | Revisión visual | Alto | M | Bajo | ⬜ |
| 3.3 | Peso de tendencia (media exponencial) como cifra principal, con pesajes crudos atenuados y explicación del retraso | MacroFactor | Alto | S | Bajo | ⬜ |
| 3.4 | Registro rápido: selección múltiple en la búsqueda y entrada rápida de kcal y macros sin alimento | MacroFactor, Cronometer | Alto | M | Bajo | ⬜ |
| 3.5 | Arranque más ligero: zod fuera del fragmento inicial, consultas en vivo acotadas (series, fotos), medición antes y después | Auditoría | Medio | M | Bajo | ⬜ |
| 3.6 | CSP en `index.html` y `dataExtractionRules` en Android | Auditoría | Medio | S | Medio (no romper Firebase y OTA) | ⬜ |

### Pendiente con justificación (siguiente ciclo)

| Oportunidad | Por qué no ahora |
|---|---|
| Tablas de micronutrientes de la RIEN 2016 por edad y sexo | Hay que transcribirlas del anexo técnico oficial con verificación valor por valor. La estructura del módulo ya admite un segundo conjunto de referencia. |
| Adecuación probabilística (método EAR del IOM 2000) | Depende de la tabla anterior y de una cobertura de datos alta. |
| Widget de Android (kcal y proteína restantes) | Requiere código nativo y probarlo en un teléfono. En este entorno no hay SDK de Android ni dispositivo. |
| Plan semanal de comidas con lista de compras | Esfuerzo L. Reutilizará plantillas y recetas. |
| Platos colombianos curados con porciones caseras | Exige fuentes con licencia compatible. La TCAC del ICBF no se puede redistribuir. Se puede derivar de ingredientes USDA con receta documentada. |
| OCR de etiquetas | Sigue desactivado hasta medir su precisión con fotos reales. Así lo pide el criterio del propietario. |
| Lista de cuentas permitidas en Firestore y App Check | No se pueden poner correos en un repositorio público. Requiere una colección `allowlist` administrada desde la consola y un despliegue manual de reglas. Documentado en HANDOFF_CODEX.md. |
| Exportación cifrada del respaldo | Esfuerzo M. Conviene definir la gestión de contraseñas y la recuperación antes de hacerla. |
| Detección de duplicados de alimentos personalizados | Esfuerzo M. Va después de la selección múltiple. |
