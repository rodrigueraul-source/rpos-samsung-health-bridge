package com.rpos.bridge.delivery

import com.rpos.bridge.source.ExerciseReadFailure

enum class AutomaticSetupStage { READ, POLICY, SCHEDULE }

/** Diagnostic codes only: never expose exception messages, credentials or workout data. */
object AutomaticSetupFailure {
    private val readCodes = setOf("exercise_read_permission_denied", "samsung_health_not_installed",
        "samsung_health_update_required", "samsung_health_disabled", "samsung_health_setup_required",
        "samsung_health_read_failed")
    private val policyCodes = setOf("not_configured", "recovery_pending", "private_storage_locked",
        "queue_storage_error", "automatic_storage_error", "automatic_baseline_too_large")

    fun code(stage: AutomaticSetupStage, error: Throwable): String = when (stage) {
        AutomaticSetupStage.READ -> (error as? ExerciseReadFailure)?.code
            ?.takeIf { it in readCodes } ?: "automatic_read_failed"
        AutomaticSetupStage.POLICY -> (error as? BridgeFailure)?.code
            ?.takeIf { it in policyCodes } ?: "automatic_policy_setup_failed"
        AutomaticSetupStage.SCHEDULE -> if (error is SecurityException)
            "automatic_schedule_permission_denied" else "automatic_schedule_failed"
    }
}
