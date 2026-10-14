package com.rpos.bridge.source

// Recovered from the owner's signed 0.7.0 APK; original Git text was unavailable.
class ExerciseReadFailure(
    val code: String,
    val userMessage: String,
    val resolution: (() -> Unit)? = null,
    cause: Throwable? = null
) : RuntimeException(code, cause)
