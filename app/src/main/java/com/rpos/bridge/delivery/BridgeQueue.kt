package com.rpos.bridge.delivery

import com.google.gson.GsonBuilder
import java.nio.charset.StandardCharsets.UTF_8

class QueueEntry(
    val receiptId: String, val payload: String, val state: String = "queued",
    val reason: String = "queued", val attempts: Int = 0, val nextAt: Long = 0,
    val recordHash: String? = null
) {
    fun update(state: String, reason: String, attempts: Int = this.attempts,
               nextAt: Long = this.nextAt, hash: String? = recordHash) =
        QueueEntry(receiptId, payload, state, reason, attempts, nextAt, hash)
    override fun toString() = "QueueEntry(state=$state, attempts=$attempts, data=redacted)"
}

interface QueuePersistence { fun load(): List<QueueEntry>; fun save(entries: List<QueueEntry>) }
interface BridgeTransport { fun post(endpoint: String, body: String): String }

/** Foreground single writer. Never deletes receipts or refreshes a queued record on replay. */
class BridgeQueue(private val persistence: QueuePersistence, private val transport: BridgeTransport,
                  private val nowSeconds: () -> Long) {
    private val gson = GsonBuilder().serializeNulls().create()
    private fun save(entries: List<QueueEntry>) {
        if (entries.size > 100 || gson.toJson(entries).toByteArray(UTF_8).size > 5242880) {
            throw BridgeFailure("queue_full")
        }
        persistence.save(entries)
        val actual = persistence.load()
        if (gson.toJson(entries) != gson.toJson(actual)) throw BridgeFailure("queue_storage_error")
    }
    private fun entries(): List<QueueEntry> = persistence.load().also { list ->
        if (list.size > 100 || list.map { it.receiptId }.distinct().size != list.size ||
            list.any { it.receiptId != BridgeProtocol.receiptId(it.payload) || it.attempts < 0 || it.attempts >= Int.MAX_VALUE - 1 ||
                it.state !in setOf("queued", "retry", "staged", "blocked", "confirmed") ||
                (it.recordHash != null && !Regex("[a-f0-9]{64}").matches(it.recordHash)) }) {
            throw BridgeFailure("queue_storage_error")
        }
    }
    @Synchronized fun enqueue(payload: String): String {
        val id = BridgeProtocol.receiptId(payload)
        val current = entries()
        val existing = current.find { it.receiptId == id }
        if (existing != null) {
            if (!BridgeProtocol.unchanged(existing.payload, payload)) throw BridgeFailure("record_changed")
            return existing.state
        }
        save(current + QueueEntry(id, payload))
        return "queued"
    }
    @Synchronized fun summary(): String {
        val current = entries()
        val counts = current.groupingBy { it.state }.eachCount().entries
            .joinToString(" · ") { "${it.key}: ${it.value}" }.ifEmpty { "Queue empty" }
        val reviews = current.filter { it.state == "blocked" }.map { it.reason }.distinct()
        val delay = current.filter { it.state in setOf("retry", "staged") }
            .minOfOrNull { maxOf(0, it.nextAt - nowSeconds()) }
        return counts + (if (reviews.isEmpty()) "" else " · Review: " + reviews.joinToString(", ")) +
            (if (delay == null || delay == 0L) "" else " · next check in ${delay}s")
    }

    @Synchronized fun hasAttempts(): Boolean = entries().any { it.attempts > 0 }

    /** Read-only polling never uploads a workout or retries a blocked receipt. */
    @Synchronized fun pollReceipts(config: BridgeConfig, max: Int = 3): String {
        require(max in 1..3)
        var current = entries()
        val due = current.filter { it.recordHash != null &&
            it.state in setOf("staged", "retry") && it.nextAt <= nowSeconds() }.take(max)
        for (old in due) {
            val time = nowSeconds()
            if (time < 0 || time > Long.MAX_VALUE - 900) throw BridgeFailure("configuration_invalid")
            val attempt = old.attempts + 1
            val delay = minOf(900L, 30L * (1L shl minOf(attempt - 1, 5)))
            val intent = old.update("retry", "acknowledgement_pending", attempt, time + delay)
            current = current.map { if (it.receiptId == old.receiptId) intent else it }
            save(current) // Verified durable intent before the identity-only request.
            val result = try {
                val body = BridgeProtocol.acknowledgementRequest(old.receiptId, old.recordHash!!,
                    config.signingKey, time)
                BridgeProtocol.acknowledgementResponse(transport.post(config.endpoint, body),
                    old.receiptId, old.recordHash)
            } catch (e: BridgeFailure) {
                val retry = e.code in setOf("transport_error", "http_retry", "invalid_response")
                BridgeProtocol.Receipt(if (retry) "retry" else "blocked", e.code)
            } catch (_: Exception) { BridgeProtocol.Receipt("retry", "transport_error") }
            // No canonical journal yet: wait and re-read. Never manufacture an ack
            // from staging, a screenshot, a timer, or an assisted Notion row.
            val next = if (result.reason == "unresolved") {
                intent.update("staged", "notion_pending")
            } else intent.update(result.state, result.reason)
            current = current.map { if (it.receiptId == old.receiptId) next else it }
            save(current)
        }
        return summary()
    }

    // An explicit recovery probe reads the sole confirmed receipt; never resets it.
    @Synchronized fun recoveryRecord(receiptId: String? = null): QueueEntry {
        val current = entries()
        val matches = if (receiptId == null) current else current.filter { it.receiptId == receiptId }
        if (matches.size != 1 || matches.single().state != "confirmed" || matches.single().recordHash == null) {
            throw BridgeFailure("recovery_requires_one_confirmed")
        }
        return matches.single()
    }

    @Synchronized fun recheckReviewedBlocked() {
        // Explicit user action after backend review. Never clears any backend write intent.
        save(entries().map { if (it.state == "blocked") it.update("retry", "reviewed_recheck", nextAt = 0) else it })
    }

    @Synchronized fun sendDue(config: BridgeConfig, max: Int = 3): String {
        require(max in 1..3)
        // Existing staged/uncertain receipts with a verified hash only need an ack.
        // New intake and uncertain intake without a hash remain explicit actions.
        val polled = entries().count { it.recordHash != null &&
            it.state in setOf("staged", "retry") && it.nextAt <= nowSeconds() }.coerceAtMost(max)
        pollReceipts(config, max)
        var current = entries()
        val due = current.filter { it.recordHash == null &&
            it.state in setOf("queued", "retry") && it.nextAt <= nowSeconds() }.take(max - polled)
        for (old in due) {
            val attempt = old.attempts + 1
            val delay = minOf(900L, 30L * (1L shl minOf(attempt - 1, 5)))
            val intent = old.update("retry", "outcome_pending", attempt, nowSeconds() + delay)
            current = current.map { if (it.receiptId == old.receiptId) intent else it }
            save(current) // Durable readback before ANY network access.
            val result = try {
                val body = BridgeProtocol.request(old.payload, config.signingKey, nowSeconds())
                BridgeProtocol.response(transport.post(config.endpoint, body), old.receiptId, old.recordHash)
            } catch (e: BridgeFailure) {
                val retry = e.code in setOf("transport_error", "http_retry", "invalid_response")
                BridgeProtocol.Receipt(if (retry) "retry" else "blocked", e.code)
            } catch (_: Exception) { BridgeProtocol.Receipt("retry", "transport_error") }
            val next = intent.update(result.state, result.reason, hash = result.recordHash ?: old.recordHash)
            current = current.map { if (it.receiptId == old.receiptId) next else it }
            save(current) // If this fails, the durable pre-send intent remains recoverable.
        }
        return summary()
    }
}
