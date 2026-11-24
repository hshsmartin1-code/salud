# Salud: preparación para una eventual comercialización

Fecha de consulta de las fuentes web: noviembre de 2026. Este documento es una evaluación técnica y de producto, **no es asesoría legal**. Todo lo marcado como [no verificado] debe confirmarse en la fuente primaria antes de actuar. Las secciones legales exigen revisión de un abogado colombiano.

Restricciones del propietario: (1) no poner muros de pago a las funciones personales que ya existen; (2) las dos personas que hoy usan la app conservan todo; (3) preparar sin implementar ningún cobro todavía.

## 0. Resumen ejecutivo

- Hay una base técnica sólida (offline-first, sin analítica, Firestore con reglas estrictas, OTA firmado). Para publicar en Google Play faltan sobre todo **trámites y decisiones de producto**, no funciones grandes.
- Los cinco bloqueantes principales para Play Store:
  1. **Política de privacidad pública** (URL) y formulario Data safety coherentes con ella. Existe un borrador en `docs/PRIVACIDAD_BORRADOR.md`; falta revisión legal y alojarla.
  2. **Eliminación de cuenta y datos** dentro de la app **y** en un enlace web. Hoy la nube se borra desde la app, pero el registro de Firebase Authentication solo se elimina desde la consola (`docs/V22_SYNC_SECURITY.md`, sección 6).
  3. **Declaración de apps de salud y de permisos de Health Connect** (10 permisos de lectura) con justificación por tipo de dato y política de privacidad enlazada también desde Health Connect.
  4. **Cuenta de desarrollador y pruebas cerradas**: si es cuenta personal nueva, 12 testers durante 14 días continuos antes de pedir producción. Además, verificación de identidad del desarrollador.
  5. **Riesgo del OTA autoalojado** (Capgo con manifiesto propio): permitido para código interpretado, pero con interpretación de Google que conviene reducir con un modo "solo Play" (sección 1.6). Sumado a que hoy el AAB, la firma de Play App Signing y `dataExtractionRules` no están preparados.
- Recomendación de monetización (sección 5): **núcleo gratis completo + "Apoyo" opcional** (suscripción o pago único de apoyo, sin quitar nada existente), implementado más adelante con Play Billing.
- Costos: con el diseño actual, 1 000 usuarios activos cuestan del orden de **USD 5 a 20 al mes** en Firestore (Blaze), con supuestos explícitos en la sección 4.

## 1. Google Play (2026)

### 1.1 Nivel de API objetivo

- Desde el 31 de agosto de 2026, apps nuevas y actualizaciones deben apuntar a **Android 16 (API 36)**; las apps existentes, a API 35 como mínimo para seguir visibles a usuarios nuevos en dispositivos recientes. Se podía pedir prórroga hasta el 1 de noviembre de 2026 [1][2].
- Estado de Salud: `targetSdkVersion = 36`, `compileSdk = 36`, `minSdk = 26` (`android/variables.gradle`). **Cumple hoy.** Para 2027 se espera el salto a API 37; planificar una revisión anual.
- Detalle por tipo de dispositivo (Wear, TV) no aplica.

### 1.2 Declaración de apps de salud y Health Connect

- Todas las apps publicadas (incluidas pruebas cerradas) deben completar la **declaración de apps de salud** en Play Console (Contenido de la app). Las preguntas de Health Connect forman parte de ese formulario: hay que explicar el uso de **cada tipo de dato** [3][4].
- Solo se deben pedir permisos necesarios para la función principal; los no usados se quitan. Los datos de Health Connect se tratan como datos personales y sensibles (política de Datos de usuario) [3].
- La política de privacidad de Play debe ser **la misma** que se muestra a la persona dentro de Health Connect [3].
- Salud declara en el manifiesto 10 permisos de solo lectura: pasos, calorías activas, distancia, frecuencia cardiaca, frecuencia en reposo, ejercicio, sueño, peso, grasa corporal y masa magra. Falta preparar la justificación por tipo y un video corto de uso si Play lo pide [no verificado: si exige video para estos tipos].
- Pendiente de decisión: recortar permisos que no sean esenciales (p. ej. masa magra, distancia) reduce riesgo de rechazo.
- Los permisos de Health Connect no se sincronizan a la nube (las reglas de Firestore los rechazan), lo que simplifica la declaración "no se comparte".

### 1.3 Política de privacidad y Data safety

- Todas las apps necesitan URL de política de privacidad en Play Console y dentro de la app, y completar la sección **Data safety** de forma exacta y coherente con la política [5].
- Con sincronización opcional a Firebase habrá que declarar recolección de: información de salud y estado físico, correo (cuenta de Google), identificadores de usuario. Declarar "cifrada en tránsito: sí"; "datos eliminables: sí".
- Seguridad en reposo: Firestore cifra en reposo (Google), pero **no hay cifrado de extremo a extremo**; la política debe decirlo (ya figura en el borrador).

### 1.4 Eliminación de cuenta

- Si la app permite crear cuenta, debe ofrecer **eliminar la cuenta y sus datos dentro de la app**, y además un **enlace web** que el desarrollador entrega en Play Console, que debe mencionar el nombre de la app o del desarrollador y ser fácil de encontrar [6].
- Estado actual: borrado de datos en la nube con confirmación escrita (existe); eliminación del registro de Authentication solo por consola (falta). Falta una página web pública de solicitud de eliminación (puede ser una página estática con un correo de contacto y plazo, más una Cloud Function o proceso manual).
- Nota: los datos locales no están ligados a una cuenta; "eliminar perfil" ya los borra del dispositivo.

### 1.5 Permisos sensibles, menores, pruebas y verificación

- **Permisos sensibles**: INTERNET y CAMERA (opcional, etiquetas) y POST_NOTIFICATIONS (opcional) no son de acceso restringido. Almacenamiento solo hasta API 29. Health Connect es lo único que requiere declaración especial. No hay ubicación, SMS, ni "todos los archivos".
- **Familias / menores**: si el público objetivo incluye menores de 13 años (o menores en general según el formulario de público objetivo), se activan los requisitos de la política de Familias [7]. Recomendación: declarar público objetivo **adultos (18+)**, sin diseño atractivo para niños, y decir en la política que no es para menores. Además, la Ley 1581 impone reglas reforzadas para datos de niños (ver 2.5).
- **Cuenta de desarrollador personal nueva**: debe correr una **prueba cerrada con al menos 12 testers inscritos de forma continua durante 14 días** antes de solicitar producción. Las cuentas de organización están exentas de momento [8]. Detalles de reinicio del contador provienen de blogs, no de Google [no verificado].
- **Verificación de desarrolladores de Android**: desde el 30 de septiembre de 2026 aplica en Brasil, Indonesia, Singapur y Tailandia; a nivel global se planifica para 2027, con cuenta gratuita de distribución limitada (hasta 20 dispositivos) para aficionados [9]. Colombia no está en la primera fase, pero conviene registrarse: **el APK por sideload actual de los dos usuarios podría verse afectado en 2027** si no se verifica la identidad del desarrollador. [no verificado: fechas definitivas de Colombia.]

### 1.6 Actualizaciones propias (OTA) frente a la política de Play

- Política de Dispositivos y Red: una app distribuida por Play "no puede modificarse, reemplazarse o actualizarse por ningún método distinto al mecanismo de actualización de Google Play". La restricción **no aplica al código que corre en una máquina virtual o intérprete** que da acceso indirecto a las API de Android, "como JavaScript en un webview o navegador" [10].
- Interpretación: actualizar el paquete web (HTML/JS/CSS) de un Capacitor, sin descargar código nativo (dex, .so), queda dentro de la excepción. Los blogs de proveedores como Capgo lo afirman [11], pero tienen interés comercial; no hay una aprobación formal de Google para Capacitor.
- **Riesgos que hay que marcar claramente:**
  1. Esa JS actualizada debe cumplir **todas** las políticas de Play. Un cambio por OTA que añada una función no declarada (por ejemplo, un permiso nuevo o un cobro fuera de Play Billing) es una infracción aunque no pase por revisión.
  2. Un revisor podría interpretar el OTA como "eludir la revisión". Riesgo bajo pero no nulo, y no se puede descartar [no verificado con una consulta a Google].
  3. Si la app vende funciones digitales, cualquier activación remota debe seguir pasando por Play Billing.
- **Mitigaciones recomendadas:** (a) variante "Play" del APK/AAB con el actualizador desactivado o con manifiesto de canal que solo aplica correcciones de interfaz sin cambiar permisos ni funciones declaradas; (b) conservar la verificación de firma, hash y reversión que ya existe; (c) declarar el uso en las notas de revisión; (d) cambios de permisos o de datos recolectados siempre por actualización en Play.
- Alternativa: usar solo actualizaciones de Play (más simple, 100 % alineado) y dejar el OTA para la variante de instalación directa (sideload).

### 1.7 Facturación

- Si se vende acceso a funciones o contenido digital dentro de la app, hay que usar **Google Play Billing**; los sistemas alternativos deben retirarse [12]. Donaciones voluntarias dentro de la app a veces se tratan como producto digital [no verificado]. Un enlace a pagos externos desde la app tiene reglas propias [no verificado para Colombia].
- Tarifas: el 15 % aplica a ciertos programas (p. ej. primer millón de USD anual, suscripciones); el estándar es mayor según tipo [12]. Condiciones y moneda local en Colombia: [no verificado].

### 1.8 Contenido de salud y reclamos médicos

- Las apps de salud que no son dispositivos médicos deben incluir en la ficha un aviso de que **no son un dispositivo médico y no diagnostican, tratan, curan ni previenen** enfermedades; deben recordar consultar a un profesional; no se admiten reclamos engañosos [13][14].
- Las apps reguladas como dispositivos médicos deben declararlo (etiqueta "Medical Device" desde el 28 de enero de 2026) y aportar prueba de aprobación [13]. Recomendación: evitar ese camino.
- Salud tiene pantallas de **presión arterial y glucosa con clasificaciones orientativas** (`src/domain/vitals`), que hoy cargan un aviso. Es el punto más delicado del producto (ver 2.6).

## 2. Colombia: marco legal (requiere revisión legal profesional)

> Todo lo siguiente es una lectura de fuentes públicas por una persona no abogada. Puede estar incompleto o desactualizado. **No publicar sin concepto de un abogado en protección de datos y consumo.**

### 2.1 Ley 1581 de 2012 y reglamentos

- Los datos de **salud son datos sensibles** (art. 5). Su tratamiento está prohibido salvo excepciones, entre ellas la **autorización explícita** del titular (art. 6) [15].
- El Decreto 1377 de 2013 (compilado en el Decreto 1074 de 2015) exige, para datos sensibles: informar que **no se está obligado a autorizar**, señalar cuáles datos son sensibles y la finalidad, obtener consentimiento expreso, y **no condicionar ninguna actividad** a entregarlos [16]. Los artículos citados quedan en el capítulo 25 del Decreto 1074 de 2015 (p. ej. art. 2.2.2.25.2.3) [16].
- Consecuencia de diseño: la sincronización con la nube (Google Firebase) y Health Connect deben pedirse con **consentimiento explícito, separado, opcional y revocable**, con texto de finalidad. Usar la app local sin cuenta debe seguir siendo posible (ya lo es).
- Deberes del responsable: política de tratamiento, **aviso de privacidad**, canal para consultas y reclamos, procedimientos para pedir autorización a más tardar al momento de la recolección, conservar prueba de la autorización, y nueva autorización si cambia la finalidad [16]. Contenido exacto del aviso y plazos de respuesta (consulta y reclamo): [no verificado en esta revisión]; verificar en el texto de la ley y del decreto.
- Derechos del titular (borrador de aviso): conocer, actualizar, rectificar, suprimir, revocar la autorización, ser informado del uso y presentar quejas ante la SIC [15].
- **Modelo "local-first" y quién es responsable**: mientras los datos solo estén en el dispositivo y el desarrollador no los recibe, el tratamiento por el desarrollador es mínimo. Con Firestore del proyecto del desarrollador, este **sí recibe y almacena** datos sensibles de terceros; es **responsable** (y Google, encargado). Con un solo proyecto compartido por muchos usuarios, el administrador puede ver todo (ver `docs/V22_SYNC_SECURITY.md`, sección 4): esto debe decirse con claridad y valorar el cifrado de extremo a extremo opcional.

### 2.2 Transferencia internacional

- Firestore se aloja fuera de Colombia (se sugiere `southamerica-east1` o `us-east1` en `docs/V22_FIREBASE_SETUP.md`; la ubicación es permanente). El art. 26 de la Ley 1581 prohíbe transferir datos a países sin nivel adecuado de protección, con excepciones (entre ellas la autorización expresa e inequívoca del titular) [15].
- La Circular Externa 005 de 2017 de la SIC publicó una lista de países con nivel adecuado que incluye a **Estados Unidos**; Brasil [no verificado si figura]. Hubo debate sobre esa lista y la Circular 008 de 2017 la modificó [17]. Hay que confirmar la lista vigente en 2026 [no verificado].
- Recomendación práctica: pedir **autorización expresa** para la transferencia en el consentimiento de sincronización, y decirlo en la política. Cláusulas de Google como encargado (Cloud Data Processing Addendum) [no verificado el texto aplicable].

### 2.3 Registro Nacional de Bases de Datos (RNBD)

- Deben inscribirse las **sociedades y entidades sin ánimo de lucro con activos totales superiores a 100 000 UVT** (en 2025, unos COP 5 mil millones), y las personas jurídicas públicas, si tratan datos personales [18]. Una fuente secundaria indica que las personas naturales están exoneradas [18, no verificado en primaria].
- Es decir, **un desarrollador persona natural o una pequeña empresa probablemente no está obligado a inscribirse**, pero la ley de protección de datos sí aplica igual. El umbral y los plazos de 2026 y la UVT vigente: [no verificado].

### 2.4 Estatuto del Consumidor (Ley 1480 de 2011)

- Si se cobra: información clara de precio, condiciones y renovaciones; el art. 47 regula el **derecho de retracto** en ventas a distancia (5 días hábiles según las fuentes) y la Ley 2439 de 2024 modificó aspectos del comercio electrónico (p. ej. plazo de devolución de dinero) [19].
- Si las compras de aplicaciones o suscripciones digitales quedan cubiertas por el retracto, y cómo se concilia con las políticas de reembolso de Play: [no verificado]. Consultar a un abogado.
- Buenas prácticas ya identificadas en `COMPETITIVE_RESEARCH.md`: precio claro, cancelar en un toque, restaurar compras.
- **Ley 2300 de 2023** ("Dejen de fregar"): regula canales, horarios y periodicidad de contacto para cobranza y publicidad hacia consumidores [20]. Aplica si se envían correos o mensajes comerciales o de cobro; sin marketing directo, su impacto es mínimo. No enviar publicidad sin autorización y respetar el registro de excluidos.

### 2.5 Menores de edad

- Los datos de niños y adolescentes tienen protección reforzada (interés superior, autorización del representante). El detalle de los artículos del Decreto 1074 sobre menores: [no verificado en esta revisión].
- Recomendación: público objetivo 18+, advertencia en el registro, sin recolección intencional de datos de menores, y proceso para eliminarlos si se detectan.

### 2.6 ¿Dispositivo médico (INVIMA)?

- El Decreto 4725 de 2005 recoge el software dentro de la definición de dispositivo médico; no hay un marco específico de software como dispositivo médico (SaMD) y se aplica el Decreto 4725. El software independiente cuyo uso previsto cumple la definición requiere registro sanitario [21]. El alcance exacto para apps de bienestar: [no verificado]; hay solo fuentes secundarias y de opinión [21].
- **Criterio práctico**: lo que importa es la **finalidad declarada**. Mantener la app como registro y bienestar: no afirmar que diagnostica, previene, trata, vigila enfermedades ni que "recomienda tratamiento".
- **Afirmaciones a evitar** en la ficha, la web y la app: "diagnostica", "detecta hipertensión/diabetes", "trata", "previene enfermedades", "controla tu diabetes", "reemplaza al médico", "calcula dosis".
- **Funciones a revisar con cuidado**: clasificaciones de presión arterial y glucosa (VitalsPage), frecuencia cardiaca, adaptación energética y recuperación muscular. Opciones: mantener solo el registro y el gráfico, mostrar rangos de referencia con la fuente, aviso visible "informativo, no diagnóstico", o quitar clasificaciones en la versión de Play.
- La ficha de Play debe incluir el aviso de "no es dispositivo médico" (1.8).

## 3. Licencias de datos para uso comercial

Fuentes: `README.md` y `THIRD_PARTY_NOTICES.md`. Las licencias citadas se leyeron de esos archivos y, donde se indica, de la fuente primaria.

| Componente | Licencia | Qué cambia si se vende | Acción |
|---|---|---|---|
| USDA FoodData Central | CC0 | Nada. Uso comercial libre | Mantener crédito por cortesía |
| Open Food Facts (instantánea de 641 filas y consultas en vivo) | ODbL 1.0 (base) y DbCL 1.0 (contenido); fotos CC BY-SA 3.0 | Vender la app es posible. Hay que atribuir "© Open Food Facts contributors", indicar licencia y cambios, y **compartir bajo la misma licencia (ODbL) cualquier base derivada que se distribuya públicamente**. El catálogo derivado `foods-off-co.json` ya se declara ODbL. Si se combina con otras bases en una base mayor, esa base derivada es ODbL | Mantener el archivo como base separada y documentada; no fusionar con datos propios en un solo conjunto; revisión legal. Miniaturas CC BY-SA: atribución y compartir igual |
| open-exercise-db | Datos CC0, código MIT | Nada relevante | Conservar aviso MIT |
| free-exercise-db | Unlicense | Nada | — |
| **RepDB (ilustraciones de ejercicios)** | "RepDB Free Tier License v1.0" | En el texto del commit fijado, el uso **comercial dentro de aplicaciones está permitido, con atribución visible** ("Exercise data by RepDB (repdb.co)") y sin republicar el conjunto como dataset, repositorio o API; no se pueden usar para entrenar IA; el nivel de pago ofrece resolución mayor, animaciones y uso sin atribución [22] | **Riesgo residual**: (1) el repositorio de Salud en GitHub es público y contiene las imágenes, lo que podría verse como "republicar" (ya señalado en `THIRD_PARTY_NOTICES.md`); (2) las condiciones pueden cambiar; (3) la licencia es propia, no OSI. Antes de vender: escribir a RepDB para confirmar por escrito el uso comercial en app distribuida por Play y el alojamiento en repositorio, o pasar el repositorio de medios a privado, o adquirir el nivel de pago |
| BodyParts3D | CC BY 4.0 | Uso comercial permitido con atribución y aviso de cambios (ya documentados) | Mantener la atribución visible en la app |
| Archivo (fuente) | SIL OFL 1.1 | Se puede incluir en una app comercial; no se vende la fuente sola y debe conservar su licencia | Mantener el aviso |
| Tesseract (OCR) | Apache 2.0 | Libre; OCR desactivado y código muerto (ARQ-04 en `AUDIT.md`) | Retirar la dependencia no usada |
| Tabla ICBF (TCAC) | No se redistribuye | La persona importa su archivo | Mantener así; no incluirla en la app |
| Dependencias npm de producción (152 paquetes) | MIT, Apache, etc. (ver `THIRD_PARTY_NOTICES.md`) | Obligación de avisos | Mantener la pantalla de licencias; **revisar** que Firebase y Capacitor tengan los avisos en el AAB |

Resumen: el único componente con riesgo comercial real es **RepDB** (alto en incertidumbre, bajo en costo de resolver). ODbL exige disciplina de separación de datos, no impide vender.

## 4. Costos operativos y escalabilidad

### 4.1 Límites y precios (con estado de verificación)

- **Firestore Spark (gratis)**, por proyecto y por día: 50 000 lecturas, 20 000 escrituras, 20 000 borrados, 1 GiB almacenado y 10 GiB/mes de salida; una base de datos gratuita por proyecto [23].
- **Blaze (de pago)**: las mismas cuotas gratuitas diarias se mantienen y se cobra el exceso; las cuotas se reinician cada día [23][24].
- **Authentication**: 50 000 usuarios activos al mes sin costo [24]. Detalles de Google Sign-In: [no verificado].
- **Tarifas por 100 000 operaciones y por GiB**: **[no verificado]**. La página oficial de precios de Cloud Firestore no pudo leerse completa en esta revisión. Cifras de referencia de memoria para el estándar en `nam5` (EE. UU.): lecturas ~USD 0,06, escrituras ~USD 0,18, borrados ~USD 0,02 por 100 000 y almacenamiento ~USD 0,18 por GiB/mes. Las regiones como São Paulo suelen costar más [23]. Confirmar con la calculadora de Google Cloud antes de decidir.
- Cloud Storage requiere Blaze para proyectos nuevos [no verificado], lo que afecta a una futura sincronización de fotos.

### 4.2 Estimación por 1 000 usuarios activos

Supuestos (todos propios, sin medición real):

- 1,3 dispositivos por usuario, app abierta ~1 hora al día, sincronización cada 5 minutos: 12 ciclos × 2 lecturas ≈ 25 lecturas, más relectura de ventana de solape y cambios remotos: **~100 lecturas por usuario y día**.
- **~60 escrituras por usuario y día** (comidas, series, hidratación, hábitos).
- Almacenamiento: 10 000 filas por usuario × 0,5 KB ≈ **5 MB por usuario** a un año, es decir ~5 GB para 1 000.
- Primera subida de historial: N escrituras (un historial de 20 000 filas tarda más de un día en el plan gratuito, ver `docs/V22_SYNC_SECURITY.md`).

Resultado mensual (30 días): ~3 M lecturas y ~1,8 M escrituras; con la cuota gratuita diaria del proyecto restada (50 000 y 20 000) quedan ~1,5 M lecturas y ~1,2 M escrituras facturables, más ~4 GiB sobre el gratuito. Con las tarifas de referencia: lecturas ~USD 1, escrituras ~USD 2, almacenamiento ~USD 1. **Orden de magnitud: USD 5 a 20 al mes** incluyendo picos y primeras subidas, es decir **menos de USD 0,02 por usuario al mes**. La sensibilidad principal es el patrón de sincronización (sincronizar cada 30 s multiplicaría las lecturas) y no el almacenamiento. Si los precios reales difieren, el orden de magnitud sigue siendo bajo.

**Escala**: con unas 100 personas se supera la cuota diaria del plan Spark (sobre todo las lecturas); a partir de ahí hay que activar Blaze con **presupuesto y alertas**, y tomar medidas: compactar lápidas (SYNC-09 en `AUDIT.md`), aumentar el intervalo, índices acotados.

### 4.3 Otros costos y condiciones

- **Alojamiento web (GitHub Pages)**: límites de sitio de 1 GB y ancho de banda blando de 100 GB al mes; **no está pensado ni permitido como alojamiento gratuito para un negocio** (comercio electrónico o SaaS comercial) [25]. Una PWA que cobre suscripciones estaría en zona gris: para comercializar, mover a un alojamiento con términos comerciales (Cloudflare Pages, Netlify, Firebase Hosting; precios y condiciones [no verificado]).
- **OTA**: el manifiesto y los paquetes son estáticos; el costo es de ancho de banda. Un paquete de interfaz de unos MB por 1 000 usuarios y versión es despreciable, pero el host debe poder servir HTTPS con el dominio estable (`httpsOnly` está activo). Las claves privadas de firma son un activo crítico: copia de seguridad y plan de rotación.
- **Cuenta de desarrollador de Google Play**: pago único de inscripción [valor no verificado]; verificación de identidad.
- **Dominio y correo de soporte**: unos pocos USD al mes [no verificado]; se necesita un dominio propio para política de privacidad, eliminación de cuenta y soporte.
- **Soporte**: es el costo principal en tiempo. A 1 000 usuarios, prever horas semanales de atención; un correo + FAQ + plantilla de respuestas.
- **Impuestos y entidad**: facturación, IVA y retenciones de las ventas de Play en Colombia, y si conviene constituir una empresa (SAS) o seguir como persona natural: [no verificado]; consultar contador.

## 5. Monetización compatible con las restricciones

### 5.1 Contexto de mercado (de `COMPETITIVE_RESEARCH.md`, precios USD de EE. UU. salvo indicación)

- Entrenamiento: barato, de 2 a 5 USD al mes o pago de por vida (Hevy: 2,99/mes, 23,99/año, 74,99 de por vida [verificado en la investigación con fuentes de blogs competidores]).
- Nutrición: 5 a 12 USD al mes; MacroFactor 11,99/mes o 71,99/año y sin plan gratis; paquete nutrición + entreno 89,99 al año [verificado en MacroFactor].
- Fitia en Colombia: ~15 900 COP al mes y ~95 900 COP al año [reportado, sin verificar en tienda].
- Los usuarios se quejan de **subidas de precio sin funciones nuevas**, facturación confusa y suscripciones que fallan; el lanzamiento de Garmin Connect+ provocó críticas por "muros de pago" [COMPETITIVE_RESEARCH.md].

### 5.2 Opciones

| Opción | Pros | Contras | Encaje con las reglas |
|---|---|---|---|
| A. Núcleo gratis + suscripción "Apoyo" para funciones **nuevas** de bajo costo marginal (copia en la nube gestionada, respaldos automáticos, informes) | Ingreso recurrente que cubre el costo de la nube; comparable a Hevy | Hay que construir funciones nuevas que justifiquen cobrar; gestión de suscripciones, reembolsos, retracto | Encaja si **nada existente** se bloquea |
| B. Pago único "Pro" para funciones avanzadas futuras (p. ej. planes adaptativos, informes PDF, más perfiles) | Sin facturación recurrente; atractivo en Colombia; soporte más simple | Ingreso no cubre costos continuos de nube; puntual | Encaja; los dos usuarios actuales reciben Pro de por vida |
| C. Donación / "invítame un café" | Casi sin trabajo, sin muros | Ingreso bajo e irregular; Play puede exigir Play Billing si se hace dentro de la app [no verificado] | Encaja perfecto |
| D. Todo de pago (modelo MacroFactor) | Mayor ingreso por usuario | Rompe la regla de no poner muros; sin base de usuarios ni marca | **No encaja** |

### 5.3 Recomendación

1. **Mantener gratis y completo** todo lo que existe hoy (nutrición, entreno, salud, respaldo, exportación, sincronización básica opcional, Health Connect). Regla escrita: *"Ninguna función presente en la versión 3.x se mueve a un nivel de pago."*
2. **Opción B + C primero**: pago único opcional "Salud Pro" (o "Apoyo") que desbloquea **solo funciones nuevas**, más una vía de donación. Precio de referencia a validar con usuarios: del orden de 20 000 a 40 000 COP (lo que una suscripción anual de Fitia cuesta) o USD 10 a 20, **[propuesta no validada]**.
3. **Opción A como segunda etapa** solo si el costo de nube lo exige: ofrecer "Apoyo" mensual que incluya una copia en la nube gestionada con cifrado de extremo a extremo y soporte prioritario; la sincronización opcional ya existente seguiría gratis en su forma actual (con límites razonables si el costo crece, y **sin recortar a los usuarios existentes**).
4. Los dos usuarios actuales: derechos de por vida (ver sección 7: lista de perfiles "fundadores").
5. Precios previsibles, cancelación en un toque, restauración de compras, política de reembolso clara y sin subidas retroactivas, según las quejas del mercado.
6. Cualquier venta dentro de la app por Play: **Play Billing** (1.7).

## 6. Análisis de brechas de preparación

Esfuerzo: S (días), M (1 a 3 semanas), L (más de 3 semanas). "Bloqueante" se refiere a publicar en Play Store.

| Área | Estado actual | Qué falta | Esfuerzo | Bloqueante |
|---|---|---|---|---|
| Incorporación (onboarding) | Existen `Welcome` y `Onboarding` | Revisar con personas nuevas; explicar permisos de Health Connect y de nube en contexto; consentimiento explícito de datos sensibles | M | Sí |
| Internacionalización | Solo es-CO; textos en el código | Extraer cadenas a catálogo; formatos de fecha y unidades; inglés primero si hay otro mercado (puede posponerse: lanzar solo en Colombia) | L | No |
| Accesibilidad | ~268 `aria-label`; sin auditoría formal | Auditoría con TalkBack, contraste, tamaños táctiles, tamaño de fuente; reducir movimiento | M | No (recomendado) |
| Documentación / ayuda | README técnico, guías V2.2 | Ayuda dentro de la app, preguntas frecuentes, guía de Health Connect y de respaldo | M | No |
| Canal de soporte | Ninguno | Correo de soporte y dominio; plantilla de respuestas; enlace en la app y en Play | S | Sí |
| Política de privacidad | Borrador en `docs/PRIVACIDAD_BORRADOR.md` | Revisión legal, alojarla en URL pública estable, enlazarla en app, Play y Health Connect | S (más revisión) | **Sí** |
| Consentimientos | Sin pantalla de consentimiento explícito | Consentimiento separado para nube y transferencia internacional; registro de aceptación | M | Sí |
| Eliminación de cuenta y datos | Borrado de nube en app; Authentication solo por consola | Botón "eliminar cuenta" (reautenticación) y página web de solicitud con nombre de la app | M | **Sí** |
| Exportación de datos | JSON por perfil/completo y CSV | Aviso de que incluye fotos (SEC-11); exportación por trozos para historiales grandes (SEC-05) | S a M | No |
| Reporte de fallos sin telemetría invasiva | Ninguno por diseño | Opción **opt-in** que genere un informe local y la persona decide enviarlo por correo (sin SDK); alternativa: Crashlytics opt-in, que obligaría a actualizar Data safety y política | M | No |
| Material de ficha de tienda | No existe | Icono 512, gráfico de 1024×500, capturas de teléfono (y tableta), descripción con aviso "no es dispositivo médico", categoría, clasificación de contenido (IARC) | M | Sí |
| Firma y proceso de lanzamiento | APK firmado por sideload; verificación con `verify-android-apk.py`; OTA firmado | AAB, **Play App Signing** y clave de subida, `versionCode` coherente, checklist de lanzamiento, pistas internas y cerradas; decidir variante Play sin OTA (1.6) | M | Sí |
| Copias de seguridad | JSON manual; nube opcional; `allowBackup=false` | Añadir `dataExtractionRules` (SEC-06: no hay en el manifiesto); respaldo de claves OTA y de la clave de subida | S | No (es seguridad) |
| Revisión de seguridad | `AUDIT.md` interno; reglas con pruebas de emulador | Cerrar los hallazgos medios (SYNC-09, SEC-04, PERF-01); prueba de penetración o revisión externa de reglas y OTA; revisar dependencias | M a L | No (muy recomendado) |
| Revisión legal | No hecha | Abogado: política, aviso, consentimientos, transferencia, retracto, reclamos de salud, RepDB/ODbL | M (externo) | **Sí** |
| Cuenta de desarrollador y pruebas | No existe | Crear cuenta; verificación de identidad; 12 testers × 14 días si es personal | M (calendario) | **Sí** |
| Declaraciones de Play | No hechas | Health apps, Data safety, público objetivo, anuncios (no), noticias (no), permisos | S a M | Sí |
| Licencias y atribución | Pantalla de licencias y avisos | Resolver RepDB (sección 3); verificar avisos en el AAB | S a M | Sí (RepDB) |
| Reclamos médicos | Avisos en vitales y recuperación | Revisar todo el texto, decidir sobre clasificaciones de presión y glucosa, aviso en ficha | S a M | Sí |
| Facturación (futura) | No existe | Play Billing, restaurar compras, derechos de fundadores | L | No (hasta cobrar) |
| Hosting comercial | GitHub Pages | Mover de host si se cobra desde la PWA (4.3) | S | No (solo Play) |
| Pruebas | Unitarias, e2e y emulador | Pruebas en varios dispositivos reales, API 26 a 36, modo oscuro, fuente grande | M | No |

## 7. Preparación de arquitectura (sin implementar cobros)

Estado: no existe módulo de permisos o `entitlements` ni banderas de funciones (búsqueda en `src` sin resultados). Propuesta mínima, que no cambia el comportamiento:

1. **Módulo `entitlements`** (`src/entitlements/`): una función `can(feature, profile)` que, mientras no haya cobro, devuelve `true` para todas las funciones. Las pantallas llaman a `can()` solo en funciones **nuevas**, nunca en las existentes.
2. **Lista cerrada de funciones**: un catálogo tipado `FeatureId` dividido en `core` (siempre abierto, inmutable por regla y con una prueba que falla si alguna función `core` exige derecho) y `plus` (futuras). Una prueba unitaria protege la promesa "nada existente se bloquea".
3. **Por defecto "todo desbloqueado"**: para perfiles existentes se guarda una marca `legacyFounder: true` (en la configuración local del perfil) que concede todos los derechos futuros; la migración la aplica a los perfiles que existan antes de la primera versión comercial.
4. **Capa de facturación detrás de una interfaz** (`BillingProvider`): implementación nula por ahora; después, Play Billing en Android y ninguna en la PWA. Los derechos se guardan localmente (cache) y se verifican contra Play al abrir; sin conexión se respeta el último estado conocido, sin bloquear datos propios.
5. **Datos nunca bloqueados**: exportar, importar, borrar y ver el historial propio quedan fuera de cualquier nivel. Si un derecho caduca, las funciones plus pasan a solo lectura; no se oculta ni se pierde información.
6. **Banderas de configuración remota**: no recomendado (introduce telemetría y dependencia). Preferir banderas de compilación y variantes (`play` y `directa`).
7. **Variantes de compilación**: `play` (OTA desactivado o limitado, Play Billing, sin permisos extra) y `directa` (sideload con OTA firmado, para uso personal). Coordinar con `SALUD_DEV` ya existente en `capacitor.config.ts`.
8. **Control de versiones de datos**: ya hay respaldo versionado y esquema; mantener pruebas de migración antes de cada actualización de Play.
9. **Consentimiento como dato**: guardar localmente `consent: { cloud, transfer, healthConnect, at, version }` por perfil para poder demostrar la autorización (Decreto 1377) sin enviarla a la nube.
10. **Registro de lanzamiento**: documento con la lista de comprobación y los pasos de la sección 8.

## 8. Ruta sugerida

1. Revisión legal del borrador de privacidad y de los consentimientos; elegir correo y dominio.
2. Resolver RepDB y ODbL por escrito.
3. Crear la cuenta de Play, verificar identidad, preparar prueba cerrada con 12 testers (familia, amigos, comunidad deportiva) durante 14 días.
4. Añadir consentimientos, eliminación de cuenta y página web de solicitud; `dataExtractionRules`; recortar permisos y clasificaciones médicas si procede.
5. Construir AAB con Play App Signing; decidir la variante `play`; completar declaraciones y ficha.
6. Lanzar gratis en Colombia; medir costo de la nube y soporte; después evaluar la sección 5.

## 9. Lo que no se pudo verificar

- Tarifas exactas de Firestore en Blaze por ubicación; cuota exacta y precios de Authentication para Google Sign-In.
- Si Play exige video de demostración para los permisos de Health Connect de Salud.
- Texto actual de la política de Play sobre OTA para Capacitor; no hay aprobación formal publicada, solo la excepción de código interpretado.
- Condiciones de Play Billing y tarifas en Colombia; si las donaciones requieren Play Billing.
- Artículos exactos del Decreto 1074 de 2015 sobre aviso de privacidad, menores y plazos de respuesta; lista vigente de países adecuados (SIC) en 2026; UVT y plazos RNBD 2026.
- Aplicación del retracto (Ley 1480, art. 47, y Ley 2439 de 2024) a suscripciones digitales.
- Alcance del registro sanitario INVIMA para software de bienestar.
- Alojamiento alternativo a GitHub Pages y sus precios; costo de la inscripción de desarrollador; impuestos y forma societaria.
- Vigencia de la licencia RepDB y su interpretación sobre repositorios públicos.
- Las fechas de la verificación de desarrolladores de Android para Colombia.

## 10. Fuentes

1. Google Play, requisito de API objetivo: https://support.google.com/googleplay/android-developer/answer/11926878?hl=en-419
2. Android Developers, target SDK: https://developer.android.com/google/play/requirements/target-sdk
3. Android Developers, publicar una app de salud (declaración Health Connect): https://developer.android.com/health-and-fitness/health-connect/declare-access
4. Play Console, preguntas frecuentes de la política de Health Connect: https://support.google.com/googleplay/android-developer/answer/12991134
5. Play Console, política de Datos de usuario y Data safety: https://support.google.com/googleplay/android-developer/answer/10144311 y https://support.google.com/googleplay/android-developer/answer/10787469
6. Play Console, requisitos de eliminación de cuenta: https://support.google.com/googleplay/android-developer/answer/13327111
7. Play Console, política de Familias: https://support.google.com/googleplay/android-developer/answer/9893335
8. Play Console, requisito de prueba cerrada para cuentas personales: https://support.google.com/googleplay/android-developer/answer/14151465
9. Android Developers, verificación de desarrolladores: https://developer.android.com/developer-verification/guides y https://android-developers.googleblog.com/2026/03/android-developer-verification-rolling-out-to-all-developers.html
10. Play Console, política de Dispositivos y Red: https://support.google.com/googleplay/android-developer/answer/9888379?hl=en
11. Capgo (proveedor, interés comercial): https://capgo.app/blog/do-google-allow-live-updates/ y https://bitrise.io/blog/post/what-app-stores-allow-with-ota-updates-apple-and-google-policy-explained
12. Play Console, política de Pagos: https://support.google.com/googleplay/android-developer/answer/10281818 y tarifas: https://support.google.com/googleplay/android-developer/answer/112622
13. Play Console, política de Apps de salud: https://support.google.com/googleplay/android-developer/answer/13996823
14. Play Console, contenido y servicios de salud: https://support.google.com/googleplay/android-developer/answer/16679511
15. Ley 1581 de 2012 (texto): https://www.funcionpublica.gov.co/eva/gestornormativo/norma_pdf.php?i=49981
16. Decreto 1377 de 2013 (compilado en el Decreto 1074 de 2015): https://normograma.dian.gov.co/dian/compilacion/docs/decreto_1377_2013.htm
17. SIC, Circular Externa 005 de 2017 y resumen de Holland & Knight: https://www.hklaw.com/en/insights/publications/2017/08/cambios-en-la-transferencia-de-datos-personales-a
18. RNBD, quién debe inscribirse: https://www.hklaw.com/es/insights/publications/2025/01/obligaciones-del-registro-nacional-de-bases-de-datos-personales y https://www2.deloitte.com/content/dam/Deloitte/co/Documents/legal/Registro-Nacional-de-Bases-de-Datos-2025.pdf
19. Ley 1480 de 2011 (art. 47) y comentarios: https://www.funcionpublica.gov.co/eva/gestornormativo/norma_pdf.php?i=58936 y https://www.corteconstitucional.gov.co/relatoria/2026/c-192-26.htm
20. Ley 2300 de 2023: https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=213990
21. Software como dispositivo médico en Colombia (fuentes secundarias): https://www.asuntoslegales.com.co/analisis/caterine-gomez-toro-4283129/los-software-medicos-en-colombia-una-deuda-regulatoria-que-ya-no-admite-espera-4283127 y https://bioaccessla.squarespace.com/blog/colombia-overview-of-regulatory-framework-for-medical-devices
22. RepDB, Free Tier License v1.0 (commit fijado): https://github.com/RepDB/exercise-dataset/blob/f12da458a90f353a86c953f204304d5a8bd98275/LICENSE-DATA.md
23. Firebase, precios de Firestore: https://firebase.google.com/docs/firestore/pricing y https://cloud.google.com/firestore/pricing
24. Firebase, planes de precios: https://firebase.google.com/docs/projects/billing/firebase-pricing-plans y https://firebase.google.com/pricing
25. GitHub Pages, límites y uso: https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits
26. Textos de licencia de datos (no leídos aquí, citados por `THIRD_PARTY_NOTICES.md`): ODbL https://opendatacommons.org/licenses/odbl/1-0/ ; DbCL https://opendatacommons.org/licenses/dbcl/1-0/ ; CC BY 4.0 https://creativecommons.org/licenses/by/4.0/
27. Archivos internos: `README.md`, `docs/V22_SYNC_SECURITY.md`, `docs/V22_FIREBASE_SETUP.md`, `COMPETITIVE_RESEARCH.md`, `AUDIT.md`, `THIRD_PARTY_NOTICES.md`, `capacitor.config.ts`, `android/app/src/main/AndroidManifest.xml`.
