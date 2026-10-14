package com.rpos.bridge.delivery

import com.google.gson.GsonBuilder
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayInputStream

class BridgeDeliveryTest {
    private val vector = JsonParser.parseString(javaClass.classLoader!!
        .getResourceAsStream("android_intake_vector.json")!!.bufferedReader().use { it.readText() }).asJsonObject
    private val payload = vector.get("payload_json").asString
    private val key = vector.get("synthetic_key").asString
    private val id = vector.get("receipt_id").asString
    private val hash = "b".repeat(64) // Deliberately synthetic server record hash; not the event hash.
    private val config = BridgeConfig("https://script.google.com/macros/s/SyntheticDeployment000001/exec", key)
    private val gson = GsonBuilder().serializeNulls().create()
    private class MemoryStore : QueuePersistence {
        var items = emptyList<QueueEntry>()
        var fail = false
        override fun load() = items
        override fun save(entries: List<QueueEntry>) {
            if (fail) throw BridgeFailure("queue_storage_error")
            items = entries.toList()
        }
    }
    private fun staged(delivery: String? = null): String = JsonObject().apply {
        addProperty("schema_version", "rpos.exercise.intake.receipt.v1")
        addProperty("status", "staged"); addProperty("notion_confirmed", false)
        addProperty("receipt_id", id); addProperty("record_hash", hash)
        if (delivery != null) add("delivery", JsonObject().apply {
            addProperty("schema_version", "rpos.exercise.delivery.receipt.v1")
            addProperty("status", delivery); addProperty("notion_confirmed", delivery == "confirmed")
        })
    }.toString()
    private fun failure(status: String) = """{"schema_version":"rpos.exercise.intake.receipt.v1","status":"$status","notion_confirmed":false}"""
    private fun expect(code: String, block: () -> Unit) {
        try { block(); fail("Expected $code") } catch (e: BridgeFailure) { assertEquals(code, e.code) }
    }

    @Test fun signerMatchesSharedAppsScriptVectorExactly() {
        assertEquals(vector.get("payload_sha256").asString, BridgeProtocol.sha(payload))
        assertEquals(id, BridgeProtocol.receiptId(payload))
        val body = JsonParser.parseString(BridgeProtocol.request(payload, key, vector.get("sent_at").asLong)).asJsonObject
        assertEquals(vector.get("signature").asString, body.get("signature").asString)
        assertEquals(payload, body.get("payload_json").asString)
        assertFalse(body.toString().contains(key))
    }

    @Test fun queuedBeforeTransportAndConfirmedOnlyOnNestedDeliveryReadback() {
        val store = MemoryStore(); var calls = 0
        val queue = BridgeQueue(store, object : BridgeTransport {
            override fun post(endpoint: String, body: String): String {
                calls++; assertEquals("retry", store.items.single().state)
                assertEquals("outcome_pending", store.items.single().reason)
                assertEquals(payload, store.items.single().payload)
                return staged("confirmed")
            }
        }, { 1800000000 })
        queue.enqueue(payload); queue.sendDue(config)
        assertEquals("confirmed", store.items.single().state); assertEquals(1, calls)
        queue.sendDue(config); assertEquals(1, calls)
    }

    @Test fun stagingIsNotNotionConfirmation() {
        val receipt = BridgeProtocol.response(staged(), id, null)
        assertEquals("staged", receipt.state); assertEquals(hash, receipt.recordHash)
    }

    @Test fun freshAcquisitionSameRecordReusesStoredOriginalAndConfirmedReceipt() {
        val store = MemoryStore()
        val queue = BridgeQueue(store, object : BridgeTransport {override fun post(e: String, b: String) = staged("confirmed")}, { 1800000000 })
        queue.enqueue(payload); queue.sendDue(config)
        val newRead = JsonParser.parseString(payload).asJsonObject.apply { addProperty("read_at", "2026-01-04T12:00:00Z"); addProperty("read_record_count", 99) }
        assertEquals("confirmed", queue.enqueue(newRead.toString()))
        assertEquals(1, store.items.size); assertEquals(payload, store.items.single().payload)
    }

    @Test fun changedRecordUnderUidNeverOverwritesQueue() {
        val store = MemoryStore(); val queue = BridgeQueue(store, object : BridgeTransport {override fun post(e: String, b: String) = staged()}, { 1 })
        queue.enqueue(payload)
        expect("record_changed") { queue.enqueue(payload.replace("Prueba", "Changed")) }
        assertEquals(payload, store.items.single().payload)
    }

    @Test fun restartAfterLostResponseKeepsPayloadAndUsesFreshSignatureWithBackoff() {
        val store = MemoryStore(); var time = 1800000000L; val sent = mutableListOf<JsonObject>()
        val transport = object : BridgeTransport {
            override fun post(e: String, b: String): String {
                sent += JsonParser.parseString(b).asJsonObject
                if (sent.size == 1) throw BridgeFailure("transport_error")
                return staged("confirmed")
            }
        }
        BridgeQueue(store, transport, {time}).apply { enqueue(payload); sendDue(config) }
        assertEquals("retry", store.items.single().state)
        val restarted = BridgeQueue(store, transport, {time})
        restarted.sendDue(config); assertEquals(1, sent.size)
        time += 30; restarted.sendDue(config)
        assertEquals(2, sent.size); assertEquals("confirmed", store.items.single().state)
        assertEquals(sent[0].get("payload_json"), sent[1].get("payload_json"))
        assertNotEquals(sent[0].get("signature"), sent[1].get("signature"))
    }

    @Test fun localSaveFailurePreventsAnyNetwork() {
        val store = MemoryStore(); var calls = 0
        val q = BridgeQueue(store, object : BridgeTransport {override fun post(e: String,b: String):String { calls++; return staged() }}, {1})
        q.enqueue(payload); store.fail = true
        expect("queue_storage_error") {q.sendDue(config)}; assertEquals(0, calls)
    }

    @Test fun localResponseSaveFailureRetainsPreSendIntentForRestart() {
        val store = MemoryStore()
        val transport = object : BridgeTransport {override fun post(e: String,b: String):String {store.fail = true; return staged("confirmed")}}
        val q = BridgeQueue(store, transport, {1}); q.enqueue(payload)
        expect("queue_storage_error") {q.sendDue(config)}
        assertEquals("outcome_pending", store.items.single().reason); assertEquals("retry", store.items.single().state)
    }

    @Test fun malformedOrHtmlResponseIsNotSuccessAndKeepsPending() {
        for (raw in listOf("<html>login</html>", "{}", "null", "[]", "x".repeat(32769))) {
            expect("invalid_response") {BridgeProtocol.response(raw,id,null)}
        }
    }

    @Test fun wrongReceiptOrChangedServerHashCannotConfirm() {
        expect("receipt_conflict") {BridgeProtocol.response(staged("confirmed"), "c".repeat(64), null)}
        expect("receipt_conflict") {BridgeProtocol.response(staged("confirmed"), id, "d".repeat(64))}
    }

    @Test fun outerOrNestedConfirmationFlagsMustAgreeWithContract() {
        expect("invalid_response") {BridgeProtocol.response(staged().replace("\"notion_confirmed\":false", "\"notion_confirmed\":true"),id,null)}
        val r = JsonParser.parseString(staged("confirmed")).asJsonObject
        r.getAsJsonObject("delivery").addProperty("notion_confirmed", false)
        expect("invalid_response") {BridgeProtocol.response(r.toString(),id,null)}
        expect("invalid_response") {BridgeProtocol.response(staged("confirmed").replace("\"notion_confirmed\":true", "\"notion_confirmed\":\"true\""),id,null)}
    }

    @Test fun permanentFailuresAndUncertainDeliveryRequireReview() {
        for (s in listOf("unauthorized","not_configured","disabled","record_changed","storage_conflict","invalid_request")) {
            assertEquals("blocked", BridgeProtocol.response(failure(s),id,null).state)
        }
        for (s in listOf("needs_reconciliation","needs_migration","unresolved","delivery_conflict")) {
            assertEquals("blocked", BridgeProtocol.response(staged(s),id,null).state)
        }
    }

    @Test fun temporaryFailuresRemainRetryable() {
        for (s in listOf("busy","storage_error","storage_unresolved")) {
            assertEquals("retry", BridgeProtocol.response(failure(s),id,null).state)
        }
        for (s in listOf("busy","delivery_error","storage_unresolved")) {
            assertEquals("retry", BridgeProtocol.response(staged(s),id,null).state)
        }
    }

    @Test fun blockedReceiptsAreNotAutomaticallyResentUntilExplicitReviewedRecheck() {
        val store = MemoryStore(); var calls = 0
        val q = BridgeQueue(store, object : BridgeTransport {override fun post(e: String,b: String):String {calls++;return staged("unresolved")}}, {100L})
        q.enqueue(payload); q.sendDue(config); q.sendDue(config)
        assertEquals(1,calls); assertEquals("blocked", store.items.single().state)
        q.recheckReviewedBlocked(); assertEquals(payload,store.items.single().payload)
        q.sendDue(config); assertEquals(2,calls)
    }

    @Test fun mockExportCannotBeSignedOrQueued() {
        expect("source_not_samsung") {BridgeProtocol.request(payload.replace("\"source\":\"samsung_health\"", "\"source\":\"mock\""),key,1)}
    }

    @Test fun maliciousEndpointsAndLoginRedirectsAreRejected() {
        for (url in listOf("http://script.google.com/macros/s/SyntheticDeployment000001/exec", "https://evil.example/exec", config.endpoint+"?key=x", config.endpoint+"#secret", "https://user@script.google.com/macros/s/SyntheticDeployment000001/exec", "https://script.google.com:443/macros/s/SyntheticDeployment000001/exec")) {
            expect("configuration_invalid") {BridgeConfig(url,key)}
        }
        for (url in listOf("https://accounts.google.com/login", "https://script.googleusercontent.com.evil.example/macros/echo?x=1", "http://script.googleusercontent.com/macros/echo?x=1", "https://script.googleusercontent.com/macros/echo")) {
            expect("endpoint_access") {BridgeProtocol.contentRedirect(url)}
        }
        assertEquals("script.googleusercontent.com", BridgeProtocol.contentRedirect("https://script.googleusercontent.com/macros/echo?user_content_key=synthetic").host)
    }

    @Test fun sizeLimitsUseUtf8AndKeepSensitiveStringsOutOfToString() {
        expect("payload_too_large") {BridgeProtocol.request(payload.replace("Prueba", "😀".repeat(100000)),key,1)}
        assertFalse(config.toString().contains(key)); assertFalse(config.toString().contains("script.google.com"))
        assertFalse(QueueEntry(id,payload).toString().contains("Prueba"))
    }

    @Test fun queueReadbackCorruptionPreventsUpload() {
        var calls = 0
        val broken = object : QueuePersistence {
            override fun load() = listOf(QueueEntry("0".repeat(64),payload))
            override fun save(entries:List<QueueEntry>) = Unit
        }
        val q = BridgeQueue(broken,object:BridgeTransport {override fun post(e:String,b:String):String {calls++;return staged()}},{1})
        expect("queue_storage_error") {q.sendDue(config)}; assertEquals(0,calls)
    }

    @Test fun boundedStreamsStopsAtLimitPlusOneAndDoesNotUseNewAndroidApi() {
        assertEquals(11,BoundedStreams.read(ByteArrayInputStream(ByteArray(100)),10).size)
        assertEquals(3,BoundedStreams.read(ByteArrayInputStream(ByteArray(3)),10).size)
    }
}
