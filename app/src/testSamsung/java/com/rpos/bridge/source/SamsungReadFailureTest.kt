package com.rpos.bridge.source

import com.samsung.android.sdk.health.data.error.HealthDataException
import com.samsung.android.sdk.health.data.error.ResolvablePlatformException
import org.junit.Assert.*
import org.junit.Test

class SamsungReadFailureTest {
    private fun checkCode(code: Int, expected: String, instruction: String) {
        val original = HealthDataException(code, "private provider detail")
        val failure = samsungReadFailure(original)
        assertEquals(expected, failure.code)
        assertTrue(failure.userMessage.startsWith(instruction))
        assertFalse(failure.userMessage.contains("private provider detail"))
        assertSame(original, failure.cause)
        assertNull(failure.resolution)
    }

    @Test fun missingHealthHasInstallInstruction() =
        checkCode(3000, "samsung_health_not_installed", "Install Samsung Health")

    @Test fun oldHealthHasUpdateInstruction() =
        checkCode(3001, "samsung_health_update_required", "Update Samsung Health")

    @Test fun disabledHealthHasEnableInstruction() =
        checkCode(3002, "samsung_health_disabled", "Enable Samsung Health")

    @Test fun unfinishedHealthHasSetupInstruction() =
        checkCode(3003, "samsung_health_setup_required", "Open Samsung Health")

    @Test fun unknownFailureRedactsProviderDetail() =
        checkCode(9999, "samsung_health_read_failed", "Unable to read Samsung Health")

    @Test fun nonResolvableFailureCannotRunInjectedResolution() {
        var calls = 0
        val failure = samsungReadFailure(HealthDataException(3000, "private")) { calls++ }
        assertEquals(0, calls)
        assertNull(failure.resolution)
    }

    @Test fun resolutionIsDiscardedWhenProviderSaysUnavailable() {
        var calls = 0
        val failure = samsungReadFailure(ResolvablePlatformException(3003, "private", false)) { calls++ }
        assertEquals(0, calls)
        assertNull(failure.resolution)
    }

    @Test fun availableResolutionWaitsForExplicitAction() {
        var calls = 0
        val failure = samsungReadFailure(ResolvablePlatformException(3003, "private", true)) { calls++ }
        assertEquals(0, calls)
        assertNotNull(failure.resolution)
        failure.resolution!!.invoke()
        assertEquals(1, calls)
    }
}
