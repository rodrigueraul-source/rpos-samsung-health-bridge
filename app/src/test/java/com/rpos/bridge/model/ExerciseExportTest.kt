package com.rpos.bridge.model

import com.google.gson.JsonParser
import org.junit.Assert.*
import org.junit.Test

class ExerciseExportTest {
    private val record = RposExercise(
        "synthetic-uid", "2026-01-01T12:00:00Z", "2026-01-01T12:10:00Z",
        "-06:00", "synthetic.app", null, "OTHER", null, null, null,
        sessions = listOf(RposExerciseSession(
            "2026-01-01T12:00:00Z", "2026-01-01T12:10:00Z", "WALKING",
            480123L, 42.5, 500.0, null, 120.0, null, null
        ))
    )

    @Test fun preservesUidSessionUnitsAndUnknowns() {
        val export = JsonParser.parseString(ExerciseExport.toJson(
            record, "samsung_health", "2026-01-02T00:00:00Z", 2
        )).asJsonObject
        assertEquals("rpos.exercise.export.v1", export["schema_version"].asString)
        assertEquals("samsung_health", export["source"].asString)
        assertEquals("1.1.0", export["sdk_version"].asString)
        assertEquals(2, export["read_record_count"].asInt)
        val payload = export["record"].asJsonObject
        assertEquals("synthetic-uid", payload["uid"].asString)
        assertTrue(payload["source_device_id"].isJsonNull)
        assertTrue(payload["duration_seconds"].isJsonNull)
        assertTrue(payload["calories_kcal"].isJsonNull)
        val session = payload["sessions"].asJsonArray[0].asJsonObject
        assertEquals(480123L, session["duration_millis"].asLong)
        assertEquals(42.5, session["calories_kcal"].asDouble, 0.0)
        assertTrue(session["mean_heart_rate_bpm"].isJsonNull)
    }

    @Test fun mockNeverClaimsSamsungProvenance() {
        val export = JsonParser.parseString(ExerciseExport.toJson(
            record, "mock", "2026-01-02T00:00:00Z", 1
        )).asJsonObject
        assertEquals("mock", export["source"].asString)
        assertTrue(export["sdk_version"].isJsonNull)
    }
}
