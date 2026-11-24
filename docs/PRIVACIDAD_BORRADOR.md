# Aviso de privacidad y política de tratamiento de datos de Salud

> **BORRADOR. NO ES UN DOCUMENTO LEGAL VIGENTE.**
> Este texto es un borrador técnico y debe ser **revisado por un abogado colombiano** (Ley 1581 de 2012, Decreto 1377 de 2013 compilado en el Decreto 1074 de 2015 y circulares de la Superintendencia de Industria y Comercio) antes de publicarlo o de ponerlo en una tienda de aplicaciones. Los datos entre corchetes son marcadores por completar.

Última actualización del borrador: [fecha]
Versión de la app a la que aplica: [versión]

## 1. Quién es el responsable

- **Responsable del tratamiento:** [responsable] (identificación y domicilio: [datos]).
- **Contacto para consultas, reclamos y solicitudes de derechos:** [correo de contacto].

Mientras uses Salud **solo en tu dispositivo**, tus datos no llegan al responsable. El responsable recibe datos únicamente si activas la sincronización opcional con la nube (sección 4).

## 2. Qué datos maneja la app

Salud permite registrar nutrición, entrenamiento, medidas corporales, actividad, sueño, signos vitales, hidratación y hábitos. Estos datos incluyen **datos de salud, que la ley colombiana considera datos sensibles**. No estás obligado a proporcionarlos ni a autorizar su tratamiento, y ninguna función de uso local se condiciona a que lo hagas.

| Tipo de dato | Dónde queda | Se sube a la nube |
|---|---|---|
| Registros de comida, entrenos, peso, medidas, vitales, hidratación, hábitos, perfiles y ajustes | En el almacenamiento del dispositivo (IndexedDB) | Solo si activas la sincronización |
| Fotos de progreso y fotos de etiquetas | En el dispositivo | **Nunca** |
| Datos de Health Connect (Android) | Se leen cuando los autorizas; se usan en la app | **Nunca** |
| Correo y nombre de tu cuenta de Google | Solo en el dispositivo, para mostrarlos | El proveedor de acceso (Google) los trata para iniciar sesión |
| Nombre del perfil | En el dispositivo | Sí, si sincronizas (sirve para evitar mezclar datos de personas distintas) |

## 3. Para qué se usan (finalidades)

1. Mostrarte tu propio registro, gráficas y estimaciones dentro de la app.
2. Si lo activas, mantener una copia en la nube y sincronizar tus dispositivos.
3. Si lo autorizas en Android, leer de Health Connect pasos, calorías activas, distancia, frecuencia cardiaca, frecuencia en reposo, ejercicio, sueño, peso, grasa corporal y masa magra, **solo lectura**, para mostrarlos en la app.
4. Consultar la base Open Food Facts cuando escaneas un código de barras.

No usamos tus datos para publicidad, perfilado comercial, venta ni entrenamiento de modelos de inteligencia artificial.

## 4. Sincronización opcional con la nube

- Es **opcional y puede revocarse**. Sin ella, la app funciona completa sin conexión.
- Para activarla inicias sesión con tu cuenta de Google (Firebase Authentication). Los datos sincronizados se guardan en **Cloud Firestore** (Google), en una ubicación fuera de Colombia: [ubicación del proyecto, p. ej. São Paulo o Estados Unidos]. Esto implica una **transferencia internacional de datos**, que realizas con tu autorización expresa al activar la sincronización.
- Los datos viajan con cifrado en tránsito (TLS) y Google los cifra en reposo. **No hay cifrado de extremo a extremo**: Google puede técnicamente acceder a ellos y quien administra el proyecto de Firebase puede verlos desde la consola. [responsable] se compromete a [compromisos de acceso y confidencialidad por definir].
- Cada cuenta solo puede leer y escribir su propio espacio de datos (reglas de acceso del servidor).
- No se sincronizan fotos ni datos de Health Connect.
- Google actúa como encargado del tratamiento bajo sus propios términos: [enlazar términos aplicables tras revisión legal].

## 5. Lo que no hacemos

- No hay anuncios, analítica ni rastreadores. No usamos Google Analytics ni Crashlytics. [Confirmar antes de publicar; si se añade un informe de fallos, será opcional y se actualizará este aviso.]
- No hay telemetría de uso.
- La copia de seguridad automática de Android en la nube está desactivada para que tus datos de salud no se suban por esa vía.
- La app no pide ubicación, contactos ni mensajes.

## 6. Permisos del dispositivo

- **Internet:** para sincronización opcional, consulta de códigos de barras y actualizaciones de la interfaz.
- **Cámara:** solo para fotografiar etiquetas nutricionales o leer códigos de barras; la imagen no se sube.
- **Notificaciones:** solo si activas los avisos del temporizador de descanso.
- **Health Connect (solo lectura):** cada tipo se concede por separado y puedes retirarlo en cualquier momento desde Health Connect o los ajustes de Android.

## 7. Servicios de terceros

- **Google (Firebase Authentication y Cloud Firestore):** solo si activas la sincronización.
- **Open Food Facts:** al buscar un producto por código de barras se envía el código a su servicio. Los datos de producto son de la comunidad de Open Food Facts (licencia ODbL).
- **Actualizaciones de la interfaz:** la app puede descargar paquetes firmados desde [dirección del servidor de actualizaciones]. Esa conexión puede registrar tu dirección IP en el servidor: [período de conservación de registros por definir].

## 8. Tus derechos (Ley 1581 de 2012)

Como titular puedes:

1. **Conocer** los datos que tratamos sobre ti.
2. **Actualizar** tus datos.
3. **Rectificar** datos inexactos.
4. **Suprimir** tus datos, cuando no haya deber legal de conservarlos.
5. **Revocar** la autorización dada.
6. Pedir **prueba de la autorización** y ser informado del uso de tus datos.
7. Presentar quejas ante la **Superintendencia de Industria y Comercio**.

Para ejercerlos escribe a [correo de contacto]. Responderemos en los plazos legales: [plazos por confirmar con el abogado]. Podemos pedirte que acredites tu identidad.

### Cómo exportar tus datos

En la app: **Respaldo → exportar** genera un archivo JSON por perfil o completo (también hay exportación CSV). Aviso: el respaldo puede incluir tus fotos de progreso; guárdalo en un lugar seguro porque **no está cifrado**.

### Cómo borrar tus datos

- **En el dispositivo:** elimina el perfil desde **Perfil**, o desinstala la app. Si hay cambios sin subir, la app te lo advierte.
- **En la nube:** **Cuenta → Borrar los datos de la nube** (se confirma escribiendo el nombre del perfil). Elimina todo tu espacio en Firestore y desvincula el perfil; los datos del dispositivo no se tocan.
- **Cuenta de acceso:** para eliminar también el registro de Firebase Authentication (identificador, correo, nombre) escribe a [correo de contacto]. [Pendiente: botón dentro de la app y página web de solicitud de eliminación, requeridos por Google Play.]
- Los respaldos que hayas guardado tú mismo en tu dispositivo o en otros servicios no los controlamos.

## 9. Conservación

- Datos locales: hasta que los borres o desinstales la app.
- Datos en la nube: mientras mantengas la sincronización o hasta que los borres. Tras la eliminación, la copia de seguridad de Google puede tardar [plazo por confirmar]. Los registros marcados como borrados pueden persistir como marcas técnicas hasta [plazo por confirmar].

## 10. Seguridad

Aplicamos reglas de acceso por cuenta, cifrado en tránsito y verificación de firma de las actualizaciones. Ningún sistema es infalible. Si pierdes el acceso a tu cuenta de Google, pierdes el acceso a la copia en la nube; mantén respaldos manuales.

## 11. Menores de edad

Salud **no está dirigida a menores de 18 años**. No recolectamos conscientemente datos de menores. Si crees que un menor ha usado la app con sincronización, escribe a [correo de contacto] para eliminarlos. [El abogado debe validar este texto frente a las reglas de datos de niños, niñas y adolescentes.]

## 12. Aviso de salud

Salud es una herramienta de **registro y bienestar general**. **No es un dispositivo médico, no diagnostica, no trata, no cura ni previene enfermedades** y no reemplaza la consulta con un profesional de la salud. Las clasificaciones y estimaciones (por ejemplo, de presión arterial, glucosa, gasto energético o recuperación muscular) son orientativas.

## 13. Cambios a este aviso

Publicaremos los cambios en [URL de la política] y, si cambian las finalidades o los datos recolectados, pediremos una nueva autorización.

## 14. Texto de autorización (propuesta para la pantalla de consentimiento)

> Autorizo de manera previa, expresa e informada a [responsable] para tratar mis datos de salud que registre en Salud, con las finalidades de la sección 3. Entiendo que son datos sensibles, que no estoy obligado a autorizarlos, que puedo usar la app solo en mi dispositivo sin hacerlo, y que puedo revocar esta autorización en cualquier momento. Al activar la sincronización, autorizo expresamente la transferencia de mis datos a servidores de Google ubicados fuera de Colombia, según la sección 4.

[Se recomienda casillas separadas para (a) sincronización y transferencia internacional y (b) lectura de Health Connect.]

## Fuentes

1. Ley 1581 de 2012: https://www.funcionpublica.gov.co/eva/gestornormativo/norma_pdf.php?i=49981
2. Decreto 1377 de 2013 (compilado en el Decreto 1074 de 2015): https://normograma.dian.gov.co/dian/compilacion/docs/decreto_1377_2013.htm
3. Google Play, requisitos de política de privacidad y Data safety: https://support.google.com/googleplay/android-developer/answer/10144311
4. Google Play, eliminación de cuenta: https://support.google.com/googleplay/android-developer/answer/13327111
5. Google Play, apps de salud y Health Connect: https://developer.android.com/health-and-fitness/health-connect/declare-access
6. Hechos del producto: `README.md` y `docs/V22_SYNC_SECURITY.md` del repositorio.

Puntos no verificados que el abogado debe cerrar: contenido mínimo exacto del aviso de privacidad, plazos de respuesta, reglas para menores, lista vigente de países con nivel adecuado de protección (SIC), términos de Google como encargado, y obligación de registro en el RNBD.
