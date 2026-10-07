package com.rpos.bridge.delivery

import com.google.gson.GsonBuilder
import com.google.gson.JsonParser
import org.junit.Assert.*
import org.junit.Test

class BridgeRecoveryTest {
    private val gson = GsonBuilder().serializeNulls().create()
    private val intake = JsonParser.parseString(javaClass.classLoader!!
        .getResourceAsStream("android_intake_vector.json")!!.bufferedReader().use { it.readText() }).asJsonObject
    private val payload = intake.get("payload_json").asString
    private val key = intake.get("synthetic_key").asString
    private val id = BridgeProtocol.receiptId(payload)
    private val hash = "b".repeat(64)
    private val config = BridgeConfig("https://script.google.com/macros/s/SyntheticDeployment000001/exec", key)

    private class QueueStore(var items: List<QueueEntry>) : QueuePersistence {
        var writes = 0
        override fun load() = items
        override fun save(entries: List<QueueEntry>) { writes++; items = entries.toList() }
    }
    private class TestStore : RecoveryPersistence {
        var value: RecoveryCheckpoint? = null
        var fail = false
        override fun load() = value
        override fun save(value: RecoveryCheckpoint) {
            if (fail) throw BridgeFailure("recovery_storage_error")
            this.value = value
        }
    }
    private fun queue(store: QueueStore) = BridgeQueue(store, object : BridgeTransport {
        override fun post(endpoint: String, body: String): String = throw AssertionError("ordinary intake is forbidden")
    }, {1800000000L})
    private fun original() = QueueEntry(id, payload, "confirmed", "confirmed", 1, 0, hash)
    private fun response(status: String = "confirmed", responseId: String = id, responseHash: String = hash) =
        """{"schema_version":"rpos.exercise.acknowledgement.receipt.v1","status":"$status","notion_confirmed":${status == "confirmed"},"receipt_id":"$responseId","record_hash":"$responseHash"}"""
    private fun expect(code: String, f: () -> Unit) {
        try { f(); fail("Expected $code") } catch (e: BridgeFailure) { assertEquals(code, e.code) }
    }

    @Test fun acknowledgementSigningMatchesIndependentSharedVectorWithoutExportOrKey() {
        val v = JsonParser.parseString(javaClass.classLoader!!.getResourceAsStream(
            "android_acknowledgement_vector.json")!!.bufferedReader().use { it.readText() }).asJsonObject
        val request = JsonParser.parseString(BridgeProtocol.acknowledgementRequest(v.get("receipt_id").asString,
            v.get("record_hash").asString, v.get("synthetic_key").asString, v.get("sent_at").asLong)).asJsonObject
        assertEquals(v.get("signature"), request.get("signature"))
        assertFalse(request.has("payload_json")); assertFalse(request.toString().contains(v.get("synthetic_key").asString))
    }

    @Test fun controlledLostConfirmationSurvivesFreshRuntimeAndResumesSameReadOnlyReceipt() {
        val qs = QueueStore(listOf(original())); val store = TestStore(); var time = 1800000000L
        val before = gson.toJson(qs.items); val bodies = mutableListOf<String>()
        val transport = object : BridgeTransport { override fun post(endpoint: String, body: String): String {
            assertEquals("pending", store.value!!.state); assertEquals("outcome_pending", store.value!!.reason)
            assertEquals(before, gson.toJson(qs.items)); bodies += body
            assertFalse(body.contains("payload_json")); assertFalse(body.contains("Prueba"))
            return response()
        }}
        val first = BridgeRecovery(queue(qs), store, transport, {time})
        assertTrue(first.begin(config).contains("response discarded"))
        assertEquals("pending", store.value!!.state); assertFalse(store.value!!.discardPending)
        val restarted = BridgeRecovery(queue(qs), store, transport, {time})
        restarted.resume(config); assertEquals(1, bodies.size)
        time += 30
        assertTrue(restarted.resume(config).contains("recovery: confirmed"))
        assertEquals("confirmed", store.value!!.state); assertEquals(2, bodies.size)
        assertNotEquals(JsonParser.parseString(bodies[0]).asJsonObject.get("signature"),
            JsonParser.parseString(bodies[1]).asJsonObject.get("signature"))
        restarted.resume(config); assertEquals(2, bodies.size)
        assertEquals(before, gson.toJson(qs.items)); assertEquals(0, qs.writes)
    }

    @Test fun initialCheckpointSaveOrReadbackFailurePreventsAllNetwork() {
        val qs = QueueStore(listOf(original())); var calls = 0
        val transport = object : BridgeTransport {override fun post(e: String,b: String): String {calls++;return response()}}
        val store = TestStore(); store.fail = true
        expect("recovery_storage_error") {BridgeRecovery(queue(qs),store,transport,{100}).begin(config)}
        assertEquals(0,calls)
        val broken = object : RecoveryPersistence {override fun load():RecoveryCheckpoint? = null;override fun save(v:RecoveryCheckpoint)=Unit}
        expect("recovery_storage_error") {BridgeRecovery(queue(qs),broken,transport,{100}).begin(config)}
        assertEquals(0,calls);assertEquals(0,qs.writes)
    }

    @Test fun missingOrStagedOrAmbiguousOriginalCannotStartProbe() {
        val transport = object : BridgeTransport {override fun post(e:String,b:String):String=throw AssertionError("network")}
        for (items in listOf(emptyList(),listOf(original().update("staged","notion_pending")),
            listOf(original().update("confirmed","confirmed",hash=null)))) {
            expect("recovery_requires_one_confirmed") {BridgeRecovery(queue(QueueStore(items)),TestStore(),transport,{100}).begin(config)}
        }
    }

    @Test fun initialNetworkErrorRetainsDiscardPhaseUntilFirstRealConfirmationThenResumes() {
        val qs=QueueStore(listOf(original()));val store=TestStore();var time=1800000000L;var calls=0
        val transport=object:BridgeTransport {override fun post(e:String,b:String):String {
            if (++calls==1) throw BridgeFailure("transport_error");return response()
        }}
        var r=BridgeRecovery(queue(qs),store,transport,{time});r.begin(config)
        assertTrue(store.value!!.discardPending);assertEquals("pending",store.value!!.state)
        time+=30;r=BridgeRecovery(queue(qs),store,transport,{time});r.resume(config)
        assertEquals("response_discarded",store.value!!.reason);assertFalse(store.value!!.discardPending)
        time+=60;r.resume(config);assertEquals("confirmed",store.value!!.state);assertEquals(3,calls)
    }

    @Test fun postResponseSaveFailureLeavesIntentForProcessRestartWithoutQueueReset() {
        val qs=QueueStore(listOf(original()));val store=TestStore();var time=1800000000L
        val transport=object:BridgeTransport {override fun post(e:String,b:String):String {store.fail=true;return response()}}
        expect("recovery_storage_error") {BridgeRecovery(queue(qs),store,transport,{time}).begin(config)}
        assertEquals("outcome_pending",store.value!!.reason);assertTrue(store.value!!.discardPending)
        store.fail=false;time+=30
        val ok=object:BridgeTransport {override fun post(e:String,b:String)=response()}
        val restarted=BridgeRecovery(queue(qs),store,ok,{time});restarted.resume(config)
        assertEquals("response_discarded",store.value!!.reason)
        time+=60;restarted.resume(config);assertEquals("confirmed",store.value!!.state);assertEquals(0,qs.writes)
    }

    @Test fun blockedProbeRequiresReviewedRecheckAndRetainsItsSameIdentityAndDiscardPhase() {
        val qs=QueueStore(listOf(original()));val store=TestStore();var time=1800000000L;var reviewed=false;var calls=0
        val transport=object:BridgeTransport {override fun post(e:String,b:String):String {
            calls++;return response(if (reviewed) "confirmed" else "unresolved")
        }}
        val r=BridgeRecovery(queue(qs),store,transport,{time});r.begin(config);time+=100
        r.resume(config);assertEquals(1,calls);assertEquals("blocked",store.value!!.state)
        reviewed=true;r.recheckReviewedBlocked();r.resume(config)
        assertEquals("response_discarded",store.value!!.reason);time+=60;r.resume(config)
        assertEquals("confirmed",store.value!!.state);assertEquals(id,store.value!!.receiptId);assertEquals(0,qs.writes)
    }

    @Test fun wrongResponseIdentityHashOrConfirmationCannotCompleteTheProbe() {
        for (raw in listOf(response(responseId="0".repeat(64)),response(responseHash="0".repeat(64)),
            response().replace("\"notion_confirmed\":true","\"notion_confirmed\":false"))) {
            val store=TestStore();val qs=QueueStore(listOf(original()))
            val r=BridgeRecovery(queue(qs),store,object:BridgeTransport {override fun post(e:String,b:String)=raw},{100})
            r.begin(config);assertNotEquals("confirmed",store.value!!.state);assertEquals(0,qs.writes)
            assertTrue(store.value!!.discardPending)
        }
    }

    @Test fun oldBackendAndMalformedResponseAreExplicitlySeparatedFromSuccess() {
        expect("backend_update_required") {BridgeProtocol.acknowledgementResponse(
            """{"schema_version":"rpos.exercise.intake.receipt.v1","status":"invalid_request","notion_confirmed":false}""",id,hash)}
        for (raw in listOf("<html>login</html>","{}","[]","null",response()+"x".repeat(4096))) {
            expect("invalid_response") {BridgeProtocol.acknowledgementResponse(raw,id,hash)}
        }
    }

    @Test fun originalExportOrEndpointChangedAfterStartCannotResume() {
        val qs=QueueStore(listOf(original()));val store=TestStore();var time=100L;var calls=0
        val tr=object:BridgeTransport {override fun post(e:String,b:String):String {calls++;return response()}}
        val r=BridgeRecovery(queue(qs),store,tr,{time});r.begin(config);time+=30
        expect("recovery_conflict") {r.resume(BridgeConfig("https://script.google.com/macros/s/SyntheticDeployment000002/exec",key))}
        val changed=JsonParser.parseString(payload).asJsonObject.apply {addProperty("read_at","2026-01-04T12:00:00Z")}.toString()
        qs.items=listOf(QueueEntry(id,changed,"confirmed","confirmed",1,0,hash))
        expect("recovery_conflict") {r.resume(config)};assertEquals(1,calls)
    }

    @Test fun repeatedStartAndCorruptCheckpointFailClosedWithoutAnotherQuery() {
        val qs=QueueStore(listOf(original()));val store=TestStore();var calls=0
        val r=BridgeRecovery(queue(qs),store,object:BridgeTransport {override fun post(e:String,b:String):String {calls++;return response()}},{100})
        r.begin(config);expect("recovery_already_started") {r.begin(config)}
        store.value=store.value!!.update("confirmed","confirmed",discardPending=true)
        expect("recovery_storage_error") {r.resume(config)};assertEquals(1,calls)
        assertFalse(store.value.toString().contains(id));assertFalse(store.value.toString().contains(payload))
    }

    @Test fun completedProbeDoesNotBlockAddingOrReadingAnotherOrdinaryReceipt() {
        val qs=QueueStore(listOf(original()));val store=TestStore();var time=100L
        val q=queue(qs)
        val r=BridgeRecovery(q,store,object:BridgeTransport {override fun post(e:String,b:String)=response()},{time})
        r.begin(config);time+=30;r.resume(config)
        val next=JsonParser.parseString(payload).asJsonObject.apply {
            getAsJsonObject("record").addProperty("uid","another-synthetic-uid")
        }.toString()
        assertEquals("queued",q.enqueue(next))
        assertTrue(r.summary().contains("recovery: confirmed"));assertFalse(r.active())
        assertEquals(2,qs.items.size)
        expect("recovery_requires_one_confirmed") {q.recoveryRecord()}
    }
}
