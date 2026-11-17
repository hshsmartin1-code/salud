# Estado muscular: método, fuentes y figura

Código: `src/features/training/recovery/recovery.ts` (modelo puro y pruebas), `recovery/RecoverySection.tsx` (sección de Entreno), `recovery/method.ts` (texto «Cómo se calcula»), `MuscleMap.tsx` (dibujo) y `muscleFigure.ts` (datos de la figura).

## Qué es y qué no es

Es una **guía general** calculada con el registro de la persona y con investigación hecha sobre grupos de personas. **No mide** su recuperación real, las agujetas, el sueño ni la alimentación, y **no es consejo médico**. No hay puntuaciones sobre 100 ni «% de preparación». Los estados se dicen con palabras neutras y un músculo sin estímulo reciente no se presenta como aviso.

## Entradas

- Sesiones del perfil con `status: 'done'` y sin `excludeFromStats`. Solo cuentan las series hechas (`done`), que no son calentamientos (`setKind`) y que no tienen `excludeFromStats`. Se reutiliza `prepareStats` de `trainingStats.ts`, así que las reglas son las mismas que en el resto de Entreno.
- Músculos de cada ejercicio según el catálogo. **Series efectivas:** una serie cuenta 1 para cada músculo principal y 0,5 para cada secundario. Si un músculo aparece en las dos listas, cuenta solo como principal. `trainingStats.ts` cuenta las series semanales **solo con el músculo principal** y deja las secundarias aparte. Por eso esta guía usa su propia ponderación de 0,5 y la rotula siempre en la pantalla.
- Momento de la sesión: `endedAt`, si no hay `startedAt` y, si tampoco, el mediodía de su fecha. Las sesiones posteriores a `now` se ignoran.

## Salida por músculo (cada id de `muscles.ts`)

Horas desde el último estímulo, series efectivas de esa sesión, ejercicios que lo trabajaron (principal o secundario), ventana aplicada, series efectivas de los últimos 7 días (ventana móvil) y estado.

Un **estímulo** es una sesión con 1 o más series efectivas para ese músculo (`MIN_STIMULUS_SETS`). Así, una sola serie de un ejercicio donde el músculo es secundario (0,5) no reinicia su ventana.

## Umbrales (constantes con nombre en `recovery.ts`)

| Constante | Valor | Base |
|---|---|---|
| `RECENT_HOURS` | 24 h | La síntesis de proteína muscular está en su punto más alto durante el primer día (MacDougall 1995: más del doble a las 24 h; Phillips 1997: +112 % a las 3 h y +65 % a las 24 h). |
| `BASE_WINDOW_HOURS` | 48 h | La síntesis vuelve casi a la línea base hacia las 36 h (MacDougall 1995) o sigue un 34 % arriba a las 48 h (Phillips 1997). Con protocolos que no llegan al fallo, la fuerza se recuperó entre las 24 y las 48 h (Morán-Navarro 2017). |
| `EXTENDED_WINDOW_HOURS` | 72 h | Con 8 a 10 series para un mismo músculo había todavía déficit de fuerza a las 72 h o más: Bartolomei 2017 (8×10), Ferreira 2017 (8 series al fallo, pico de fuerza recuperado a las 96 h) y Ferreira-Júnior 2021 (10×10RM, sin recuperar a las 72 h). |
| `HIGH_SESSION_SETS` | 8 series efectivas | **Heurística, no un umbral demostrado.** Ningún resumen revisado fija un número de series por sesión a partir del cual la recuperación pase de 48 a 72 h. 8 es el menor número de series entre los protocolos que mostraron déficit a 72 h o más. En Bartolomei 2017 las dos condiciones tenían 8 series; lo que cambiaba eran las repeticiones y el volumen de carga. Páez-Maldonado 2026 encontró que, igualando la fatiga, el volumen por sí solo no cambió la recuperación a 24 o 48 h. |
| `RESTED_AFTER_HOURS` | 7 días | Convención de presentación: es la misma ventana que el contexto semanal. Pasado ese tiempo el músculo se dibuja en neutro y no se presenta como aviso. Schoenfeld 2016 apoya entrenar cada músculo al menos 2 veces por semana para crecer, pero la app no lo convierte en un aviso. |
| `WEEKLY_RANGE` | 12–20 series por semana | Baz-Valle 2022 recomienda 12–20 series semanales por músculo en hombres jóvenes entrenados. Solo se usa para una nota neutra («por debajo», «dentro», «por encima» del rango de la revisión de referencia). **No** se usa «~10 series»: en Schoenfeld 2017 la comparación <5, 5–9 y 10+ fue solo una tendencia (P = 0,074). |

Estados: `recent` (menos de 24 h), `recovering` (de 24 h hasta la ventana), `ready` (ventana cumplida, hasta 7 días), `rested` (más de 7 días) y `none` (sin registros). Los límites son exactos y la prueba `recovery.test.ts` los cubre: 24 h ya es `recovering`, 48 h ya es `ready` y 168 h todavía es `ready`.

## Fuentes verificadas

Todas se comprobaron el 2026-11-15 en el registro de PubMed (metadatos y resumen). Cada frase resume solo lo que dice ese resumen.

1. MacDougall JD et al. 1995. *Can J Appl Physiol* 20(4):480-6. PMID 8563679, doi:10.1139/h95-038. Tras 12 series de flexión de codo, la síntesis de proteína muscular era más del doble a las 24 h y a las ~36 h ya estaba a menos de un 14 % del brazo control.
2. Phillips SM et al. 1997. *Am J Physiol* 273:E99-107. PMID 9252485, doi:10.1152/ajpendo.1997.273.1.E99. Tras 8×8 al 80 % de 1RM, la síntesis mixta subió un 112 % a las 3 h, un 65 % a las 24 h y un 34 % a las 48 h.
3. Damas F et al. 2016. *J Physiol* 594(18):5209-22. PMID 27219125, doi:10.1113/JP272472. La síntesis miofibrilar de 0 a 48 h solo se relacionó con la hipertrofia cuando bajó el daño muscular (semanas 3 y 10). Es contexto: no se basa en ella ningún umbral, porque el resumen no da valores a 24 o 48 h.
4. Morán-Navarro R et al. 2017. *Eur J Appl Physiol* 117(12):2387-99. PMID 28965198, doi:10.1007/s00421-017-3725-7. Con el volumen igualado, llegar al fallo alargó la recuperación hasta las 24–48 h; sin fallo se recuperó antes, entre las 24 y las 48 h.
5. Pareja-Blanco F et al. 2017. *Clin Physiol Funct Imaging* 37(6):630-9. PMID 26970332, doi:10.1111/cpf.12348. El protocolo 3×12 al fallo redujo la velocidad hasta 24 h y el salto hasta 48 h, frente a 3×6 sin fallo.
6. Bartolomei S et al. 2017. *Eur J Appl Physiol* 117(7):1287-98. PMID 28447186, doi:10.1007/s00421-017-3598-9. La fuerza isométrica seguía reducida a las 72 h tras 8×10, y no tras 8×3.
7. Ferreira DV et al. 2017. *Physiol Behav* 179:143-7. PMID 28595855, doi:10.1016/j.physbeh.2017.06.001. Tras 8 series de press de banca al fallo, el pico de fuerza volvió a la línea base a las 96 h y el trabajo total aún no a las 96 h.
8. Ferreira-Júnior JB et al. 2021. *Physiol Meas* 42(3). PMID 33631736, doi:10.1088/1361-6579/abe9fe. Tras 10×10RM de prensa al fallo, la fuerza isométrica no se había recuperado a las 72 h.
9. Raastad T, Hallén J 2000. *Eur J Appl Physiol* 82(3):206-14. PMID 10929214, doi:10.1007/s004210050673. Tras una sesión pesada, la fuerza tardó 33 h en volver; tras una moderada, 3 h.
10. Schoenfeld BJ, Ogborn D, Krieger JW 2016. *Sports Med* 46(11):1689-97. PMID 27102172, doi:10.1007/s40279-016-0543-8. Con el volumen igualado, entrenar un músculo 2 veces por semana dio más hipertrofia que 1 vez.
11. Schoenfeld BJ, Ogborn D, Krieger JW 2017. *J Sports Sci* 35(11):1073-82. PMID 27433992, doi:10.1080/02640414.2016.1210197. Hay relación dosis-respuesta: cada serie semanal añadida sumó un 0,37 % de ganancia. El corte de 10+ series fue solo una tendencia.
12. Baz-Valle E et al. 2022. *J Hum Kinet* 81:199-210. PMID 35291645, doi:10.2478/hukin-2022-0017. Más de 20 series semanales no superó a 12–20 en cuádriceps ni en bíceps; recomiendan 12–20 por músculo.
13. Pelland JC et al. 2025. *Sports Med* 56(2):481-505. PMID 41343037, doi:10.1007/s40279-025-02344-w. Más volumen da más tamaño y más fuerza, con rendimientos decrecientes. El resumen no da cifras de series, así que solo es contexto.

**No verificado:** ningún resumen da un número de series por sesión que amplíe la ventana a 72 h. El 8 es una heurística, se declara como tal en la pantalla («una aproximación prudente») y queda aquí documentado.

## Interfaz

- Colores: una sola tonalidad (`--train`) en rampa por recencia. `recent` es relleno sólido, `recovering` rayado diagonal, `ready` punteado tenue, y `rested` y `none` neutro. Cada estado tiene además su textura y su etiqueta de texto, así que nada depende solo del color. La leyenda está siempre visible. No hay rojo ni verde.
- La lista bajo la figura repite la misma información en filas de 48 px: estado, «hace 26 h», series de la última sesión y series en 7 días. Al tocar una fila o una forma se abre la hoja del músculo: regla en palabras («Ventana orientativa de 48 h tras 6 series»), última sesión, ejercicios, series en 7 días y «Cómo se calcula» con las fuentes.

## Sustituir la figura

La figura es un módulo de **datos** intercambiable. `MuscleMap` dibuja cualquier dato con esta forma sin conocer el dibujo (`muscleFigure.types.ts`):

```ts
export const FIGURE: { front: FigureData; back: FigureData }
interface FigureData {
  viewBox: { x: number; y: number; w: number; h: number } // mismo viewBox en las dos vistas
  silhouette: string[]                                    // cuerpo neutro (paths cerrados), respaldo sin imagen
  shapes: { muscleId: string; d: string; side?: 'left' | 'right'; region?: string }[]
  lines?: string[]                                        // líneas finas internas entre partes (paths abiertos)
  base?: { href: string; width: number; height: number }  // imagen sombreada en public/, bajo las formas
}
```

- **Ids obligatorios:** los 17 de `muscles.ts`. Cada id necesita al menos una forma en alguna vista. Ninguna forma puede usar un id desconocido. `muscleFigure.test.ts` también comprueba en qué vista debe aparecer cada id.
- Un path cerrado, con comandos absolutos y relleno par-impar, por cada región y lado. Se admiten huecos. No lleva `transform` ni estilos.
- Con `base`, el color de estado se multiplica (`mix-blend-mode: multiply`) sobre la imagen. Así el sombreado sigue visible y los músculos sin estímulo quedan como anatomía gris neutra. En tema oscuro la imagen se oscurece (`brightness(0.72)`); en tema claro el color va al 68 % de opacidad para que no se vuelva un petróleo casi negro. Las tramas (rayas, puntos) se dibujan en píxeles CSS, sea cual sea el viewBox. Sin `base`, las formas llevan todo el dibujo y la silueta hace de cuerpo.
- **Tamaño en pantalla («Estado muscular»):** unos 230 px de alto por vista a 360 px, 260 px desde 400 px y 340 px desde 1024 px. Debajo de 1024 px van la leyenda en una fila y luego las filas por grupo. Desde 1024 px, leyenda y filas van a la derecha de las figuras. Plegada mide unos 691 px a 412 px. La lupa junto a «Espalda» (o tocar el fondo de la figura) abre la vista ampliada en una hoja, tan alta como quepa y hasta los 720 px de la imagen. En pantallas estrechas se ve una vista cada vez, con selector Frente/Espalda. Los músculos se pueden tocar y Escape cierra.
- Tamaño máximo: 60 KB de trazados entre las dos vistas (lo comprueba la prueba) y unos 70 KB por imagen.

## Figura anatómica

- **Fuente:** BodyParts3D, versión 4.0 (árbol is-a, mallas OBJ con un 99 % de reducción de polígonos), del Database Center for Life Science.
- **Licencia:** CC BY 4.0. Atribución exacta: «BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International». Aparece en `THIRD_PARTY_NOTICES.md` (copiado a `public/THIRD_PARTY_NOTICES.txt` al compilar), en Ajustes (fuentes), al pie de «Cómo se calcula» y en la cabecera de `muscleFigure.data.ts`.
- **Prueba de la licencia:** el `README_e.html` de la última descarga (guardado en `assets-src/bodyparts3d/`) dice que la base de datos se licencia con Creative Commons Attribution 4.0 International y da la línea de crédito exacta citada arriba. Junto a los datos se guarda una copia fechada de la página de licencia (`license-page-2026-11-15.html`). Las cabeceras de los OBJ conservan el aviso antiguo (CC BY-SA 2.1 JP); el README y la página de licencia actuales lo sustituyen.
- **Qué se modificó:** se seleccionaron músculos, esqueleto (sin cráneo ni huesos de la cara), algunas láminas de tejido conectivo (línea alba, cintilla iliotibial, tendón calcáneo, cartílagos costales, discos) y la piel. La piel se **recortó** a cabeza, manos y pies (se borran caras, no se mueve ningún vértice): así las manos y los pies son sólidos y la cabeza cubre los músculos de la cara. Render ortográfico frontal y dorsal en Blender: mapas de ids, de partes y de tipo sin suavizado, y arcilla gris con luz principal arriba a la izquierda, oclusión ambiental en los surcos entre músculos y huesos/piel en un gris más claro. La cara se suaviza. No se importan genitales. Los mapas se trazan a vectores alineados píxel a píxel con la imagen base. El **dorsal ancho no existe en el conjunto**: se aproxima en una caja proporcional de la espalda con la superficie de la piel oscurecida al tono del músculo (`trace.py`). El recto abdominal tampoco existe, pero el oblicuo externo del conjunto incluye la aponeurosis de toda la pared abdominal anterior.
- **Regenerar:** `scripts/muscle-figure/README.md`.
- **Visibilidad por vista:** solo frente: chest, abdominals, biceps, neck. Solo espalda: lats, middle back, lower back, glutes. En las dos vistas: traps, shoulders, triceps, forearms, quadriceps, hamstrings, adductors, abductors, calves. Se descartan trozos de menos de 40 unidades² del viewBox (no sirven para tocar). La prueba de contrato fija esta lista. Que un id falte en una vista es anatomía, no un error. **Espalda media:** los romboides quedan bajo el trapecio medio y casi no se ven; su huella (renderizada sola) es la región `middle back`, recortada del trapecio. En esa zona la imagen muestra el trapecio medio sobre los romboides, los músculos que trabaja un remo.
