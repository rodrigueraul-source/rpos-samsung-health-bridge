package com.rpos.bridge.delivery

import com.rpos.bridge.model.RposExercise
import com.rpos.bridge.model.RposExerciseSession
import org.junit.Assert.*
import org.junit.Test
import java.time.Instant

class AutomaticAcquisitionTest {
    private val cut = Instant.parse("2026-01-02T00:00:00Z")
    private fun record(uid: String, start: String = "2026-01-02T00:01:00Z",
                       end: String? = "2026-01-02T00:05:00Z") = RposExercise(
        uid, start, end, "-06:00", "synthetic", "synthetic", "POOL_SWIMMING", null, null, null,
        sessions = listOf(RposExerciseSession(start, end ?: start, "POOL_SWIMMING", 220000,
            29.123456789, 250.0, null, null, null, null)))

    @Test fun baselineAndHistoryNeverUpload() {
        val old = record("old", "2026-01-01T00:01:00Z", "2026-01-01T00:05:00Z")
        val p = AutomaticAcquisition.baseline(listOf(old), cut)
        assertTrue(AutomaticAcquisition.payloads(p, listOf(old), cut.plusSeconds(600)).isEmpty())
        assertTrue(AutomaticAcquisition.payloads(p, listOf(old.copy(sourceRecordId = "late-history")), cut.plusSeconds(600)).isEmpty())
    }
    @Test fun freshClosedRecordKeepsNullsAndPrecision() {
        val r = record("new"); val p = AutomaticAcquisition.baseline(emptyList(), cut)
        val payload = AutomaticAcquisition.payloads(p, listOf(r), cut.plusSeconds(600)).single()
        val root = BridgeProtocol.export(payload).getAsJsonObject("record")
        assertTrue(root.get("duration_seconds").isJsonNull)
        assertTrue(root.get("calories_kcal").isJsonNull)
        assertEquals(29.123456789, root.getAsJsonArray("sessions")[0].asJsonObject.get("calories_kcal").asDouble, 0.0)
    }
    @Test fun openUnsettledAndUpdatedRecordsWait() {
        val p = AutomaticAcquisition.baseline(emptyList(), cut)
        assertTrue(AutomaticAcquisition.payloads(p, listOf(record("open", end = null)), cut.plusSeconds(600)).isEmpty())
        assertTrue(AutomaticAcquisition.payloads(p, listOf(record("recent")), cut.plusSeconds(350)).isEmpty())
        assertTrue(AutomaticAcquisition.payloads(p, listOf(record("updated").copy(updateTime = cut.plusSeconds(590).toString())), cut.plusSeconds(600)).isEmpty())
    }
    @Test fun pausedModeCannotUploadAndResumeKeepsCutover() {
        val p = AutomaticAcquisition.baseline(emptyList(), cut)
        assertTrue(AutomaticAcquisition.payloads(p.copy(enabled = false), listOf(record("new")), cut.plusSeconds(600)).isEmpty())
        assertEquals(p.startAt, p.copy(enabled = false).copy(enabled = true).startAt)
        assertEquals(1, AutomaticAcquisition.payloads(p, listOf(record("new")), cut.plusSeconds(600)).size)
    }
    @Test fun badOrDuplicateIdentityFailsBeforePayloads() {
        val p = AutomaticAcquisition.baseline(emptyList(), cut)
        assertThrows(IllegalArgumentException::class.java) { AutomaticAcquisition.payloads(p, listOf(record("x"), record("x")), cut.plusSeconds(600)) }
        assertThrows(BridgeFailure::class.java) { AutomaticAcquisition.payloads(p, listOf(record("bad", start = "invalid")), cut.plusSeconds(600)) }
    }
    @Test fun queueReplayNeverRefreshesOriginalOrSendsAnotherWorkout() {
        var entries = emptyList<QueueEntry>(); var calls = 0
        val queue = BridgeQueue(object : QueuePersistence {
            override fun load() = entries
            override fun save(value: List<QueueEntry>) { entries = value }
        }, object : BridgeTransport { override fun post(endpoint: String, body: String): String { calls++; return "{}" } }, { 1000 })
        val p = AutomaticAcquisition.baseline(emptyList(), cut); val r = record("new")
        queue.enqueue(AutomaticAcquisition.payloads(p, listOf(r), cut.plusSeconds(600)).single())
        queue.enqueue(AutomaticAcquisition.payloads(p, listOf(r), cut.plusSeconds(700)).single())
        assertEquals(1, entries.size); assertEquals(0, calls)
        assertThrows(BridgeFailure::class.java) {
            queue.enqueue(AutomaticAcquisition.payloads(p, listOf(r.copy(customTitle = "changed")), cut.plusSeconds(800)).single())
        }
        assertEquals(1, entries.size)
    }

    @Test fun changedSdkRecordDoesNotStarveExistingAcknowledgementOrNextNewRecord() {
        var entries = emptyList<QueueEntry>()
        val requests = mutableListOf<com.google.gson.JsonObject>()
        val store = object : QueuePersistence {
            override fun load() = entries
            override fun save(value: List<QueueEntry>) { entries = value }
        }
        val transport = object : BridgeTransport {
            override fun post(endpoint: String, body: String): String {
                val request = com.google.gson.JsonParser.parseString(body).asJsonObject
                requests += request
                val id = if (request.has("payload_json"))
                    BridgeProtocol.receiptId(request.get("payload_json").asString)
                else request.get("receipt_id").asString
                val hash = "b".repeat(64)
                return if (request.has("payload_json"))
                    """{"schema_version":"rpos.exercise.intake.receipt.v1","status":"staged","notion_confirmed":false,"receipt_id":"$id","record_hash":"$hash"}"""
                else """{"schema_version":"rpos.exercise.acknowledgement.receipt.v1","status":"confirmed","notion_confirmed":true,"receipt_id":"$id","record_hash":"$hash"}"""
            }
        }
        val queue = BridgeQueue(store, transport, { 1800000000L })
        val p = AutomaticAcquisition.baseline(emptyList(), cut)
        val original = record("first")
        val first = AutomaticAcquisition.payloads(p, listOf(original), cut.plusSeconds(600)).single()
        val firstId = BridgeProtocol.receiptId(first)
        entries = listOf(QueueEntry(firstId, first, "staged", "notion_pending", 1, 0, "b".repeat(64)))
        val fresh = record("next", "2026-01-02T00:06:00Z", "2026-01-02T00:09:00Z")
        val payloads = AutomaticAcquisition.payloads(p,
            listOf(original.copy(customTitle = "SDK corrected"), fresh), cut.plusSeconds(900))
        val config = BridgeConfig("https://script.google.com/macros/s/SyntheticDeployment000001/exec", "a".repeat(64))
        assertEquals("completed_with_record_changes", AutomaticAcquisition.synchronize(queue, config, payloads))
        assertEquals(2, entries.size)
        assertEquals(first, entries.first().payload)
        assertEquals("confirmed", entries.first().state)
        assertEquals("staged", entries.last().state)
        assertEquals(2, requests.size)
        assertEquals(1, requests.count { it.has("payload_json") })
        assertEquals("next", BridgeProtocol.export(requests.single { it.has("payload_json") }
            .get("payload_json").asString).getAsJsonObject("record").get("uid").asString)
        val restarted = BridgeQueue(store, transport, { 1800000000L })
        AutomaticAcquisition.synchronize(restarted, config, payloads)
        assertEquals(first, entries.first().payload)
        assertEquals(2, entries.size)
        assertEquals(2, requests.size) // Original remains confirmed, new intake respects backoff.
    }

    @Test fun storageFailureStillStopsBeforeAnyNetworkRequest() {
        var network = false
        val queue = BridgeQueue(object : QueuePersistence {
            override fun load() = emptyList<QueueEntry>()
            override fun save(value: List<QueueEntry>) { throw BridgeFailure("queue_storage_error") }
        }, object : BridgeTransport { override fun post(endpoint: String, body: String): String {
            network = true; return "{}"
        } }, { 1800000000L })
        val p = AutomaticAcquisition.baseline(emptyList(), cut)
        val config = BridgeConfig("https://script.google.com/macros/s/SyntheticDeployment000001/exec", "a".repeat(64))
        val error = assertThrows(BridgeFailure::class.java) {
            AutomaticAcquisition.synchronize(queue, config,
                AutomaticAcquisition.payloads(p, listOf(record("new")), cut.plusSeconds(600)))
        }
        assertEquals("queue_storage_error", error.code)
        assertFalse(network)
    }
}
