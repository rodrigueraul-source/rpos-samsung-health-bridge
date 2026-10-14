package com.rpos.bridge.source

import android.app.Activity
import android.content.Context
import com.rpos.bridge.model.RposExercise

object ExerciseReaderProvider {
    const val SOURCE = "mock"
    fun create(activity: Activity): ExerciseReader = MockExerciseReader()
    fun createBackground(context: Context): ExerciseReader = MockExerciseReader()
}

private class MockExerciseReader : ExerciseReader {
    override suspend fun readRecentExercises(days: Long): List<RposExercise> = emptyList()
}
