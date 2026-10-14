package com.rpos.bridge.source

import android.app.Activity
import android.content.Context
import com.rpos.bridge.model.RposExercise
import com.rpos.bridge.model.RposExerciseSession
import com.samsung.android.sdk.health.data.HealthDataService
import com.samsung.android.sdk.health.data.error.HealthDataException
import com.samsung.android.sdk.health.data.error.ResolvablePlatformException
import com.samsung.android.sdk.health.data.permission.AccessType
import com.samsung.android.sdk.health.data.permission.Permission
import com.samsung.android.sdk.health.data.request.DataType
import com.samsung.android.sdk.health.data.request.DataTypes
import com.samsung.android.sdk.health.data.request.LocalTimeFilter
import java.time.LocalDateTime

object ExerciseReaderProvider {
    const val SOURCE = "samsung_health"
    fun create(activity: Activity): ExerciseReader = SamsungExerciseReader(activity.applicationContext, activity)
    fun createBackground(context: Context): ExerciseReader = SamsungExerciseReader(context.applicationContext, null)
}

private class SamsungExerciseReader(
    private val context: Context,
    private val activity: Activity?
) : ExerciseReader {

    override suspend fun readRecentExercises(days: Long): List<RposExercise> {
        require(days in 1..365) { "days must be between 1 and 365" }
        return try {
            readExercises(days)
        } catch (error: HealthDataException) {
            val resolution: (() -> Unit)? = if (
                activity != null && error is ResolvablePlatformException && error.hasResolution
            ) {
                { error.resolve(activity) }
            } else null
            throw samsungReadFailure(error, resolution)
        }
    }

    private suspend fun readExercises(days: Long): List<RposExercise> {
        val store = HealthDataService.getStore(context)
        val exerciseRead = Permission.of(DataTypes.EXERCISE, AccessType.READ)
        val requiredPermissions = setOf(exerciseRead)

        var granted = store.getGrantedPermissions(requiredPermissions)
        if (!granted.containsAll(requiredPermissions) && activity != null) {
            granted = store.requestPermissions(requiredPermissions, activity)
        }
        if (!granted.containsAll(requiredPermissions)) {
            throw ExerciseReadFailure(
                "exercise_read_permission_denied",
                "Exercise READ access was not granted. Tap READ EXERCISE again and grant Exercise access in Samsung Health."
            )
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
                    endTime = point.endTime?.toString(),
                    zoneOffset = point.zoneOffset?.toString(),
                    sourceAppId = point.dataSource?.appId,
                    sourceDeviceId = point.dataSource?.deviceId,
                    exerciseType = point.getValue(DataType.ExerciseType.EXERCISE_TYPE).toString(),
                    durationSeconds = null,
                    caloriesKcal = null,
                    distanceMeters = null,
                    updateTime = point.updateTime?.toString(),
                    clientDataId = point.clientDataId,
                    clientVersion = point.clientVersion,
                    customTitle = point.getValue(DataType.ExerciseType.CUSTOM_TITLE),
                    sessions = point.getValue(DataType.ExerciseType.SESSIONS)?.map { session ->
                        RposExerciseSession(
                            startTime = session.startTime.toString(),
                            endTime = session.endTime.toString(),
                            exerciseType = session.exerciseType.toString(),
                            durationMillis = session.duration.toMillis(),
                            caloriesKcal = session.calories.toDouble(),
                            distanceMeters = session.distance?.toDouble(),
                            meanHeartRateBpm = session.meanHeartRate?.toDouble(),
                            maxHeartRateBpm = session.maxHeartRate?.toDouble(),
                            minHeartRateBpm = session.minHeartRate?.toDouble(),
                            customTitle = session.customTitle
                        )
                    }
                )
            }
    }
}
