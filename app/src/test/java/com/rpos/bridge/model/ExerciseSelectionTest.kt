package com.rpos.bridge.model

import com.google.gson.JsonParser
import org.junit.Assert.*
import org.junit.Test

class ExerciseSelectionTest {
    private fun record(uid: String) = RposExercise(
        uid, "2026-01-01T12:00:00Z", null, null, null, null, "OTHER", null, null, null
    )

    @Test fun selectingAnotherRecordExportsItsUidWithTheSameReadEnvelope() {
        val batch = ExerciseSelection(listOf(record("fixture-a"), record("fixture-b")),
            "samsung_health", "2026-01-02T00:00:00Z")
        batch.select(1)
        val json = JsonParser.parseString(batch.toJson()).asJsonObject
        assertEquals("fixture-b", json["record"].asJsonObject["uid"].asString)
        assertEquals(2, json["read_record_count"].asInt)
        assertEquals("2026-01-02T00:00:00Z", json["read_at"].asString)
        assertEquals("samsung_health", json["source"].asString)
    }

    @Test fun aFreshEmptyReadCannotExportThePreviousSelection() {
        val old = ExerciseSelection(listOf(record("fixture-a")), "mock", "old-read")
        assertNotNull(old.toJson())
        val fresh = ExerciseSelection(emptyList(), "samsung_health", "fresh-read")
        assertNull(fresh.toJson())
        assertEquals(-1, fresh.selectedIndex)
    }

    @Test fun duplicateOrMissingUidsAndOutOfRangeSelectionsAreRejected() {
        for (records in listOf(listOf(record("")), listOf(record("a"), record("a")))) {
            try {
                ExerciseSelection(records, "mock", "read")
                fail("Invalid UIDs accepted")
            } catch (_: IllegalArgumentException) { }
        }
        val batch = ExerciseSelection(listOf(record("a")), "mock", "read")
        try {
            batch.select(1)
            fail("Invalid selection accepted")
        } catch (_: IllegalArgumentException) { }
        assertEquals("a", batch.selectedRecord?.sourceRecordId)
    }
}
