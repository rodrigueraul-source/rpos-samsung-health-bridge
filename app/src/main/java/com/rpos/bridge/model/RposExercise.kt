package com.rpos.bridge.model

data class RposExercise(
    val sourceRecordId: String,
    val startTime: String,
    val endTime: String,
    val zoneOffset: String?,
    val sourceAppId: String?,
    val sourceDeviceId: String?,
    val exerciseType: String,
    val durationSeconds: Long?,
    val caloriesKcal: Double?,
    val distanceMeters: Double?
)
