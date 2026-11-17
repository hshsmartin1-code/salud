package app.salud.personal.healthconnect

import android.app.Activity
import android.graphics.Color
import android.os.Bundle
import android.view.ViewGroup
import android.widget.ScrollView
import android.widget.TextView

/**
 * Shown by Health Connect when the person taps "privacy policy" on the permissions screen.
 * Plain text on purpose: no network, no web view.
 */
class PermissionsRationaleActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val pad = (20 * resources.displayMetrics.density).toInt()
        val text = TextView(this).apply {
            setPadding(pad, pad * 2, pad, pad)
            textSize = 16f
            setTextColor(Color.parseColor("#1b2630"))
            text = """
                Salud lee de Health Connect, solo con tu permiso, categoría por categoría: actividad (pasos, kcal activas, distancia), corazón (frecuencia cardiaca y en reposo), ejercicio (sesiones), sueño y cuerpo (peso, grasa corporal y masa magra).

                Solo lee: nunca escribe ni modifica datos en Health Connect.

                Los datos se guardan únicamente en este teléfono, dentro de la app. No hay servidor, no se suben, no se comparten con terceros ni se usan para publicidad.

                Puedes excluir cualquier dato importado de las estadísticas, borrarlo desde la app, desconectar la integración o revocar los permisos en Ajustes > Health Connect.
            """.trimIndent()
        }
        setContentView(
            ScrollView(this).apply {
                setBackgroundColor(Color.WHITE)
                addView(text, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
            },
        )
    }
}
