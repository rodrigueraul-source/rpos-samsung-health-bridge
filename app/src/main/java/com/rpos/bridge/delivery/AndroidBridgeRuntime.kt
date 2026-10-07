package com.rpos.bridge.delivery

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import com.google.gson.GsonBuilder
import com.google.gson.reflect.TypeToken
import java.io.File
import java.nio.charset.StandardCharsets.UTF_8
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Authenticated private storage; key-loss/corruption fails closed, never recreates an empty queue. */
private class BridgeVault(context: Context) {
    private val root = context.noBackupFilesDir
    private val alias = "rpos.bridge.local.v1"
    private fun key(forWrite: Boolean): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        if (store.containsAlias(alias)) return store.getKey(alias, null) as SecretKey
        if (!forWrite || root.listFiles()?.any { it.name.startsWith("bridge-") } == true) {
            throw BridgeFailure("private_storage_locked")
        }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setKeySize(256).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    fun read(name: String): String? {
        val file = AtomicFile(File(root, name))
        if (!file.baseFile.exists() && !File(root, "$name.bak").exists()) return null
        try {
            val bytes = file.openRead().use { BoundedStreams.read(it, 5500000) }
            if (bytes.size < 30 || bytes.size > 5500000 || bytes[0] != 1.toByte()) throw BridgeFailure("private_storage_locked")
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key(false), GCMParameterSpec(128, bytes.copyOfRange(1, 13)))
            cipher.updateAAD(name.toByteArray(UTF_8))
            return String(cipher.doFinal(bytes.copyOfRange(13, bytes.size)), UTF_8)
        } catch (_: Exception) { throw BridgeFailure("private_storage_locked") }
    }
    fun write(name: String, text: String) {
        try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, key(true))
            cipher.updateAAD(name.toByteArray(UTF_8))
            val bytes = byteArrayOf(1) + cipher.iv + cipher.doFinal(text.toByteArray(UTF_8))
            val file = AtomicFile(File(root, name))
            val stream = file.startWrite()
            try { stream.write(bytes); file.finishWrite(stream) }
            catch (e: Exception) { file.failWrite(stream); throw e }
            if (read(name) != text) throw BridgeFailure("queue_storage_error")
        } catch (_: Exception) { throw BridgeFailure("queue_storage_error") }
    }
}

class AndroidBridgeRuntime private constructor(context: Context) {
    private val vault = BridgeVault(context)
    private val gson = GsonBuilder().serializeNulls().create()
    val queue = BridgeQueue(object : QueuePersistence {
        override fun load(): List<QueueEntry> = vault.read("bridge-queue.enc")?.let {
            try {
                val envelope = com.google.gson.JsonParser.parseString(it).asJsonObject
                if (envelope.get("schema_version").asString != "rpos.android.queue.v1") throw BridgeFailure("queue_storage_error")
                gson.fromJson<List<QueueEntry>>(envelope.get("entries"), object : TypeToken<List<QueueEntry>>() {}.type)
                    ?: throw BridgeFailure("queue_storage_error")
            }
            catch (_: Exception) { throw BridgeFailure("queue_storage_error") }
        } ?: emptyList()
        override fun save(entries: List<QueueEntry>) = vault.write("bridge-queue.enc",
            gson.toJson(mapOf("schema_version" to "rpos.android.queue.v1", "entries" to entries)))
    }, AppsScriptTransport(), { System.currentTimeMillis() / 1000 })

    val recovery = BridgeRecovery(queue, object : RecoveryPersistence {
        override fun load(): RecoveryCheckpoint? = vault.read("bridge-recovery.enc")?.let {
            try {
                val envelope = com.google.gson.JsonParser.parseString(it).asJsonObject
                if (envelope.get("schema_version")?.asString != "rpos.android.recovery.v1") {
                    throw BridgeFailure("recovery_storage_error")
                }
                val value = envelope.getAsJsonObject("checkpoint")
                val strings = listOf("receiptId", "recordHash", "payloadHash", "endpointHash", "state", "reason")
                if (strings.any { name -> value.get(name)?.isJsonPrimitive != true ||
                        !value.get(name).asJsonPrimitive.isString } ||
                    value.get("discardPending")?.isJsonPrimitive != true ||
                    !value.get("discardPending").asJsonPrimitive.isBoolean) throw BridgeFailure("recovery_storage_error")
                for (name in listOf("attempts", "nextAt")) {
                    if (value.get(name)?.isJsonPrimitive != true || !value.get(name).asJsonPrimitive.isNumber ||
                        !Regex("[0-9]{1,19}").matches(value.get(name).asString)) throw BridgeFailure("recovery_storage_error")
                }
                gson.fromJson(value, RecoveryCheckpoint::class.java) ?: throw BridgeFailure("recovery_storage_error")
            } catch (_: Exception) { throw BridgeFailure("recovery_storage_error") }
        }
        override fun save(value: RecoveryCheckpoint) = vault.write("bridge-recovery.enc",
            gson.toJson(mapOf("schema_version" to "rpos.android.recovery.v1", "checkpoint" to value)))
    }, AppsScriptTransport(), { System.currentTimeMillis() / 1000 })

    @Synchronized fun summary(): String = queue.summary() + recovery.summary()
    @Synchronized fun checkPending(): String {
        val config = config() ?: throw BridgeFailure("not_configured")
        return if (recovery.active()) recovery.resume(config) else {
            queue.sendDue(config, max = 1) + recovery.summary()
        }
    }

    @Synchronized fun config(): BridgeConfig? = vault.read("bridge-config.enc")?.let {
        try { val v = com.google.gson.JsonParser.parseString(it).asJsonObject
            BridgeConfig(v.get("endpoint").asString, v.get("signingKey").asString) }
        catch (_: Exception) { throw BridgeFailure("private_storage_locked") }
    }
    @Synchronized fun configure(endpoint: String, key: String) {
        val newConfig = BridgeConfig(endpoint, key)
        val old = config()
        if (old != null && old.endpoint != endpoint && queue.hasAttempts()) throw BridgeFailure("endpoint_change_requires_review")
        vault.write("bridge-config.enc", gson.toJson(newConfig))
    }
    companion object {
        @Volatile private var instance: AndroidBridgeRuntime? = null
        fun get(context: Context): AndroidBridgeRuntime = instance ?: synchronized(this) {
            instance ?: AndroidBridgeRuntime(context.applicationContext).also { instance = it }
        }
    }
}
