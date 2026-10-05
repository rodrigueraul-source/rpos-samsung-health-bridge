package com.rpos.bridge.delivery

import com.google.gson.GsonBuilder
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import com.google.gson.Strictness
import java.net.URI
import java.nio.charset.StandardCharsets.UTF_8
import java.security.MessageDigest
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

class BridgeFailure(val code: String) : RuntimeException(code)

class BridgeConfig(val endpoint: String, val signingKey: String) {
    init {
        BridgeProtocol.endpoint(endpoint)
        if (!Regex("[a-f0-9]{64}").matches(signingKey)) throw BridgeFailure("configuration_invalid")
    }
    override fun toString() = "BridgeConfig(redacted)"
}

object BridgeProtocol {
    private val gson = GsonBuilder().disableHtmlEscaping().serializeNulls().setStrictness(Strictness.STRICT).create()
    fun sha(text: String): String = MessageDigest.getInstance("SHA-256")
        .digest(text.toByteArray(UTF_8)).joinToString("") { "%02x".format(it.toInt() and 255) }

    fun endpoint(value: String): URI {
        val u = try { URI(value) } catch (_: Exception) { throw BridgeFailure("configuration_invalid") }
        if (u.scheme != "https" || u.host != "script.google.com" || u.userInfo != null ||
            u.port != -1 || u.rawQuery != null || u.rawFragment != null ||
            !Regex("/macros/s/[A-Za-z0-9_-]{16,256}/exec").matches(u.rawPath ?: "")) {
            throw BridgeFailure("configuration_invalid")
        }
        return u
    }

    fun contentRedirect(location: String): URI {
        val u = try { URI(location) } catch (_: Exception) { throw BridgeFailure("endpoint_access") }
        if (u.scheme != "https" || u.host != "script.googleusercontent.com" ||
            u.userInfo != null || u.port != -1 || u.rawFragment != null ||
            u.rawPath != "/macros/echo" || u.rawQuery.isNullOrEmpty()) throw BridgeFailure("endpoint_access")
        return u
    }

    private fun obj(text: String): JsonObject = try {
        gson.fromJson(text, JsonObject::class.java) ?: throw BridgeFailure("invalid_response")
    } catch (_: Exception) { throw BridgeFailure("invalid_response") }

    fun export(payload: String): JsonObject {
        if (payload.toByteArray(UTF_8).size > 196608) throw BridgeFailure("payload_too_large")
        val e = obj(payload)
        if (e.get("schema_version")?.asString != "rpos.exercise.export.v1" ||
            e.get("source")?.asString != "samsung_health" || e.get("sdk_version")?.asString != "1.1.0") {
            throw BridgeFailure("source_not_samsung")
        }
        val r = e.getAsJsonObject("record") ?: throw BridgeFailure("payload_invalid")
        val uid = r.get("uid")?.asString ?: throw BridgeFailure("payload_invalid")
        if (uid.isBlank() || uid != uid.trim() || uid.length > 128 || uid.any { it.code < 32 }) {
            throw BridgeFailure("payload_invalid")
        }
        return e
    }

    // Match JSON.stringify([source, uid]) exactly, without Gson HTML/Unicode escaping.
    private fun jsString(value: String): String = buildString {
        append('"')
        for (c in value) when (c) {
            '"' -> append("\\\"")
            '\\' -> append("\\\\")
            '\b' -> append("\\b")
            '\u000c' -> append("\\f")
            '\n' -> append("\\n")
            '\r' -> append("\\r")
            '\t' -> append("\\t")
            else -> if (c.code < 32) append("\\u%04x".format(c.code)) else append(c)
        }
        append('"')
    }
    fun receiptId(payload: String): String = sha("[\"samsung_health\"," +
        jsString(export(payload).getAsJsonObject("record").get("uid").asString) + "]")

    fun unchanged(first: String, second: String): Boolean =
        export(first).get("record") == export(second).get("record")

    fun request(payload: String, key: String, unixSeconds: Long): String {
        export(payload)
        if (!Regex("[a-f0-9]{64}").matches(key) || unixSeconds < 0) throw BridgeFailure("configuration_invalid")
        val signed = "rpos.exercise.intake.v1\n$unixSeconds\n${sha(payload)}"
        val mac = Mac.getInstance("HmacSHA256")
        // The Apps Script contract uses the HEX STRING's UTF-8 bytes, not decoded key bytes.
        mac.init(SecretKeySpec(key.toByteArray(UTF_8), "HmacSHA256"))
        val signature = mac.doFinal(signed.toByteArray(UTF_8)).joinToString("") { "%02x".format(it.toInt() and 255) }
        val value = JsonObject().apply {
            addProperty("schema_version", "rpos.exercise.intake.v1")
            addProperty("sent_at", unixSeconds)
            addProperty("payload_json", payload)
            addProperty("signature", signature)
        }
        return gson.toJson(value).also {
            if (it.toByteArray(UTF_8).size > 262144) throw BridgeFailure("payload_too_large")
        }
    }

    class Receipt(val state: String, val reason: String, val recordHash: String? = null)
    fun response(raw: String, expectedId: String, priorHash: String?): Receipt {
        if (raw.toByteArray(UTF_8).size > 32768) throw BridgeFailure("invalid_response")
        try {
            val r = obj(raw)
            if (r.get("schema_version")?.asString != "rpos.exercise.intake.receipt.v1" ||
                r.get("notion_confirmed")?.isJsonPrimitive != true ||
                !r.get("notion_confirmed").asJsonPrimitive.isBoolean ||
                r.get("notion_confirmed")?.asBoolean != false) throw BridgeFailure("invalid_response")
            val status = r.get("status")?.asString ?: throw BridgeFailure("invalid_response")
            if (status != "staged") {
                return when (status) {
                    "busy", "storage_error", "storage_unresolved" -> Receipt("retry", status)
                    "disabled", "not_configured", "invalid_request", "unauthorized", "record_changed", "storage_conflict" ->
                        Receipt("blocked", status)
                    else -> throw BridgeFailure("invalid_response")
                }
            }
            val hash = r.get("record_hash")?.asString ?: throw BridgeFailure("invalid_response")
            if (r.get("receipt_id")?.asString != expectedId || !Regex("[a-f0-9]{64}").matches(hash) ||
                (priorHash != null && priorHash != hash)) throw BridgeFailure("receipt_conflict")
            val d = r.get("delivery") ?: return Receipt("staged", "notion_pending", hash)
            if (!d.isJsonObject) throw BridgeFailure("invalid_response")
            val delivery = d.asJsonObject
            if (delivery.get("schema_version")?.asString != "rpos.exercise.delivery.receipt.v1") {
                throw BridgeFailure("invalid_response")
            }
            val ds = delivery.get("status")?.asString ?: throw BridgeFailure("invalid_response")
            if (delivery.get("notion_confirmed")?.isJsonPrimitive != true ||
                !delivery.get("notion_confirmed").asJsonPrimitive.isBoolean) throw BridgeFailure("invalid_response")
            if (delivery.get("notion_confirmed")?.asBoolean != (ds == "confirmed")) throw BridgeFailure("invalid_response")
            return when (ds) {
                "confirmed" -> Receipt("confirmed", "confirmed", hash)
                "busy", "delivery_error", "storage_unresolved" -> Receipt("retry", ds, hash)
                "disabled", "not_configured", "needs_reconciliation", "needs_migration", "unresolved", "delivery_conflict" ->
                    Receipt("blocked", ds, hash)
                else -> throw BridgeFailure("invalid_response")
            }
        } catch (e: BridgeFailure) { throw e }
        catch (_: Exception) { throw BridgeFailure("invalid_response") }
    }
}
