package app.salud.personal.healthconnect

import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.activity.result.ActivityResult
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.changes.DeletionChange
import androidx.health.connect.client.changes.UpsertionChange
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.ActiveCaloriesBurnedRecord
import androidx.health.connect.client.records.BodyFatRecord
import androidx.health.connect.client.records.DistanceRecord
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.records.LeanBodyMassRecord
import androidx.health.connect.client.records.Record
import androidx.health.connect.client.records.RestingHeartRateRecord
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.records.WeightRecord
import androidx.health.connect.client.request.AggregateGroupByPeriodRequest
import androidx.health.connect.client.request.AggregateRequest
import androidx.health.connect.client.request.ChangesTokenRequest
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.PluginMethod
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.Period
import java.time.ZoneId
import java.time.ZoneOffset
import kotlin.reflect.KClass
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * Local Capacitor plugin: Health Connect, READ-ONLY. No npm dependency.
 *
 * Contract (see src/integrations/health-connect/plugin.ts):
 *  - Daily totals come from aggregate requests (Health Connect de-duplicates between apps by the person's
 *    priority list). Raw records are only read for things that are not summed (weight, body fat, lean mass,
 *    exercise sessions, sleep sessions).
 *  - Dates are local calendar dates (YYYY-MM-DD) of the device time zone.
 *  - Nothing here reads total calories, history older than 30 days or background data.
 */
@CapacitorPlugin(name = "HealthConnect")
class HealthConnectPlugin : Plugin() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val permContract = PermissionController.createRequestPermissionResultContract()

    override fun handleOnDestroy() {
        scope.cancel()
        super.handleOnDestroy()
    }

    // ───────────────────────── availability ─────────────────────────

    private fun sdkStatus(): Int =
        if (Build.VERSION.SDK_INT < 28) HealthConnectClient.SDK_UNAVAILABLE
        else HealthConnectClient.getSdkStatus(context, PROVIDER)

    private fun client(): HealthConnectClient = HealthConnectClient.getOrCreate(context)

    @PluginMethod
    fun getStatus(call: PluginCall) {
        val out = JSObject().put("sdkInt", Build.VERSION.SDK_INT)
        if (Build.VERSION.SDK_INT < 28) {
            call.resolve(out.put("available", false).put("reason", "android-version"))
            return
        }
        when (sdkStatus()) {
            HealthConnectClient.SDK_AVAILABLE -> out.put("available", true)
            HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED -> out.put("available", false).put("reason", "update-required")
            // Android 9-13 without the app: it can be installed. Android 14+: nothing to install.
            else -> out.put("available", false).put("reason", if (Build.VERSION.SDK_INT < 34) "not-installed" else "unknown")
        }
        call.resolve(out)
    }

    @PluginMethod
    fun openInstallOrUpdate(call: PluginCall) {
        try {
            val uri = "market://details?id=$PROVIDER&url=healthconnect%3A%2F%2Fonboarding"
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setPackage("com.android.vending")
                data = Uri.parse(uri)
                putExtra("overlay", true)
                putExtra("callerId", context.packageName)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(intent)
            call.resolve()
        } catch (e: Exception) {
            call.reject("No se pudo abrir Google Play.", "HC_INTERNAL", e)
        }
    }

    @PluginMethod
    fun openSettings(call: PluginCall) {
        try {
            val intent = Intent(HealthConnectClient.ACTION_HEALTH_CONNECT_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
            call.resolve()
        } catch (e: Exception) {
            call.reject("No se pudo abrir Health Connect.", "HC_UNAVAILABLE", e)
        }
    }

    // ───────────────────────── permissions ─────────────────────────

    @PluginMethod
    fun getGrantedPermissions(call: PluginCall) = withHc(call) {
        val granted = client().permissionController.getGrantedPermissions().filter { it in ALLOWED_PERMISSIONS }
        call.resolve(JSObject().put("granted", JSArray(granted)))
    }

    @PluginMethod
    fun requestReadPermissions(call: PluginCall) {
        if (sdkStatus() != HealthConnectClient.SDK_AVAILABLE) {
            call.reject("Health Connect no está disponible.", "HC_UNAVAILABLE")
            return
        }
        val requested = stringList(call, "permissions")
        if (requested.isEmpty() || requested.any { it !in ALLOWED_PERMISSIONS }) {
            call.reject("Permisos no permitidos.", "HC_BAD_REQUEST")
            return
        }
        try {
            val intent = permContract.createIntent(context, requested.toSet())
            startActivityForResult(call, intent, "onPermissionsResult")
        } catch (e: Exception) {
            call.reject("No se pudo abrir la pantalla de permisos.", "HC_INTERNAL", e)
        }
    }

    @ActivityCallback
    private fun onPermissionsResult(call: PluginCall?, result: ActivityResult) {
        if (call == null) return
        try {
            val granted = permContract.parseResult(result.resultCode, result.data).filter { it in ALLOWED_PERMISSIONS }
            call.resolve(JSObject().put("granted", JSArray(granted)))
        } catch (e: Exception) {
            call.reject("Respuesta de permisos no válida.", "HC_INTERNAL", e)
        }
    }

    @PluginMethod
    fun revokeAll(call: PluginCall) = withHc(call) {
        client().permissionController.revokeAllPermissions()
        call.resolve()
    }

    // ───────────────────────── daily aggregates ─────────────────────────

    /** {from, to: 'YYYY-MM-DD', metrics: ['steps'|'activeKcal'|'distanceM'|'restingHr'|'heartRateAvg']} */
    @PluginMethod
    fun readDailyAggregates(call: PluginCall) = withHc(call) {
        val from = LocalDate.parse(call.getString("from") ?: throw IllegalArgumentException("from"))
        val to = LocalDate.parse(call.getString("to") ?: throw IllegalArgumentException("to"))
        val metrics = stringList(call, "metrics").filter { it in DAILY_METRICS }
        val days = LinkedHashMap<String, JSObject>()
        val skipped = JSArray()
        val client = client()
        val range = TimeRangeFilter.between(from.atStartOfDay(), to.plusDays(1).atStartOfDay())
        for (metric in metrics) {
            try {
                val request = when (metric) {
                    "steps" -> setOf(StepsRecord.COUNT_TOTAL)
                    "activeKcal" -> setOf(ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL)
                    "distanceM" -> setOf(DistanceRecord.DISTANCE_TOTAL)
                    "restingHr" -> setOf(RestingHeartRateRecord.BPM_AVG)
                    else -> setOf(HeartRateRecord.BPM_AVG)
                }
                val buckets = client.aggregateGroupByPeriod(AggregateGroupByPeriodRequest(request, range, Period.ofDays(1)))
                for (b in buckets) {
                    val value: Double? = when (metric) {
                        "steps" -> b.result[StepsRecord.COUNT_TOTAL]?.toDouble()
                        "activeKcal" -> b.result[ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL]?.inKilocalories
                        "distanceM" -> b.result[DistanceRecord.DISTANCE_TOTAL]?.inMeters
                        "restingHr" -> b.result[RestingHeartRateRecord.BPM_AVG]?.toDouble()
                        else -> b.result[HeartRateRecord.BPM_AVG]?.toDouble()
                    }
                    if (value == null) continue
                    val date = b.startTime.toLocalDate().toString()
                    val day = days.getOrPut(date) { JSObject().put("date", date).put("values", JSObject()).put("origins", JSObject()) }
                    day.getJSONObject("values").put(metric, value)
                    day.getJSONObject("origins").put(metric, JSArray(b.result.dataOrigins.map { it.packageName }))
                }
            } catch (e: SecurityException) {
                skipped.put(metric) // permission not granted for this metric: skip it, keep the rest
            }
        }
        val arr = JSArray()
        days.values.forEach { arr.put(it) }
        call.resolve(JSObject().put("days", arr).put("skipped", skipped))
    }

    // ───────────────────────── raw records ─────────────────────────

    /** {type, from, to, pageToken?}: one page (200) of raw records. */
    @PluginMethod
    fun readRecords(call: PluginCall) = withHc(call) {
        val type = call.getString("type") ?: throw IllegalArgumentException("type")
        val cls = RAW_TYPES[type] ?: throw IllegalArgumentException("tipo no permitido")
        val from = LocalDate.parse(call.getString("from") ?: throw IllegalArgumentException("from"))
        val to = LocalDate.parse(call.getString("to") ?: throw IllegalArgumentException("to"))
        val token = call.getString("pageToken")?.takeIf { it.isNotEmpty() }
        val client = client()
        val response = client.readRecords(
            ReadRecordsRequest(
                recordType = cls,
                timeRangeFilter = TimeRangeFilter.between(from.atStartOfDay(), to.plusDays(1).atStartOfDay()),
                pageSize = 200,
                pageToken = token,
            ),
        )
        val out = JSArray()
        for (r in response.records) out.put(toJs(client, r))
        val next = response.pageToken
        val o = JSObject().put("records", out)
        if (!next.isNullOrEmpty()) o.put("pageToken", next)
        call.resolve(o)
    }

    // ───────────────────────── changes ─────────────────────────

    @PluginMethod
    fun getChangesToken(call: PluginCall) = withHc(call) {
        val type = call.getString("type") ?: throw IllegalArgumentException("type")
        val cls = RAW_TYPES[type] ?: throw IllegalArgumentException("tipo no permitido")
        val token = client().getChangesToken(ChangesTokenRequest(recordTypes = setOf(cls)))
        call.resolve(JSObject().put("token", token))
    }

    @PluginMethod
    fun getChanges(call: PluginCall) = withHc(call) {
        val token = call.getString("token") ?: throw IllegalArgumentException("token")
        val client = client()
        val response = client.getChanges(token)
        val out = JSObject()
        if (response.changesTokenExpired) {
            out.put("expired", true).put("upserts", JSArray()).put("deletedIds", JSArray()).put("hasMore", false).put("nextToken", token)
        } else {
            val ups = JSArray()
            val dels = JSArray()
            for (c in response.changes) {
                when (c) {
                    is UpsertionChange -> if (c.record.metadata.dataOrigin.packageName != context.packageName) ups.put(toJs(client, c.record))
                    is DeletionChange -> dels.put(c.recordId)
                    else -> Unit
                }
            }
            out.put("expired", false).put("upserts", ups).put("deletedIds", dels)
                .put("hasMore", response.hasMore).put("nextToken", response.nextChangesToken)
        }
        call.resolve(out)
    }

    // ───────────────────────── record mapping ─────────────────────────

    private suspend fun toJs(client: HealthConnectClient, r: Record): JSObject {
        val m = r.metadata
        val o = JSObject()
            .put("id", m.id)
            .put("lastModified", m.lastModifiedTime.toString())
            .put("origin", m.dataOrigin.packageName)
            .put("recordingMethod", recordingMethod(m.recordingMethod))
        m.clientRecordId?.let { o.put("clientRecordId", it) }
        m.device?.let { d ->
            o.put("deviceType", deviceType(d.type))
            d.manufacturer?.let { v -> o.put("deviceManufacturer", v) }
            d.model?.let { v -> o.put("deviceModel", v) }
        }
        when (r) {
            is WeightRecord -> instant(o, "Weight", r.time, r.zoneOffset).put("value", r.weight.inKilograms).put("unit", "kg")
            is BodyFatRecord -> instant(o, "BodyFat", r.time, r.zoneOffset).put("value", r.percentage.value).put("unit", "%")
            is LeanBodyMassRecord -> instant(o, "LeanBodyMass", r.time, r.zoneOffset).put("value", r.mass.inKilograms).put("unit", "kg")
            is ExerciseSessionRecord -> {
                interval(o, "ExerciseSession", r.startTime, r.endTime, r.startZoneOffset, r.endZoneOffset, useEnd = false)
                o.put("value", Duration.between(r.startTime, r.endTime).toMinutes()).put("unit", "min")
                o.put("exerciseKey", exerciseKey(r.exerciseType))
                r.title?.let { o.put("title", it) }
                // Display-only extras for this session, from the same app (never added to daily totals).
                val origin = setOf(r.metadata.dataOrigin)
                val detail = JSObject()
                try {
                    val agg = client.aggregate(
                        AggregateRequest(
                            metrics = setOf(ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL, DistanceRecord.DISTANCE_TOTAL),
                            timeRangeFilter = TimeRangeFilter.between(r.startTime, r.endTime),
                            dataOriginFilter = origin,
                        ),
                    )
                    agg[ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL]?.let { detail.put("activeKcal", it.inKilocalories) }
                    agg[DistanceRecord.DISTANCE_TOTAL]?.let { detail.put("distanceM", it.inMeters) }
                } catch (_: SecurityException) {
                    // permission for kcal/distance not granted: no extras
                }
                o.put("detail", detail)
            }
            is SleepSessionRecord -> {
                interval(o, "SleepSession", r.startTime, r.endTime, r.startZoneOffset, r.endZoneOffset, useEnd = true)
                val inBed = Duration.between(r.startTime, r.endTime).toMinutes()
                var asleep = 0L; var awake = 0L; var light = 0L; var deep = 0L; var rem = 0L
                for (s in r.stages) {
                    val min = Duration.between(s.startTime, s.endTime).toMinutes()
                    when (s.stage) {
                        SleepSessionRecord.STAGE_TYPE_AWAKE, SleepSessionRecord.STAGE_TYPE_AWAKE_IN_BED,
                        SleepSessionRecord.STAGE_TYPE_OUT_OF_BED -> awake += min
                        SleepSessionRecord.STAGE_TYPE_LIGHT -> { light += min; asleep += min }
                        SleepSessionRecord.STAGE_TYPE_DEEP -> { deep += min; asleep += min }
                        SleepSessionRecord.STAGE_TYPE_REM -> { rem += min; asleep += min }
                        else -> asleep += min // SLEEPING / UNKNOWN
                    }
                }
                o.put("value", if (r.stages.isEmpty()) inBed else asleep).put("unit", "min")
                r.title?.let { o.put("title", it) }
                val detail = JSObject().put("inBedMin", inBed)
                if (r.stages.isNotEmpty()) detail.put("awakeMin", awake).put("lightMin", light).put("deepMin", deep).put("remMin", rem)
                o.put("detail", detail)
            }
            else -> throw IllegalArgumentException("tipo no permitido")
        }
        return o
    }

    private fun instant(o: JSObject, type: String, time: Instant, offset: ZoneOffset?): JSObject {
        val zone = offset ?: ZoneId.systemDefault().rules.getOffset(time)
        return o.put("type", type).put("start", time.toString()).put("date", time.atOffset(zone).toLocalDate().toString())
    }

    private fun interval(o: JSObject, type: String, start: Instant, end: Instant, so: ZoneOffset?, eo: ZoneOffset?, useEnd: Boolean) {
        val ref = if (useEnd) end else start
        val zone = (if (useEnd) eo else so) ?: ZoneId.systemDefault().rules.getOffset(ref)
        o.put("type", type).put("start", start.toString()).put("end", end.toString())
            .put("date", ref.atOffset(zone).toLocalDate().toString())
    }

    private fun exerciseKey(t: Int): String = when (t) {
        ExerciseSessionRecord.EXERCISE_TYPE_RUNNING -> "running"
        ExerciseSessionRecord.EXERCISE_TYPE_RUNNING_TREADMILL -> "running_treadmill"
        ExerciseSessionRecord.EXERCISE_TYPE_WALKING -> "walking"
        ExerciseSessionRecord.EXERCISE_TYPE_BIKING -> "biking"
        ExerciseSessionRecord.EXERCISE_TYPE_BIKING_STATIONARY -> "biking_stationary"
        ExerciseSessionRecord.EXERCISE_TYPE_HIKING -> "hiking"
        ExerciseSessionRecord.EXERCISE_TYPE_STRENGTH_TRAINING -> "strength_training"
        ExerciseSessionRecord.EXERCISE_TYPE_WEIGHTLIFTING -> "weightlifting"
        ExerciseSessionRecord.EXERCISE_TYPE_HIGH_INTENSITY_INTERVAL_TRAINING -> "hiit"
        ExerciseSessionRecord.EXERCISE_TYPE_SWIMMING_POOL -> "swimming_pool"
        ExerciseSessionRecord.EXERCISE_TYPE_SWIMMING_OPEN_WATER -> "swimming_open_water"
        ExerciseSessionRecord.EXERCISE_TYPE_YOGA -> "yoga"
        ExerciseSessionRecord.EXERCISE_TYPE_ELLIPTICAL -> "elliptical"
        ExerciseSessionRecord.EXERCISE_TYPE_ROWING -> "rowing"
        ExerciseSessionRecord.EXERCISE_TYPE_ROWING_MACHINE -> "rowing_machine"
        else -> "other"
    }

    private fun recordingMethod(v: Int): String = when (v) {
        1 -> "active"
        2 -> "automatic"
        3 -> "manual"
        else -> "unknown"
    }

    private fun deviceType(v: Int): String = when (v) {
        1 -> "watch"
        2 -> "phone"
        3 -> "scale"
        4 -> "ring"
        5 -> "head-mounted"
        6 -> "fitness-band"
        7 -> "chest-strap"
        8 -> "smart-display"
        else -> "unknown"
    }

    // ───────────────────────── helpers ─────────────────────────

    private fun stringList(call: PluginCall, key: String): List<String> {
        val arr = call.getArray(key) ?: return emptyList()
        return (0 until arr.length()).mapNotNull { arr.optString(it).takeIf { s -> s.isNotEmpty() } }
    }

    /** Runs a suspend body on the plugin scope and maps exceptions to stable error codes. */
    private fun withHc(call: PluginCall, body: suspend () -> Unit) {
        scope.launch {
            try {
                if (sdkStatus() != HealthConnectClient.SDK_AVAILABLE) {
                    call.reject("Health Connect no está disponible.", "HC_UNAVAILABLE")
                    return@launch
                }
                body()
            } catch (e: CancellationException) {
                throw e
            } catch (e: SecurityException) {
                call.reject("Falta permiso de Health Connect.", "HC_PERMISSION_DENIED", e)
            } catch (e: IllegalArgumentException) {
                call.reject("Petición no válida.", "HC_BAD_REQUEST", e)
            } catch (e: IllegalStateException) {
                // Quota exceeded or service not reachable.
                call.reject("Health Connect no respondió (límite o servicio no disponible).", "HC_RATE_LIMITED", e)
            } catch (e: Exception) {
                call.reject("Error de Health Connect.", "HC_INTERNAL", e)
            }
        }
    }

    companion object {
        const val PROVIDER = "com.google.android.apps.healthdata"

        val DAILY_METRICS = setOf("steps", "activeKcal", "distanceM", "restingHr", "heartRateAvg")

        val RAW_TYPES: Map<String, KClass<out Record>> = mapOf(
            "ExerciseSession" to ExerciseSessionRecord::class,
            "SleepSession" to SleepSessionRecord::class,
            "Weight" to WeightRecord::class,
            "BodyFat" to BodyFatRecord::class,
            "LeanBodyMass" to LeanBodyMassRecord::class,
        )

        /** Read-only whitelist; same set as the manifest. */
        val ALLOWED_PERMISSIONS: Set<String> = setOf(
            HealthPermission.getReadPermission(StepsRecord::class),
            HealthPermission.getReadPermission(ActiveCaloriesBurnedRecord::class),
            HealthPermission.getReadPermission(DistanceRecord::class),
            HealthPermission.getReadPermission(HeartRateRecord::class),
            HealthPermission.getReadPermission(RestingHeartRateRecord::class),
            HealthPermission.getReadPermission(ExerciseSessionRecord::class),
            HealthPermission.getReadPermission(SleepSessionRecord::class),
            HealthPermission.getReadPermission(WeightRecord::class),
            HealthPermission.getReadPermission(BodyFatRecord::class),
            HealthPermission.getReadPermission(LeanBodyMassRecord::class),
        )
    }
}
