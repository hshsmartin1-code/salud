# Salud V2.2 — Seguridad, privacidad y costos de la sincronización

## 1. Principios

1. **Dexie es la fuente principal.** La app funciona entera sin conexión; la nube es una copia por perfil.
2. **Una persona, una cuenta y un perfil.**
   - En cada dispositivo, un perfil local se vincula a lo sumo a una cuenta (uid) y una cuenta a lo sumo a un perfil.
   - Nunca se sincroniza un perfil con la sesión de otro: cada perfil tiene su propia instancia de Firebase (`salud-<perfil>`) y su propia sesión.
   - Cada sincronización comprueba que el uid de la sesión coincide con el vínculo (`account-mismatch` → no se envía nada).
3. **Nada se pierde en silencio.**
   - Las escrituras llevan revisión, y el servidor solo acepta `rev = anterior + 1`.
   - Si dos dispositivos cambian el mismo registro, se guardan las dos versiones hasta que la persona elige.
   - Los borrados masivos se retienen hasta confirmarlos.
   - Iniciar sesión, cerrar sesión o desvincular nunca borra datos locales.
   - Dos versiones que solo difieren en `createdAt`/`updatedAt` no son un conflicto: se toma la de la nube.
   - Al **unir** un perfil con una cuenta que ya tiene datos, la vista previa cuenta los duplicados probables: el mismo registro guardado en los dos lados con ids distintos (comida: fecha, comida del día, alimento y gramos; peso: fecha y valor; hidratación: fecha, hora y cantidad; sesión: inicio con menos de 2 min de diferencia). «Omitir duplicados probables» (activado por defecto) no sube la copia del dispositivo ni descarga la de la nube; cada lado conserva la suya y no se borra nada. Si después cambia una de las dos copias, el cambio se sincroniza normalmente. Las sesiones de entrenamiento solo se informan, porque cada una lleva sus series.

## 2. Reglas de Firestore (`firestore.rules`)

| Regla | Efecto |
|---|---|
| Denegar por defecto | Fuera de `users/{uid}` no se puede leer ni escribir nada |
| `request.auth.uid == uid` | Cada cuenta solo ve su propio árbol (lectura, escritura y listado) |
| Esquema estricto de fila | Campos exactos `t, id, rev, del, d, h, at`; tabla en la lista blanca (fotos y Health Connect no están en la lista, así que el servidor las rechaza); `id` de hasta 300 caracteres; `d` de hasta 200 000; la clave del documento debe empezar por `<tabla>~` |
| Revisión | Al crear, `rev == 1`; al actualizar, `rev == anterior + 1`; no se puede cambiar `t` ni `id` |
| Hora del servidor | `at == request.time`: el reloj del teléfono no cuenta |
| Lápida coherente | `del == true` exige `d == null` y `h == null` |
| Metadatos | `users/{uid}` solo admite `profileName, createdAt, schema, appVersion`, sin correo ni otros campos |

Las pruebas del emulador (`emulator-tests/rules.test.ts`) cubren estas reglas con distintos usuarios. También cubren el acceso sin sesión, a otra cuenta, a colecciones ajenas, revisiones antiguas, saltadas o repetidas, campos extra, tablas no permitidas, relojes del cliente, tamaño y metadatos con correo.

Una prueba unitaria comprueba que la lista de tablas de las reglas coincide con la del código.

## 3. Minimización de datos

- **En la nube** solo hay filas de tablas sincronizadas. Los ids locales de perfil se reemplazan por `@`, así que la nube no conoce la estructura del dispositivo.
- **El correo y el nombre de la cuenta** se guardan solo en el dispositivo (`syncLinks`), para mostrarlos. En Firestore, el único dato de identificación es el nombre del perfil (`profileName`), que sirve para avisar si alguien intenta unir datos de otra persona.
- **No se suben**, con el motivo visible en la app:
  - fotos de etiquetas y de progreso (tamaño y privacidad; requeriría Cloud Storage, que se evalúa aparte);
  - registros de Health Connect (el permiso es de cada teléfono);
  - el estado de integraciones.
- **Los respaldos** no incluyen la contabilidad de sincronización. Restaurar un respaldo no puede «vincular» nada.

## 4. Cifrado: qué hay y qué no

- **Lo que hay:**
  - TLS entre la app y Google;
  - cifrado en reposo de Google Cloud;
  - reglas por uid.
- **Lo que no hay: cifrado de extremo a extremo.**
  - Google puede técnicamente acceder a los datos.
  - Quien administre el proyecto de Firebase también puede ver los datos de **todas** las cuentas desde la consola. En un hogar donde una persona crea el proyecto y la otra lo usa, esa persona tendría acceso técnico a los datos de la otra. Deben acordarlo; si no, cada persona debería tener su propio proyecto.
- **Evaluación del cifrado en el cliente (no implementado):**
  - **Factibilidad:** el diseño lo permite sin cambiar el motor, porque el servidor nunca necesita leer `d`. Bastaría cifrar `d` con AES-GCM usando una clave derivada de una frase de paso por cuenta (PBKDF2 o Argon2), y convertir `h` en un HMAC con esa clave para no revelar qué filas son iguales.
  - **Consecuencias:**
    - si se pierde la frase de paso, se pierde la copia en la nube (no hay recuperación);
    - hay que introducirla en cada dispositivo;
    - no se puede ayudar desde la consola;
    - las reglas ya no pueden validar el contenido (solo tamaños);
    - el rendimiento de dispositivos antiguos empeora un poco.
  - **Recomendación:** activarlo como opción por perfil en una fase posterior, con advertencia explícita y prueba de recuperación.

## 5. Sesiones, dispositivos compartidos y registros

- **Sesiones:**
  - La sesión la guarda el SDK de Firebase en el IndexedDB de su instancia. La app no copia, muestra ni registra tokens.
  - En Android, el plugin nativo solo entrega un token de Google de un solo uso. Acto seguido se cierra la sesión nativa para que el siguiente perfil pueda elegir otra cuenta.
- **Sesión caducada o revocada:**
  - La sincronización se detiene con «Inicia sesión de nuevo».
  - Si se inicia con otra cuenta, la app cierra esa sesión al momento y no sincroniza.
- **Dispositivo compartido:**
  - «Cerrar sesión» conserva los datos locales.
  - Para quitarlos también, primero hay que comprobar que no queden cambios pendientes y después eliminar el perfil desde «Perfil». Esto cierra su sesión y nunca toca la nube.
- **Registros de diagnóstico:**
  - El motor guarda solo un código de error y un mensaje genérico de hasta 200 caracteres, nunca contenido de filas.
  - No hay `console.log` de datos de salud.
  - No hay analítica, Crashlytics ni rastreadores publicitarios: Google Analytics está desactivado en la guía de configuración y el SDK de Analytics no se importa.

## 6. Eliminación y exportación

- **Exportar mis datos:** «Respaldo» genera el JSON completo del perfil, ahora también enlazado desde la pantalla de cuenta.
- **Desvincular:** el dispositivo deja de sincronizar ese perfil. Los datos locales y la nube quedan intactos.
- **Borrar los datos de la nube:**
  - hay que escribir el nombre del perfil para confirmar;
  - elimina todos los documentos `users/{uid}/rows/*` y `users/{uid}`, y desvincula;
  - los datos del dispositivo no se tocan;
  - otro dispositivo vinculado lo detecta (`cloud-reset`) y **no vuelve a subir nada** sin una nueva vinculación explícita.
- **Cuenta de acceso:** el registro de Firebase Authentication (uid, correo, nombre) se elimina desde la consola (**Authentication → Usuarios**). La eliminación de la cuenta desde la app queda para una fase siguiente, porque requiere un inicio de sesión reciente.
- **Eliminar el perfil local:** cierra su sesión en el dispositivo y deja la nube intacta. Si había cambios sin subir, el diálogo lo advierte.

## 7. Costos y límites del plan gratuito

Cuotas diarias de Cloud Firestore en Spark (sin tarjeta): 1 GiB almacenado, 50 000 lecturas, 20 000 escrituras, 20 000 borrados y 10 GiB de salida al mes. Hay una base de datos gratuita por proyecto. Authentication con Google no tiene costo en este volumen.

| Operación | Costo aproximado |
|---|---|
| Sincronización sin cambios | 2 lecturas: metadatos y una consulta vacía (Firestore cobra 1 lectura por consulta sin resultados) |
| Cada cambio local | 1 escritura (subida en lotes de hasta 200) |
| Ventana de solape | Mientras el último cambio visto tenga menos de 90 s, cada sincronización relee los documentos escritos en los 90 s anteriores a él (por si un cambio se hace visible con una hora del servidor algo anterior; releer no aplica nada dos veces). La primera sincronización pasados 90 s (reloj del dispositivo) la relee una última vez; después se lee solo lo posterior al último documento visto |
| Primera descarga o relectura completa de N filas | N lecturas (cada documento se lee una sola vez, aunque un lote de 200 quede repartido entre dos páginas) |
| Verificar o vincular | 25 consultas de conteo: unas 25 lecturas |
| Buscar duplicados probables en la vista previa de «Unir» | 1 lectura por fila de comidas, mediciones, sesiones e hidratación de la cuenta (solo en las tablas con filas en ambos lados) |
| Primera subida de un historial de N filas | N escrituras |

**Estimación para dos personas y dos dispositivos cada una**, con la app abierta una hora diaria (sincronización cada 5 minutos, más tras cambios): menos de 1 000 lecturas y unas 200–400 escrituras al día. Es menos del 2–3 % de la cuota. El almacenamiento es de 0,5–1 KB por fila: 20 000 filas ≈ 20 MB.

**Riesgos:**

- **Historiales enormes:** un historial de más de 20 000 filas tarda más de un día en subir. La cuota corta a mitad de la subida, la sincronización se reanuda sola al día siguiente y la vinculación queda «sin verificar» hasta completarse.
- **Ubicación de Firestore:** es permanente.
- **Dependencia del proyecto:** si el proyecto se borra o se suspende, la copia en la nube desaparece, pero la local no.
- **Pérdida de la cuenta de Google:** se pierde el acceso a esa copia. Hay que mantener los respaldos manuales.
- **Plan Blaze (de pago):** solo si lo activas tú. Cualquier cambio a Blaze debe hacerse con presupuesto y alertas; la app no lo necesita.
