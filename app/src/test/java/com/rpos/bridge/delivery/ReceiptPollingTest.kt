package com.rpos.bridge.delivery

import com.google.gson.JsonObject
import com.google.gson.JsonParser
import org.junit.Assert.*
import org.junit.Test

/** Synthetic receipts only. These tests are not Samsung/Notion E2E evidence. */
class ReceiptPollingTest {
    private val vector = JsonParser.parseString(javaClass.classLoader!!
        .getResourceAsStream("android_intake_vector.json")!!.bufferedReader().use { it.readText() }).asJsonObject
    private val payload = vector.get("payload_json").asString
    private val id = BridgeProtocol.receiptId(payload)
    private val hash = "b".repeat(64)
    private val config = BridgeConfig("https://script.google.com/macros/s/SyntheticDeployment000001/exec",
        vector.get("synthetic_key").asString)

    private class Store(var items: List<QueueEntry>) : QueuePersistence {
        var fail = false
        override fun load() = items
        override fun save(entries: List<QueueEntry>) {
            if (fail) throw BridgeFailure("queue_storage_error")
            items = entries.toList()
        }
    }
    private fun pending() = QueueEntry(id, payload, "staged", "notion_pending", 1, 0, hash)
    private fun response(status: String = "confirmed", receiptId: String = id, recordHash: String = hash) =
        """{"schema_version":"rpos.exercise.acknowledgement.receipt.v1","status":"$status","notion_confirmed":${status == "confirmed"},"receipt_id":"$receiptId","record_hash":"$recordHash"}"""

    @Test fun threePendingReceiptsUseIdentityOnlyRequestsAndDoNotReplayAfterConfirmation() {
        val originals = (1..3).map { n ->
            val p = JsonParser.parseString(payload).asJsonObject.apply {
                getAsJsonObject("record").addProperty("uid", "synthetic-poll-$n")
            }.toString()
            QueueEntry(BridgeProtocol.receiptId(p), p, "staged", "notion_pending", 1, 0, hash)
        }
        val store = Store(originals); var calls = 0
        val q = BridgeQueue(store, object : BridgeTransport {
            override fun post(endpoint: String, body: String): String {
                calls++
                val request = JsonParser.parseString(body).asJsonObject
                assertEquals("rpos.exercise.acknowledgement.v1", request.get("schema_version").asString)
                assertFalse(request.has("payload_json")); assertFalse(body.contains("synthetic-poll"))
                val rid = request.get("receipt_id").asString
                assertEquals("acknowledgement_pending", store.items.single { it.receiptId == rid }.reason)
                return response(receiptId = rid)
            }
        }, { 100 })
        q.pollReceipts(config)
        assertEquals(3, calls); assertTrue(store.items.all { it.state == "confirmed" })
        assertEquals(originals.map { it.payload }, store.items.map { it.payload })
        q.pollReceipts(config); q.sendDue(config)
        assertEquals(3, calls)
    }

    @Test fun stagedBackendWithoutCanonicalAckStaysPendingAndRetriesAfterRestartWithBackoff() {
        val store = Store(listOf(pending())); var time = 100L; var calls = 0; var ready = false
        val signatures = mutableListOf<String>()
        val tr = object : BridgeTransport {
            override fun post(e: String, b: String): String {
                calls++; signatures += JsonParser.parseString(b).asJsonObject.get("signature").asString
                return response(if (ready) "confirmed" else "unresolved")
            }
        }
        BridgeQueue(store, tr, { time }).pollReceipts(config)
        assertEquals("staged", store.items.single().state)
        assertEquals("notion_pending", store.items.single().reason)
        assertEquals(160L, store.items.single().nextAt)
        val restarted = BridgeQueue(store, tr, { time })
        restarted.pollReceipts(config); assertEquals(1, calls)
        time = 160; ready = true; restarted.pollReceipts(config)
        assertEquals(2, calls); assertEquals("confirmed", store.items.single().state)
        assertNotEquals(signatures[0], signatures[1]); assertEquals(payload, store.items.single().payload)
    }

    @Test fun freshUnknownHashQueuedAndBlockedReceiptsAreNeverAutomaticallyUploadedOrQueried() {
        for (entry in listOf(QueueEntry(id, payload), pending().update("retry", "transport_error", hash = null),
            pending().update("blocked", "delivery_conflict"), pending().update("confirmed", "confirmed"))) {
            var calls = 0
            val store = Store(listOf(entry))
            BridgeQueue(store, object : BridgeTransport {
                override fun post(e: String, b: String): String { calls++; return response() }
            }, { 100 }).pollReceipts(config)
            assertEquals(0, calls); assertSame(entry, store.items.single())
        }
    }

    @Test fun wrongIdentityAndHashFailClosedAndCannotConfirm() {
        for (raw in listOf(response(receiptId = "c".repeat(64)), response(recordHash = "d".repeat(64)))) {
            val store = Store(listOf(pending()))
            BridgeQueue(store, object : BridgeTransport { override fun post(e: String, b: String) = raw }, { 100 })
                .pollReceipts(config)
            assertEquals("blocked", store.items.single().state)
            assertEquals("receipt_conflict", store.items.single().reason)
            assertEquals(payload, store.items.single().payload); assertEquals(hash, store.items.single().recordHash)
        }
    }

    @Test fun transportFailureAndInvalidJsonRetryButOldBackendAndUnauthorizedRequireReview() {
        for ((raw, expected) in listOf("<html>login</html>" to "retry", response("unauthorized") to "blocked",
            """{"schema_version":"rpos.exercise.intake.receipt.v1","status":"invalid_request","notion_confirmed":false}""" to "blocked")) {
            val store = Store(listOf(pending()))
            BridgeQueue(store, object : BridgeTransport { override fun post(e: String, b: String) = raw }, { 100 })
                .pollReceipts(config)
            assertEquals(expected, store.items.single().state)
            assertNotEquals("confirmed", store.items.single().state)
        }
        val store = Store(listOf(pending()))
        BridgeQueue(store, object : BridgeTransport {
            override fun post(e: String, b: String): String = throw BridgeFailure("transport_error")
        }, { 100 }).pollReceipts(config)
        assertEquals("retry", store.items.single().state); assertEquals("transport_error", store.items.single().reason)
    }

    @Test fun intentSaveFailurePreventsNetworkAndResponseSaveFailureIsRecoverable() {
        val store = Store(listOf(pending())); var calls = 0
        val tr = object : BridgeTransport {
            override fun post(e: String, b: String): String { calls++; store.fail = true; return response() }
        }
        val q = BridgeQueue(store, tr, { 100 })
        store.fail = true
        try { q.pollReceipts(config); fail("save must fail") } catch (_: BridgeFailure) { }
        assertEquals(0, calls)
        store.fail = false
        try { q.pollReceipts(config); fail("response save must fail") } catch (_: BridgeFailure) { }
        assertEquals(1, calls); assertEquals("retry", store.items.single().state)
        assertEquals("acknowledgement_pending", store.items.single().reason)
        store.fail = false
        val restarted = BridgeQueue(store, object : BridgeTransport {
            override fun post(e: String, b: String) = response()
        }, { 160 })
        restarted.pollReceipts(config); assertEquals("confirmed", store.items.single().state)
    }

    @Test fun repeatedPendingAcknowledgementsAreBoundedToFifteenMinuteBackoff() {
        val store = Store(listOf(pending())); var time = 100L
        val q = BridgeQueue(store, object : BridgeTransport {
            override fun post(e: String, b: String) = response("unresolved")
        }, { time })
        repeat(12) {
            q.pollReceipts(config)
            assertTrue(store.items.single().nextAt - time in 30L..900L)
            time = store.items.single().nextAt
        }
        assertEquals("staged", store.items.single().state)
        assertEquals(payload, store.items.single().payload)
    }

    @Test fun manualSyncRespectsTotalRequestBoundAndUsesAckForExistingHash() {
        val nextPayload = JsonParser.parseString(payload).asJsonObject.apply {
            getAsJsonObject("record").addProperty("uid", "synthetic-not-uploaded")
        }.toString()
        val store = Store(listOf(pending(), QueueEntry(BridgeProtocol.receiptId(nextPayload), nextPayload)))
        var calls = 0
        val q = BridgeQueue(store, object : BridgeTransport {
            override fun post(e: String, b: String): String {
                calls++; assertFalse(JsonParser.parseString(b).asJsonObject.has("payload_json"))
                return response()
            }
        }, { 100 })
        q.sendDue(config, max = 1)
        assertEquals(1, calls); assertEquals("confirmed", store.items[0].state)
        assertEquals("queued", store.items[1].state)
    }
}
