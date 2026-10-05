package com.rpos.bridge.source

import android.app.Activity
import com.rpos.bridge.model.RposExercise
import com.samsung.android.sdk.health.data.HealthDataService
import com.samsung.android.sdk.health.data.permission.AccessType
import com.samsung.android.sdk.health.data.permission.Permission
import com.samsung.android.sdk.health.data.request.DataType
import com.samsung.android.sdk.health.data.request.DataTypes
import com.samsung.android.sdk.health.data.request.LocalTimeFilter
import java.time.LocalDateTime

object ExerciseReaderProvider {
    fun create(activity: Activity): ExerciseReader = SamsungExerciseReader(activity)
}

private class SamsungExerciseReader(
    private val activity: Activity
) : ExerciseReader {

    override suspend fun readRecentExercises(days: Long): List<RposExercise> {
        require(days in 1..365) { "days must be between 1 and 365" }

        val store = HealthDataService.getStore(activity.applicationContext)
        val exerciseRead = Permission.of(DataTypes.EXERCISE, AccessType.READ)
        val requiredPermissions = setOf(exerciseRead)

        var granted = store.getGrantedPermissions(requiredPermissions)
        if (!granted.containsAll(requiredPermissions)) {
            granted = store.requestPermissions(requiredPermissions, activity)
        }
        if (!granted.containsAll(requiredPermissions)) {
            error("Samsung Health Exercise READ permission was not granted")
        }

        val endTime = LocalDateTime.now()
        val startTime = endTime.minusDays(days)
        val request = DataTypes.EXERCISE.readDataRequestBuilder
            .setLocalTimeFilter(LocalTimeFilter.of(startTime, endTime))
            .build()

        return store.readData(request).dataList
            .sortedByDescending { it.startTime }
            .map { point ->
                RposExercise(
                    sourceRecordId = point.uid,
                    startTime = point.startTime.toString(),
                    endTime = point.endTime.toString(),
                    zoneOffset = point.zoneOffset.toString(),
                    sourceAppId = point.dataSource?.appId,
                    sourceDeviceId = point.dataSource?.deviceId,
                    exerciseType = point.getValue(DataType.ExerciseType.EXERCISE_TYPE).toString(),
                    durationSeconds = null,
                    caloriesKcal = null,
                    distanceMeters = null
                )
            }
    }
}
