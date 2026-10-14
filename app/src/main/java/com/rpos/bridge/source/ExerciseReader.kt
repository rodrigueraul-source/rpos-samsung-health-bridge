package com.rpos.bridge.source

import com.rpos.bridge.model.RposExercise

interface ExerciseReader {
    suspend fun readRecentExercises(days: Long = 30): List<RposExercise>
}
