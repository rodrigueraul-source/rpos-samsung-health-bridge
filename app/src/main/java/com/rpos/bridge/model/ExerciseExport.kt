package com.rpos.bridge.model

import com.google.gson.GsonBuilder

/** Explicit reconciliation fields; never reflect/serialize the proprietary SDK object. */
object ExerciseExport {
    fun toJson(record: RposExercise, source: String, readAt: String, readCount: Int): String {
        require(source == "samsung_health" || source == "mock")
        require(record.sourceRecordId.isNotBlank() && readCount > 0)
        val payload = linkedMapOf(
            "uid" to record.sourceRecordId,
            "start_time" to record.startTime,
            "end_time" to record.endTime,
            "zone_offset" to record.zoneOffset,
            "update_time" to record.updateTime,
            "source_app_id" to record.sourceAppId,
            "source_device_id" to record.sourceDeviceId,
            "client_data_id" to record.clientDataId,
            "client_version" to record.clientVersion,
            "exercise_type" to record.exerciseType,
            "custom_title" to record.customTitle,
            // Parent totals are not inferred from elapsed time or session sums.
            "duration_seconds" to record.durationSeconds,
            "calories_kcal" to record.caloriesKcal,
            "distance_meters" to record.distanceMeters,
            "sessions" to record.sessions?.map { session ->
                linkedMapOf(
                    "start_time" to session.startTime,
                    "end_time" to session.endTime,
                    "exercise_type" to session.exerciseType,
                    "duration_millis" to session.durationMillis,
                    "calories_kcal" to session.caloriesKcal,
                    "distance_meters" to session.distanceMeters,
                    "mean_heart_rate_bpm" to session.meanHeartRateBpm,
                    "max_heart_rate_bpm" to session.maxHeartRateBpm,
                    "min_heart_rate_bpm" to session.minHeartRateBpm,
                    "custom_title" to session.customTitle
                )
            }
        )
        return GsonBuilder().serializeNulls().setPrettyPrinting().create().toJson(
            linkedMapOf(
                "schema_version" to "rpos.exercise.export.v1",
                "source" to source,
                "sdk_version" to if (source == "samsung_health") "1.1.0" else null,
                "read_at" to readAt,
                "read_record_count" to readCount,
                "record" to payload
            )
        )
    }
}
