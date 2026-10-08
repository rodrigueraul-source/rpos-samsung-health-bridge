package com.rpos.bridge.model

data class RposExercise(
    val sourceRecordId: String,
    val startTime: String,
    val endTime: String?,
    val zoneOffset: String?,
    val sourceAppId: String?,
    val sourceDeviceId: String?,
    val exerciseType: String,
    val durationSeconds: Long?,
    val caloriesKcal: Double?,
    val distanceMeters: Double?,
    val updateTime: String? = null,
    val clientDataId: String? = null,
    val clientVersion: Int? = null,
    val customTitle: String? = null,
    val sessions: List<RposExerciseSession>? = null
)

data class RposExerciseSession(
    val startTime: String,
    val endTime: String,
    val exerciseType: String,
    val durationMillis: Long,
    val caloriesKcal: Double,
    val distanceMeters: Double?,
    val meanHeartRateBpm: Double?,
    val maxHeartRateBpm: Double?,
    val minHeartRateBpm: Double?,
    val customTitle: String?
)
