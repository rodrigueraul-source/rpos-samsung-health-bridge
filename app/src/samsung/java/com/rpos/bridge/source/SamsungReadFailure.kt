package com.rpos.bridge.source

import com.samsung.android.sdk.health.data.error.HealthDataException
import com.samsung.android.sdk.health.data.error.ResolvablePlatformException

// Codes/messages and resolution gating verified against the signed 0.7.0 APK.
internal fun samsungReadFailure(
    error: HealthDataException,
    resolution: (() -> Unit)? = null
): ExerciseReadFailure {
    val (code, message) = when (error.errorCode) {
        3000 -> "samsung_health_not_installed" to
            "Install Samsung Health, finish its setup, then tap READ EXERCISE again."
        3001 -> "samsung_health_update_required" to
            "Update Samsung Health to a supported version, then tap READ EXERCISE again."
        3002 -> "samsung_health_disabled" to
            "Enable Samsung Health in Android settings, then tap READ EXERCISE again."
        3003 -> "samsung_health_setup_required" to
            "Open Samsung Health and finish its setup, then tap READ EXERCISE again."
        else -> "samsung_health_read_failed" to
            "Unable to read Samsung Health. Check the app and Exercise READ access, then tap READ EXERCISE again."
    }
    val action = resolution.takeIf {
        error is ResolvablePlatformException && error.hasResolution
    }
    return ExerciseReadFailure(code, message, action, error)
}
