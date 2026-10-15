package com.rpos.bridge.delivery

import com.rpos.bridge.source.ExerciseReadFailure
import org.junit.Assert.assertEquals
import org.junit.Test

class AutomaticSetupFailureTest {
    @Test fun androidNetworkPermissionFailureIdentifiesSchedulingStage() {
        assertEquals("automatic_schedule_permission_denied", AutomaticSetupFailure.code(
            AutomaticSetupStage.SCHEDULE, SecurityException("synthetic private exception")))
    }

    @Test fun samsungReadPermissionFailureRetainsItsActionableCode() {
        assertEquals("exercise_read_permission_denied", AutomaticSetupFailure.code(
            AutomaticSetupStage.READ, ExerciseReadFailure("exercise_read_permission_denied", "synthetic")))
    }

    @Test fun policyFailureKeepsStorageAndRecoveryDistinguishable() {
        for (code in listOf("not_configured", "recovery_pending", "private_storage_locked",
            "queue_storage_error", "automatic_storage_error", "automatic_baseline_too_large")) {
            assertEquals(code, AutomaticSetupFailure.code(AutomaticSetupStage.POLICY, BridgeFailure(code)))
        }
    }

    @Test fun arbitraryMessagesAndCodesAreNeverExposed() {
        val secret = "synthetic credential and workout contents"
        assertEquals("automatic_read_failed", AutomaticSetupFailure.code(
            AutomaticSetupStage.READ, ExerciseReadFailure(secret, secret)))
        assertEquals("automatic_policy_setup_failed", AutomaticSetupFailure.code(
            AutomaticSetupStage.POLICY, BridgeFailure(secret)))
        assertEquals("automatic_schedule_failed", AutomaticSetupFailure.code(
            AutomaticSetupStage.SCHEDULE, IllegalStateException(secret)))
    }

    @Test fun securityExceptionDoesNotMislabelOtherSetupStages() {
        val error = SecurityException("synthetic")
        assertEquals("automatic_read_failed", AutomaticSetupFailure.code(AutomaticSetupStage.READ, error))
        assertEquals("automatic_policy_setup_failed", AutomaticSetupFailure.code(AutomaticSetupStage.POLICY, error))
    }

    @Test fun sdkSetupFailureIsDistinctFromJobScheduling() {
        assertEquals("samsung_health_setup_required", AutomaticSetupFailure.code(AutomaticSetupStage.READ,
            ExerciseReadFailure("samsung_health_setup_required", "synthetic")))
        assertEquals("automatic_schedule_failed", AutomaticSetupFailure.code(AutomaticSetupStage.SCHEDULE,
            BridgeFailure("automatic_schedule_failed")))
    }
}
