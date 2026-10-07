package com.rpos.bridge.delivery

import com.google.gson.GsonBuilder

class RecoveryCheckpoint(
    val receiptId: String, val recordHash: String, val payloadHash: String,
    val endpointHash: String, val state: String, val reason: String,
    val attempts: Int, val nextAt: Long, val discardPending: Boolean
) {
    fun update(state: String, reason: String, attempts: Int = this.attempts, nextAt: Long = this.nextAt,
               discardPending: Boolean = this.discardPending) =
        RecoveryCheckpoint(receiptId, recordHash, payloadHash, endpointHash, state, reason, attempts, nextAt, discardPending)
    override fun toString() = "RecoveryCheckpoint(state=$state, attempts=$attempts, data=redacted)"
}

interface RecoveryPersistence { fun load(): RecoveryCheckpoint?; fun save(value: RecoveryCheckpoint) }

/** Explicit one-receipt read-only fault test. Ordinary queue/configuration are untouched. */
class BridgeRecovery(private val queue: BridgeQueue, private val persistence: RecoveryPersistence,
                     private val transport: BridgeTransport, private val nowSeconds: () -> Long) {
    private val gson = GsonBuilder().serializeNulls().create()
    private val reasons = setOf("outcome_pending", "response_discarded", "confirmed", "transport_error",
        "http_retry", "invalid_response", "busy", "storage_unresolved", "delivery_error", "disabled",
        "not_configured", "invalid_request", "unauthorized", "unresolved", "needs_migration",
        "delivery_conflict", "receipt_conflict", "backend_update_required", "endpoint_access")

    private fun load(): RecoveryCheckpoint? = persistence.load()?.also { c ->
        if (listOf(c.receiptId, c.recordHash, c.payloadHash, c.endpointHash)
                .any { !Regex("[a-f0-9]{64}").matches(it) } ||
            c.state !in setOf("pending", "confirmed", "blocked") || c.reason !in reasons ||
            c.attempts < 1 || c.attempts >= Int.MAX_VALUE - 1 || c.nextAt < 0 ||
            (c.state == "confirmed" && (c.reason != "confirmed" || c.discardPending)) ||
            (c.reason == "response_discarded" && (c.state != "pending" || c.discardPending))) {
            throw BridgeFailure("recovery_storage_error")
        }
        val original = queue.recoveryRecord(c.receiptId)
        if (original.receiptId != c.receiptId || original.recordHash != c.recordHash ||
            BridgeProtocol.sha(original.payload) != c.payloadHash) throw BridgeFailure("recovery_conflict")
    }

    private fun save(c: RecoveryCheckpoint) {
        persistence.save(c)
        if (gson.toJson(c) != gson.toJson(load())) throw BridgeFailure("recovery_storage_error")
    }

    @Synchronized fun active(): Boolean = load()?.state == "pending"
    @Synchronized fun summary(): String {
        val c = load() ?: return ""
        val delay = maxOf(0, c.nextAt - nowSeconds())
        return " · recovery: ${c.state}" +
            (if (c.reason == "response_discarded") " · response discarded" else "") +
            (if (c.state == "blocked") " · Review: ${c.reason}" else "") +
            (if (c.state == "pending" && delay > 0) " · next check in ${delay}s" else "")
    }

    @Synchronized fun begin(config: BridgeConfig): String {
        if (load() != null) throw BridgeFailure("recovery_already_started")
        val original = queue.recoveryRecord()
        val time = nowSeconds()
        if (time < 0 || time > Long.MAX_VALUE - 900) throw BridgeFailure("configuration_invalid")
        val c = RecoveryCheckpoint(original.receiptId, original.recordHash!!,
            BridgeProtocol.sha(original.payload), BridgeProtocol.sha(config.endpoint),
            "pending", "outcome_pending", 1, time + 30, discardPending = true)
        save(c) // Verified durable checkpoint before the signed receipt query.
        return query(config, c)
    }

    @Synchronized fun resume(config: BridgeConfig): String {
        val c = load() ?: return queue.summary()
        if (BridgeProtocol.sha(config.endpoint) != c.endpointHash) throw BridgeFailure("recovery_conflict")
        if (c.state != "pending" || nowSeconds() < c.nextAt) return queue.summary() + summary()
        val time = nowSeconds()
        if (time < 0 || time > Long.MAX_VALUE - 900) throw BridgeFailure("configuration_invalid")
        val delay = minOf(900L, 30L * (1L shl minOf(c.attempts, 5)))
        val intent = c.update("pending", "outcome_pending", c.attempts + 1, time + delay)
        save(intent)
        return query(config, intent)
    }

    @Synchronized fun recheckReviewedBlocked() {
        val c = load() ?: return
        if (c.state == "blocked") save(c.update("pending", "outcome_pending", nextAt = 0))
    }

    private fun query(config: BridgeConfig, intent: RecoveryCheckpoint): String {
        val result = try {
            val body = BridgeProtocol.acknowledgementRequest(intent.receiptId, intent.recordHash,
                config.signingKey, nowSeconds())
            BridgeProtocol.acknowledgementResponse(transport.post(config.endpoint, body),
                intent.receiptId, intent.recordHash)
        } catch (e: BridgeFailure) {
            val code = if (e.code in reasons) e.code else "delivery_error"
            val retry = code in setOf("transport_error", "http_retry", "invalid_response", "delivery_error")
            BridgeProtocol.Receipt(if (retry) "retry" else "blocked", code)
        } catch (_: Exception) { BridgeProtocol.Receipt("retry", "transport_error") }
        // Controlled loss AFTER receiving/validating a real acknowledgement, BEFORE
        // committing confirmation. This is explicit fault injection, not a real outage.
        val next = if (intent.discardPending && result.state == "confirmed") {
            intent.update("pending", "response_discarded", discardPending = false)
        } else intent.update(if (result.state == "retry") "pending" else result.state, result.reason)
        save(next) // A failed save leaves the durable pre-send checkpoint recoverable.
        return queue.summary() + summary()
    }
}
