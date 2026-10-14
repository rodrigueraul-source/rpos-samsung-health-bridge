package com.rpos.bridge.delivery

import java.net.URI
import java.nio.charset.StandardCharsets.UTF_8
import javax.net.ssl.HttpsURLConnection

class AppsScriptTransport(private val connect: (URI) -> HttpsURLConnection = {
    it.toURL().openConnection() as HttpsURLConnection
}) : BridgeTransport {
    override fun post(endpoint: String, body: String): String {
        var connection: HttpsURLConnection? = null
        try {
            connection = open(BridgeProtocol.endpoint(endpoint), "POST")
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            val bytes = body.toByteArray(UTF_8)
            if (bytes.size > 262144) throw BridgeFailure("payload_too_large")
            connection.setFixedLengthStreamingMode(bytes.size)
            connection.outputStream.use { it.write(bytes) }
            if (connection.responseCode in setOf(302, 303)) {
                val target = BridgeProtocol.contentRedirect(connection.getHeaderField("Location") ?: "")
                connection.disconnect()
                // Only GET the one-time ContentService result. Never forward signed body/key/headers.
                connection = open(target, "GET")
            }
            val code = connection.responseCode
            if (code == 429 || code in 500..599) throw BridgeFailure("http_retry")
            if (code !in 200..299) throw BridgeFailure("endpoint_access")
            if (connection.contentType?.substringBefore(';')?.trim()?.lowercase() != "application/json") {
                throw BridgeFailure("endpoint_access")
            }
            val response = connection.inputStream.use { BoundedStreams.read(it, 32768) }
            if (response.size > 32768) throw BridgeFailure("invalid_response")
            return String(response, UTF_8)
        } catch (e: BridgeFailure) { throw e }
        catch (_: Exception) { throw BridgeFailure("transport_error") }
        finally { connection?.disconnect() }
    }
    private fun open(uri: URI, method: String): HttpsURLConnection =
        connect(uri).apply {
            requestMethod = method; instanceFollowRedirects = false
            connectTimeout = 15000; readTimeout = 30000; useCaches = false
            setRequestProperty("Accept", "application/json")
        }
}
