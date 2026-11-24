# Metodología científica de Salud

Este documento reúne **todas las fórmulas, umbrales y supuestos** que usa la app para calcular objetivos, estimar el gasto, describir la composición corporal, el entrenamiento y los signos vitales. Para cada uno se indica la fuente, el supuesto y la limitación. Lo que la app muestra es siempre una **estimación orientativa**: no es un diagnóstico, no es consejo médico y no reemplaza la valoración de un profesional de la salud.

Convenciones: kcal = kilocaloría (1 kcal = 4,184 kJ, caloría termoquímica). TMB = tasa metabólica basal. GER = gasto energético en reposo. GET = gasto energético total. PAL = nivel de actividad física (GET/TMB). EE = error estándar. Los valores desconocidos nunca se cuentan como cero.

El código fuente de cada fórmula se indica entre corchetes, p. ej. [`src/domain/energy.ts`].

---

## 1. Energía y objetivos [`src/domain/energy.ts`]

### 1.1 Ecuación de Mifflin-St Jeor (método predeterminado)

```
GER (kcal/día) = 10·peso(kg) + 6,25·estatura(cm) − 5·edad(años) + 5   (hombres)
                                                                 − 161 (mujeres)
```

- **Fuente:** Mifflin MD y cols. *Am J Clin Nutr* 1990;51:241-7 (PMID 2305711). Forma simplificada publicada; los autores indican que redondear los coeficientes no cambia la capacidad predictiva.
- **Población de derivación:** 498 adultos sanos de 19 a 78 años, con peso normal y obesidad. Frankenfield y cols. (2005) la señalan como la ecuación con más probabilidad de quedar dentro de ±10 % del gasto medido en adultos no obesos y obesos.
- **Supuesto:** estima el gasto en reposo (GER); la app lo rotula como «TMB» por costumbre. La diferencia entre ambos es pequeña frente al error de la ecuación.
- **Limitaciones:** error individual típico de ±10 % o más; subestima en personas con mucha masa libre de grasa (deportistas); no está validada por debajo de 19 años.

### 1.2 Factores de actividad (con Mifflin-St Jeor)

| Nivel | Factor | Descripción en la app |
|---|---|---|
| Sedentaria | 1,2 | Sin ejercicio y casi siempre sentada/o (p. ej., < 5000 pasos al día) |
| Ligera | 1,375 | Ejercicio ligero 1–3 días por semana |
| Moderada | 1,55 | Ejercicio moderado 3–5 días por semana |
| Alta | 1,725 | Ejercicio intenso 6–7 días por semana |
| Muy alta | 1,9 | Entrenamiento muy intenso o trabajo físico exigente |

`GET estimado = TMB × factor`.

- **Fuente:** multiplicadores divulgados por textos de fisiología del ejercicio (tradición de McArdle, Katch y Katch) y por la mayoría de calculadoras. **No** provienen de estudios con agua doblemente marcada.
- **Limitación:** 1,2 queda por debajo del rango «sedentario o ligero» de FAO/OMS/UNU 2004 y de la RIEN (PAL 1,40–1,69). En personas con trabajo de escritorio el objetivo inicial puede salir bajo; el ajuste adaptativo (§2) lo corrige con datos reales tras varias semanas. Se conservan como método predeterminado para no cambiar ningún objetivo ya guardado.

### 1.3 Método «RIEN Colombia (Schofield × PAL)» (opcional)

Es el método oficial de las **Recomendaciones de Ingesta de Energía y Nutrientes para la población colombiana** (RIEN, Resolución 3803 de 2016 del Ministerio de Salud y Protección Social): TMB por las ecuaciones de Schofield, multiplicada por el PAL.

**TMB de Schofield para adultos (kcal/día), según FAO/OMS/UNU 2004, tabla 5.2** (verificada en el informe de la FAO):

| Edad | Hombres | EE | Mujeres | EE |
|---|---|---|---|---|
| 18–30 años | 15,057·peso + 692,2 | 153 | 14,818·peso + 486,6 | 119 |
| 30–60 años | 11,472·peso + 873,1 | 167 | 8,126·peso + 845,6 | 111 |
| ≥ 60 años | 11,711·peso + 587,7 | 164 | 9,082·peso + 658,5 | 108 |

La app interpreta las franjas como 18–29, 30–59 y ≥ 60 años cumplidos. No se ofrece por debajo de 18 años (las ecuaciones de adolescentes requieren además la energía de crecimiento).

**Bandas de PAL (FAO/OMS/UNU 2004, tabla 5.3; RIEN):**

| Estilo de vida | Rango de PAL | PAL usado (punto medio) |
|---|---|---|
| Ligera o sedentaria | 1,40–1,69 | 1,55 |
| Moderada | 1,70–1,99 | 1,85 |
| Intensa | 2,00–2,40 | 2,20 |

La FAO advierte que un PAL > 2,40 es difícil de sostener en el tiempo.

- **Supuestos:** se usa el punto medio de la banda; el peso es el único predictor (no la estatura).
- **Limitaciones:** las ecuaciones de Schofield se derivaron sobre todo de poblaciones europeas y norteamericanas, y se ha descrito que sobrestiman la TMB en algunas poblaciones tropicales (Henry 2005); el EE individual es de 108–167 kcal/día.
- **Datos guardados:** el objetivo guarda `inputs.method = 'rien'`, `inputs.palBand` y `inputs.pal`. Para compatibilidad con versiones antiguas también guarda en `activity` el nivel más cercano (ligera → «Moderada», moderada → «Alta», intensa → «Muy alta»); las versiones nuevas no lo usan para este método.

### 1.4 Objetivo según la fase

| Objetivo | Cálculo | Valor por defecto |
|---|---|---|
| Perder grasa | GET − déficit | 400 kcal |
| Ganar masa | GET + superávit | 250 kcal |
| Mantener / Recomposición | GET | — |

### 1.5 Mínimo de seguridad orientativo (compartido con el módulo adaptativo)

```
mínimo = máx(TMB, 1200 kcal en mujeres / 1500 kcal en hombres, 1000 kcal)
```

- En el cálculo del objetivo, el mínimo **nunca supera el GET estimado**: un piso no debe convertir un objetivo en superávit. Si el GET de una persona es menor que 1200/1500 kcal, no queda margen para un déficit y la app lo dice.
- **Fuente:** heurística clínica habitual; no tiene base experimental como requerimiento. Se rotula como «referencia clínica, no un requerimiento».

### 1.6 Macronutrientes

| Nutriente | Regla | Por defecto | Referencia |
|---|---|---|---|
| Proteína | g/kg × peso total | 1,8 g/kg (2,0 en recomposición) | ISSN 2017: 1,4–2,0 g/kg en personas que entrenan; Morton y cols. 2018 (PMID 28698222): sin ganancia adicional de masa libre de grasa por encima de ~1,62 g/kg/día |
| Grasa | % de la energía ÷ 9 | 27 % | AMDR 20–35 % (IOM 2005; RIEN adultos) |
| Carbohidratos | resto = (kcal − 4·P − 9·G) ÷ 4 | — | RDA 130 g/día (IOM 2005) |
| Fibra | 14 g por 1000 kcal | 14 | Base de la ingesta adecuada del IOM (2005) |

### 1.7 Avisos que no bloquean

Se muestran y se guardan con el objetivo (calculado o manual); **nunca cambian las cifras**:

- proteína < 0,8 g/kg/día (RDA, IOM 2005);
- grasa fuera de 20–35 % de la energía (AMDR);
- carbohidratos < 130 g/día (RDA, IOM 2005);
- IMC ≥ 30 con la proteína calculada sobre el peso total: se sugiere un **peso de referencia** con IMC 25 (`25 × estatura²`), porque con obesidad g/kg × peso total sobrestima la necesidad.

### 1.8 Menores de 18 años, embarazo y lactancia

- **Menores de 18:** las ecuaciones no están validadas y el requerimiento incluye la energía depositada en el crecimiento. No se aplica déficit, la opción «Perder grasa» queda desactivada, el modo adaptativo automático se apaga y se recomienda orientación profesional.
- **Embarazo y lactancia** (campo opcional del perfil «Estado fisiológico»): las ecuaciones no incluyen su costo energético (IOM 2005, solo como contexto: +340 kcal en el 2.º trimestre, +452 kcal en el 3.º y +330 kcal en la lactancia de 0 a 6 meses). Además, el aumento de peso gestacional sería interpretado como superávit por el módulo adaptativo. Por eso no se aplica déficit, el ajuste adaptativo no propone ni aplica cambios (la estimación solo es informativa) y se pide valoración profesional.

---

## 2. Gasto adaptativo [`src/domain/adaptiveEnergy.ts`, `src/features/energy/adaptive.ts`]

### 2.1 Identidad de balance usada

```
GET observado ≈ ingesta media − (tendencia del peso, kg/semana) × ρ / 7
```

donde ρ es la densidad energética del cambio de peso (kcal/kg). Es una forma estática y simplificada del balance energético (Hall 2008).

### 2.2 Ventana y suficiencia de datos

- Ventana: 28 días que terminan **ayer** (hoy aún se está registrando); configurable a 42 o 56 (rango interno 21–91).
- Días válidos de ingesta: al menos máx(14, ⌈60 % de la ventana⌉) (17 de 28).
- Pesos: al menos 8 días con peso válido, y 14 días o más entre el primero y el último.
- El historial debe cubrir toda la ventana.

### 2.3 Qué días de ingesta se excluyen

Un día sin registros, sin alimentos o sin kcal es «faltante». Además se excluye un día si:

1. está **marcado como incompleto**;
2. tiene alimentos sin kcal (total parcial) y no está confirmado como completo;
3. tiene menos de máx(800, 0,5·TMB) kcal y no está confirmado como completo;
4. tiene más de máx(7000, 3·GET de fórmula) kcal (error de registro probable).

**Supuesto:** los días faltantes se parecen a los registrados (faltan al azar). El subregistro sistemático no se puede detectar; solo los resultados implausibles (§2.7).

### 2.4 Tendencia del peso

1. Se promedia el peso de cada día (varias tomas cuentan una vez); se descartan los pesos marcados como aproximados o excluidos.
2. **Atípicos:** se quita la tendencia con la pendiente de Theil-Sen y se compara cada residuo con la mediana móvil centrada de 7 puntos (sin el propio punto). Es atípico si |residuo| > 3,5 × máx(1,4826·MAD, 0,3 kg): puntuación z modificada de Iglewicz y Hoaglin con un piso de escala, para que la fluctuación diaria normal (< ~1 kg) nunca se marque. Se necesitan al menos 5 puntos para buscar atípicos.
3. **Pendiente** por mínimos cuadrados ordinarios sobre los pesos diarios restantes.
4. **EE de la pendiente** inflado por autocorrelación de rezago 1 de los residuos: `EE × √((1+ρ₁)/(1−ρ₁))`, con ρ₁ acotado a [0; 0,8] (la retención de agua dura varios días).

### 2.5 Densidad energética del cambio de peso (ρ)

- **Con un % de grasa reciente** (pliegues o Health Connect, de los últimos 90 días antes del final de la ventana, entre 3 % y 70 %): modelo de **Forbes y Hall**:

```
G = peso × %grasa / 100                         (kg de grasa)
p = 10,4 / (10,4 + G)                           (fracción magra del cambio; Forbes 1987)
ρ = p × 1816 + (1 − p) × 9441  kcal/kg          (tejido magro 7,6 MJ/kg; grasa 39,5 MJ/kg; Hall 2008)
```

Acotado a 5000–9500 kcal/kg. Valores de referencia: G = 10 kg → ≈ 5550; 20 kg → ≈ 6830; 30 kg → ≈ 7480; 40 kg → ≈ 7870 kcal/kg.

- **Sin % de grasa:** ρ = 7700 kcal/kg, regla para tejido mixto. **Supuesto declarado en la app:** Hall (2008) muestra que 7700 solo se ajusta a personas con más de ~30 kg de grasa; en personas delgadas sobrestima el gasto observado (≈ 100 kcal/día con −0,5 kg/semana y 15 kg de grasa).
- **Limitación:** al empezar un déficit, el glucógeno y el agua hacen que el peso baje más rápido de lo que indica ρ; por eso la ventana es larga y hay un periodo de espera entre ajustes. La misma ρ se usa para las 8 estimaciones semanales del historial.

### 2.6 Error de la observación

```
EE_obs = máx( √( (EE_pendiente × ρ / 7)² + (DE_ingesta / √n)² ), 50 kcal )
```

El piso de 50 kcal representa el error de registro que los datos no pueden revelar.

### 2.7 Controles de plausibilidad

La estimación se descarta («registros inconsistentes») si:

- el GET observado es < 90 % de la TMB (faltan comidas probablemente);
- es > 1,8 veces el GET de fórmula, o se aleja más de 3500 kcal de él;
- el peso cambia más de 1,5 % por semana (agua, báscula o error);
- hay más atípicos que máx(2, 20 % de los días con peso).

### 2.8 Combinación con la fórmula

El GET de fórmula (el mismo método del objetivo vigente: Mifflin × factor, o Schofield × PAL) actúa como información previa con DE = 15 % de su valor. Se combina por varianza inversa:

```
w = (1/EE_obs²) / (1/EE_obs² + 1/(0,15·GET_fórmula)²)
GET adaptativo = w·GET_obs + (1 − w)·GET_fórmula
EE adaptativo = √( 1 / (1/EE_obs² + 1/(0,15·GET_fórmula)²) )
```

Si el factor de actividad está sesgado (§1.2), la información previa arrastra el sesgo; con buenos datos w ≥ 0,85 y el efecto es pequeño.

### 2.9 Confianza

- **Alta:** EE_obs ≤ 120 kcal y ≥ 85 % de los días de la ventana con ingesta válida.
- **Media:** EE_obs ≤ 250 kcal y ≥ 70 %.
- **Baja:** el resto.

La tarjeta muestra «Observado X ± EE» (±1 EE ≈ 68 %); la gráfica de evolución usa ±1,96·EE (≈ 95 %). Ninguno de los dos incluye el error de ρ ni el subregistro sistemático.

### 2.10 De la estimación a la propuesta

```
meta = GET adaptativo + peso × (ritmo % / 100) × ρ / 7
```

- Ritmos permitidos: déficit −0,25 a −1,0 %/semana (por defecto −0,5; Helms y cols. 2014); superávit +0,1 a +0,5 %/semana (por defecto +0,25; Iraki y cols. 2019); mantenimiento 0.
- Límite de paso: 150 kcal por ajuste (100–200 configurable). Espera entre ajustes: 14 días (también tras un objetivo definido a mano). Cambios < 50 kcal se ignoran.
- Mínimo de seguridad (§1.5), salvo que la persona fije otro (nunca < 1000 kcal). El mínimo prevalece sobre el límite de paso.
- Modo automático solo con confianza media o alta; con confianza baja solo sugiere. Las metas manuales nunca cambian solas. En el ajuste, proteína y grasa se mantienen y la diferencia va a los carbohidratos (4 kcal/g).
- La actividad registrada (pulseras, Health Connect) **no se suma**: ya está reflejada en el peso; sumarla la contaría dos veces.

### 2.11 Autocalibración frente al subregistro

Si una persona registra de forma estable, por ejemplo, el 85 % de lo que come, el GET observado queda «en unidades de lo que registra». La meta resultante sigue funcionando para su propio registro aunque no sea su gasto fisiológico real. Es una propiedad útil, pero significa que el número **no** debe leerse como una medición del metabolismo.

### 2.12 Limitaciones conocidas

Cambios de agua (sal, carbohidratos, creatina, ciclo menstrual, entrenamiento nuevo), cambios de báscula, subregistro variable, embarazo y lactancia (§1.8), enfermedad aguda. El modelo es estático: el gasto cambia al cambiar el peso y el ajuste periódico lo corrige.

### 2.13 Peso de tendencia del tablero [`src/features/dashboard/controlCenter.ts`]

Media móvil exponencial: `T_t = T_{t−1} + (1 − (1 − α)^Δd) × (peso_t − T_{t−1})`, α = 0,1 por día, Δd = días transcurridos (estilo «The Hacker's Diet»). Filtra el agua y la sal, pero va ≈ (1 − α)/α ≈ 9 días por detrás: con −0,5 kg/semana la línea queda ≈ 0,6 kg por encima del peso actual. El primer pesaje inicializa la tendencia y aquí no se descartan atípicos.

### 2.14 Promedios semanales de ingesta [`intakeForStats`, `useRangeStats`]

Las medias de kcal y proteína para el resumen semanal y las ideas cuentan **solo días completos**, con la misma regla del §2.3: nunca un día marcado como incompleto, un total parcial solo si el día está confirmado como completo y nunca un día sin registros (no es cero). Promediar días incompletos sesgaría la ingesta a la baja.

---

## 3. Composición corporal [`src/domain/bodycomp.ts`]

### 3.1 Ecuaciones de densidad corporal (D, g/cm³), S = suma de pliegues en mm

| Ecuación | Fórmula |
|---|---|
| JP7 hombres | 1,112 − 0,00043499·S + 0,00000055·S² − 0,00028826·edad |
| JP7 mujeres | 1,097 − 0,00046971·S + 0,00000056·S² − 0,00012828·edad |
| JP3 hombres (pectoral, abdomen, muslo) | 1,10938 − 0,0008267·S + 0,0000016·S² − 0,0002574·edad |
| JP3 mujeres (tríceps, suprailíaco, muslo) | 1,0994921 − 0,0009929·S + 0,0000023·S² − 0,0001392·edad |
| Durnin y Womersley (bíceps, tríceps, subescapular, suprailíaco) | D = c − m·log₁₀(S), con (c, m) por sexo y franja de edad (< 20, 20–29, 30–39, 40–49, ≥ 50) |

Coeficientes de Durnin y Womersley (c; m). Hombres: 1,1620; 0,0630 · 1,1631; 0,0632 · 1,1422; 0,0544 · 1,1620; 0,0700 · 1,1715; 0,0779. Mujeres: 1,1549; 0,0678 · 1,1599; 0,0717 · 1,1423; 0,0632 · 1,1333; 0,0612 · 1,1339; 0,0645. Son los valores que se reproducen habitualmente de la tabla de 1974; no se reverificaron contra el artículo original.

**% de grasa por Siri (1961):** `%GC = 495/D − 450`. Brozek (1963), `457/D − 414,2`, está implementada pero no se usa. Ambas suponen un modelo de dos compartimentos con densidad de la masa libre de grasa de 1,100 g/cm³, que varía con la etnia, la edad y el entrenamiento.

### 3.2 Rangos de validación

| Ecuación | Muestra de derivación | Fuera de rango |
|---|---|---|
| Jackson y Pollock, hombres | 18–61 años (Jackson y Pollock 1978, *Br J Nutr* 40:497) | Se muestra la estimación con la nota «Edad fuera del rango de validación» |
| Jackson, Pollock y Ward, mujeres | 18–55 años (*Med Sci Sports Exerc* 1980;12:175, PMID 7402053); los autores piden cautela por encima de 40 años | Igual; entre 41 y 55 años, nota de cautela |
| Durnin y Womersley | desde 17 años en la app | Nota de fiabilidad baja |

**Error de estimación:** EE ≈ 3,5–4 puntos de % de grasa en Jackson y Pollock (validación cruzada de JPW 1980: 3,7–4,0) y ≈ 3,5–5 en Durnin y Womersley. Los protocolos ISAK solo muestran la suma de pliegues (sin ecuación).

### 3.3 Índices

- **IMC** = peso / estatura² (m). Referencia poblacional, no de composición corporal.
- **Índice cintura/estatura** = cintura / estatura.
- **FFMI** (Kouri y cols. 1995) = masa libre de grasa / estatura²; normalizado a 1,8 m: `+ 6,1 × (1,8 − estatura)`. Derivado en hombres; el error del % de grasa se propaga al FFMI.

---

## 4. Nutrientes, unidades y etiquetas [`src/domain/nutrients.ts`, `labelConvert.ts`, `src/features/nutrition/off.ts`]

### 4.1 Comprobación de energía frente a macronutrientes (una sola fórmula)

```
kcal esperadas = 4·proteína + 9·grasa + 4·CHO disponibles + 2·fibra (+ 7·alcohol, si se conoce)
CHO disponibles = carbohidratos disponibles declarados, o máx(0, carbohidratos totales − fibra)
```

- **Fuentes:** Resolución 810 de 2021 del MinSalud, art. 11.1 y tabla 4 (carbohidratos disponibles 4, proteína 4, grasa 9, alcohol 7 kcal/g); art. 3.8 (los carbohidratos totales incluyen fibra y polialcoholes). Fibra 2 kcal/g: Codex CXG 2-1985 y Reglamento (UE) 1169/2011, anexo XIV.
- Si la fibra es desconocida, los carbohidratos totales se cuentan como disponibles (comportamiento anterior, conservador).
- **Alcohol:** el catálogo de alimentos **no tiene campo de alcohol**, así que los alimentos guardados se comprueban sin él y una bebida alcohólica puede aparecer como «no coincide». Para productos de Open Food Facts con `alcohol_100g` (% vol) y base por 100 ml, el alcohol se convierte a gramos (`g/100 ml = % vol × 0,789`, densidad del etanol a 20 °C) solo para esta comprobación; no se guarda.
- **Polialcoholes** (2,4 kcal/g): no se registran; un producto con muchos polioles puede dar una diferencia.
- **Tolerancias** (sin cambios): catálogo y etiquetas guardadas ±25 % sobre las esperadas; borrador de etiqueta ±25 % cuando las esperadas superan 20 kcal (los macronutrientes faltantes cuentan como 0); Open Food Facts, diferencia > 25 % del mayor de los dos valores.

### 4.2 Conversiones

- kJ ↔ kcal: 1 kcal = 4,184 kJ.
- Sal ↔ sodio: sal = sodio × 2,5 (factor legal del Reglamento (UE) 1169/2011; el estequiométrico es 2,54). En Colombia la etiqueta declara sodio directamente.
- Gramos ↔ mililitros: **nunca** sin una densidad o una porción con ambos datos; no se reutilizan porciones entre crudo y cocido ni entre marcas.
- Sumas: un nutriente desconocido no cuenta como 0 y el total se marca como parcial (*).

---

## 5. Entrenamiento [`src/domain/training.ts`, `src/features/training/`]

### 5.1 1RM estimado

```
Epley:   1RM = peso × (1 + reps/30)     (reps = 1 → peso)
Brzycki: 1RM = peso × 36 / (37 − reps)
```

- **Validez: solo de 1 a 10 repeticiones.** Reynolds, Gordon y Robergs 2006 (*J Strength Cond Res* 20:584, PMID 16937972) concluyen que no deben usarse más de 10 repeticiones en ecuaciones lineales; Brzycki (1993) propuso la suya para menos de 10 y LeSuer y cols. (1997) solo validaron series de 10 o menos. Por encima de 10 la app no calcula 1RM (no hay valor ni récord).
- **Supuesto:** la serie se hizo al fallo o muy cerca. Una serie con repeticiones en reserva subestima el 1RM.
- **Ejercicios de peso corporal:** el peso registrado es solo el lastre añadido (el volumen se cuenta igual), así que **no** se calcula 1RM ni récord de 1RM con ese número: no representaría la fuerza máxima.
- **Mejor serie de una sesión:** se ordena con la puntuación de Epley en 1–15 repeticiones, solo para elegir y resaltar la serie; no se muestra como 1RM.

### 5.2 Volumen y récords

- Volumen de una serie = peso × repeticiones; volumen de sesión = suma de series hechas. Los calentamientos cuentan 0; las series descendentes y al fallo cuentan. En peso corporal solo suma el lastre. No se distingue si el peso de mancuernas es por mano o total: depende de cómo se anote.
- Récords: peso máximo, 1RM estimado (solo carga externa y ≤ 10 repeticiones), más repeticiones con un peso igual o mayor, mayor volumen en una serie, mayor duración y mayor distancia. La primera vez que se hace un ejercicio no es récord. Cada serie se compara solo con lo anterior.
- Series semanales por grupo muscular (pantalla de estadísticas): 1 por serie efectiva en cada grupo principal del ejercicio.

---

## 6. Recuperación muscular [`src/features/training/recovery/`; detalle en `docs/V3_MUSCLE_RECOVERY.md`]

- Se toma la última sesión terminada con al menos 1 serie efectiva para el músculo (principal = 1 serie; secundario = 0,5).
- Menos de 24 h: «trabajado hace poco». Después, ventana orientativa de 48 h, o de 72 h si esa sesión sumó 8 o más series efectivas. Pasados 7 días sin estímulo se muestra en neutro.
- Referencia semanal de 12–20 series por músculo (Baz-Valle y cols. 2022, PMID 35291645): contexto, no un objetivo.
- **Fuentes:** MacDougall 1995; Phillips 1997; Morán-Navarro 2017; Bartolomei 2017; Ferreira 2017; Ferreira-Júnior 2021; Schoenfeld, Ogborn y Krieger 2016. El corte de 8 series es una heurística declarada; no se usan puntuaciones ni porcentajes de «preparación». No mide la recuperación real, el sueño ni las agujetas.

---

## 7. Hidratación [`src/domain/hydration.ts`]

- Meta solo manual, entre 0,5 y 10 L/día; cada registro entre 10 y 3000 ml.
- Media = promedio de los días **con registros** (un día sin registros no es cero). Racha = días seguidos con la meta cumplida; hoy no la rompe mientras está en curso.
- **Sin referencia automática.** Como contexto: EFSA 2010 propone una ingesta adecuada de agua total (alimentos incluidos) de 2,0 L/día en mujeres y 2,5 L/día en hombres; el IOM (2004), 2,7 y 3,7 L. Son ingestas de población, no requerimientos individuales; el calor, el ejercicio y la altitud las aumentan.

---

## 8. Signos vitales [`src/domain/vitals.ts`]

### 8.1 Presión arterial

| Categoría (ACC/AHA 2017, vigente en la guía AHA/ACC 2025) | Sistólica | | Diastólica |
|---|---|---|---|
| Normal | < 120 | y | < 80 |
| Elevada | 120–129 | y | < 80 |
| Etapa 1 | 130–139 | o | 80–89 |
| Etapa 2 | ≥ 140 | o | ≥ 90 |
| Hipertensión severa (nombre de la guía 2025) | > 180 | y/o | > 120 |

- **Cada toma se rotula «lectura aislada».** Clasificar requiere el promedio de al menos 2 lecturas en al menos 2 ocasiones (ACC/AHA) o una serie domiciliaria (ESH 2023: 7 días, mínimo 3, con 2 tomas por la mañana y 2 por la noche).
- **Promedio de 7 días:** media de todas las tomas de los últimos 7 días, si hay tomas en al menos 3 días. Se clasifica con los valores domiciliarios equivalentes de ACC/AHA 2017 (tabla 11: 130/80 en casa ≈ 130/80 en consulta; 135/85 en casa ≈ 140/90 en consulta), de modo que una media domiciliaria ≥ 135/85 está en rango de etapa 2 (ESH 2023: hipertensión en casa ≥ 135/85). Simplificación: el protocolo ESH descarta el primer día; la app no lo hace.
- Con valores en rango severo se recomienda repetir la toma tras 5 minutos de reposo y buscar atención médica inmediata si persisten o hay síntomas.

### 8.2 Glucosa (solo en ayunas; ADA)

< 100 mg/dL: normal · 100–125: rango de prediabetes · ≥ 126: rango de diabetes. Las lecturas posprandiales o aleatorias no se clasifican. Un glucómetro no sirve para diagnosticar: el diagnóstico exige glucosa plasmática de laboratorio confirmada (ADA), y la norma ISO 15197:2013 admite ±15 mg/dL por debajo de 100 o ±15 % por encima.

### 8.3 Saturación de oxígeno (SpO₂)

- El perfil no guarda la altitud de residencia. A nivel del mar < 94 % sería bajo, pero en altitud lo normal es menor: el documento del MinSalud «Uso e interpretación de la oximetría de pulso» estima para Bogotá (2600 m) una saturación de ≈ 94 % (menores de 30 años) a 92 % (mayores de 70); Rojas-Camayo y cols. 2018 (*Thorax* 73:776, PMID 29054885) muestran que la SpO₂ cae claramente por encima de 2500 m.
- Por eso: **90–93 %** solo genera una nota informativa (neutra) que explica el efecto de la altitud; **< 90 %** genera un aviso para repetir la medición en reposo y consultar si persiste o hay síntomas.

---

## 9. Correlación, causalidad y estimación

La app trabaja con **datos observacionales de una sola persona**. Esto tiene consecuencias que conviene tener presentes al leer cualquier cifra:

1. **Estimación no es medición.** El gasto por fórmula, el gasto adaptativo, el 1RM, el % de grasa y la recuperación muscular son modelos con error conocido (§1.1, §2.6, §3.2). Un número con decimales no es más exacto que su error: «2350 kcal» quiere decir «alrededor de 2350, ± algunos cientos».
2. **Correlación no es causalidad.** Que dos series se muevan juntas (p. ej., más pasos y menos peso, más proteína y más fuerza) no demuestra que una cause la otra: puede haber terceras variables (sueño, estrés, cambios de dieta simultáneos, agua corporal), causalidad inversa o simple azar. La app **no** afirma relaciones causales a partir de tus datos; las comparaciones semanales y las «ideas» son aritmética descriptiva sobre lo registrado.
3. **De la población al individuo.** Las ecuaciones y los umbrales (Mifflin, Schofield, Jackson y Pollock, ACC/AHA, ADA, RDA) se derivaron en grupos de personas. Describen el promedio de esas poblaciones y su dispersión; aplicados a una persona concreta tienen un error que puede ser grande, sobre todo fuera de la población de derivación (edad, etnia, composición corporal, altitud).
4. **Ausencia de dato no es cero.** Un día sin registro, un nutriente desconocido o un alimento sin kcal no se cuentan como cero: se excluyen o se marcan como parciales, porque contarlos como cero sesgaría a la baja cualquier promedio.
5. **Sesgos del registro.** El subregistro de la ingesta es frecuente y no se puede detectar desde dentro; solo se rechazan los resultados implausibles. Las pulseras sobrestiman con frecuencia las kcal activas, y por eso nunca se suman al objetivo por defecto.
6. **Clasificaciones orientativas.** Las etiquetas de presión arterial, glucosa o saturación describen en qué rango cae una medida según una guía; no son diagnósticos. Diagnosticar requiere mediciones repetidas, instrumentos validados y la valoración de un profesional.
7. **Nada cambia sin permiso.** Los objetivos solo cambian cuando la persona los edita o acepta una propuesta, o cuando activa expresamente el modo automático (que se desactiva en menores, embarazo y lactancia).

---

## 10. Referencias

**Verificadas (PubMed o fuente oficial):**

- Mifflin MD y cols. A new predictive equation for resting energy expenditure in healthy individuals. *Am J Clin Nutr* 1990;51:241-7. PMID 2305711.
- FAO/OMS/UNU. *Human energy requirements*. Report of a Joint FAO/WHO/UNU Expert Consultation, Roma, 2001 (publicado en 2004). Tabla 5.2 (ecuaciones de Schofield) y tabla 5.3 (PAL).
- Ministerio de Salud y Protección Social. Resolución 3803 de 2016 (RIEN); resumen oficial del ICBF.
- Ministerio de Salud y Protección Social. Resolución 810 de 2021 (etiquetado nutricional), art. 3.8 y 11.1, tabla 4.
- Hall KD. What is the required energy deficit per unit weight loss? *Int J Obes* 2008;32:573-6. PMID 17848938.
- Jackson AS, Pollock ML, Ward A. Generalized equations for predicting body density of women. *Med Sci Sports Exerc* 1980;12:175-81. PMID 7402053.
- Morton RW y cols. *Br J Sports Med* 2018;52:376-84. PMID 28698222.
- Reynolds JM, Gordon TJ, Robergs RA. Prediction of one repetition maximum strength from multiple repetition maximum testing and anthropometry. *J Strength Cond Res* 2006;20:584-92. PMID 16937972.
- Baz-Valle E y cols. *J Hum Kinet* 2022;81:199-210. PMID 35291645.
- Rojas-Camayo J y cols. Reference values for oxygen saturation from sea level to the highest human habitation in the Andes. *Thorax* 2018;73:776-8. PMID 29054885.
- Ministerio de Salud y Protección Social. *Uso e interpretación de la oximetría de pulso*.
- AHA/ACC 2025 High Blood Pressure Guideline (categorías mantenidas; «severe hypertension»).
- Morán-Navarro R y cols. *Eur J Appl Physiol* 2017;117:2387-99. PMID 28965198. Demás fuentes de recuperación: ver `docs/V3_MUSCLE_RECOVERY.md`.

**Citadas de fuentes secundarias o de memoria (verificar la cita exacta antes de reutilizarla):**

Jackson y Pollock 1978, *Br J Nutr* 40:497. Durnin y Womersley 1974, *Br J Nutr* 32:77. Siri 1961. Brozek y cols. 1963, *Ann N Y Acad Sci* 110:113. Kouri y cols. 1995, *Clin J Sport Med* 5:223. Frankenfield y cols. 2005, *J Am Diet Assoc* 105:775. Schofield 1985, *Hum Nutr Clin Nutr* 39 Supl 1:5. Forbes 1987, *Nutr Rev* 45:225. IOM 2005, DRI de energía y macronutrientes. IOM 2004, DRI de agua y electrolitos. EFSA 2010, *EFSA J* 8(3):1459. Whelton y cols. 2018, *Hypertension* 71:e13 (ACC/AHA 2017). Mancia y cols. 2023, *J Hypertens* 41:1874 (ESH). ADA, *Standards of Care*, cap. 2. ISO 15197:2013. Epley 1985. Brzycki 1993, *JOPERD* 64:88. LeSuer y cols. 1997, *J Strength Cond Res* 11:211. Helms y cols. 2014, *J Int Soc Sports Nutr* 11:20. Jäger y cols. 2017 (ISSN), *J Int Soc Sports Nutr* 14:20. Iraki y cols. 2019, *Sports* 7:154. Iglewicz y Hoaglin 1993 (puntuación z modificada). Henry CJK 2005, *Public Health Nutr* 8:1133 (ecuaciones de Oxford). Codex CXG 2-1985. Reglamento (UE) 1169/2011.
