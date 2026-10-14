package com.rpos.bridge.delivery

import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.net.URL
import java.net.SocketTimeoutException
import java.security.cert.Certificate
import javax.net.ssl.HttpsURLConnection

class AppsScriptTransportTest {
    private val endpoint = "https://script.google.com/macros/s/SyntheticDeployment000001/exec"
    private class Fake(private val code: Int, private val location: String? = null,
                       private val text: String = "{}", private val mime: String = "application/json") :
        HttpsURLConnection(URL("https://synthetic.invalid")) {
        val sent = ByteArrayOutputStream()
        var closed = false
        var timeout = false
        override fun getOutputStream() = sent
        override fun getInputStream() = ByteArrayInputStream(text.toByteArray(Charsets.UTF_8))
        override fun getResponseCode(): Int { if (timeout) throw SocketTimeoutException("SECRET"); return code }
        override fun getHeaderField(name: String): String? = if (name == "Location") location else null
        override fun getContentType() = mime
        override fun getCipherSuite() = "synthetic"
        override fun getLocalCertificates(): Array<Certificate>? = null
        override fun getServerCertificates(): Array<Certificate> = emptyArray()
        override fun connect() = Unit
        override fun disconnect() { closed = true }
        override fun usingProxy() = false
    }
    private fun expect(code: String, fn: () -> Unit) {
        try {fn(); fail("Expected failure")} catch (e:BridgeFailure) {assertEquals(code,e.code); assertFalse(e.message!!.contains("SECRET"))}
    }

    @Test fun followsOneContentRedirectByGetWithoutForwardingPostBodyOrAuth() {
        val first = Fake(302,"https://script.googleusercontent.com/macros/echo?user_content_key=synthetic")
        val second = Fake(200,text="{\"synthetic\":true}")
        val targets = mutableListOf<String>()
        val transport = AppsScriptTransport {uri -> targets += uri.host; if(targets.size == 1) first else second}
        assertEquals("{\"synthetic\":true}",transport.post(endpoint,"signed synthetic body"))
        assertEquals(listOf("script.google.com","script.googleusercontent.com"),targets)
        assertEquals("POST",first.requestMethod); assertEquals("GET",second.requestMethod)
        assertEquals("signed synthetic body",first.sent.toString("UTF-8")); assertEquals(0,second.sent.size())
        assertFalse(first.instanceFollowRedirects); assertFalse(second.instanceFollowRedirects)
        assertNull(second.getRequestProperty("Authorization")); assertTrue(first.closed); assertTrue(second.closed)
    }

    @Test fun refusesLoginOrForeignRedirectBeforeAnySecondConnection() {
        for(url in listOf("https://accounts.google.com/login","https://evil.example/macros/echo?x=1")) {
            var calls=0; val first=Fake(302,url)
            expect("endpoint_access") {AppsScriptTransport {calls++;first}.post(endpoint,"synthetic")}
            assertEquals(1,calls); assertTrue(first.closed)
        }
    }

    @Test fun temporaryHttpFailuresAndTimeoutAreSingleAttemptsWithRedactedReason() {
        for(code in listOf(429,500,503)) {
            var calls=0; val first=Fake(code,text="SECRET")
            expect("http_retry") {AppsScriptTransport {calls++;first}.post(endpoint,"synthetic")}
            assertEquals(1,calls); assertTrue(first.closed)
        }
        val first=Fake(200).apply {timeout=true}
        expect("transport_error") {AppsScriptTransport {first}.post(endpoint,"synthetic")}
        assertTrue(first.closed)
    }

    @Test fun unexpectedMimeLargeResponseAndFurtherRedirectCannotBeSuccess() {
        expect("endpoint_access") {AppsScriptTransport {Fake(200,mime="text/html")}.post(endpoint,"synthetic")}
        expect("invalid_response") {AppsScriptTransport {Fake(200,text="x".repeat(32769))}.post(endpoint,"synthetic")}
        expect("endpoint_access") {AppsScriptTransport {Fake(307,"https://script.googleusercontent.com/macros/echo?x=1")}.post(endpoint,"synthetic")}
    }

    @Test fun unapprovedEndpointIsRejectedBeforeAnyConnectionAndOversizeBodyBeforeWriting() {
        var calls=0
        expect("configuration_invalid") {AppsScriptTransport {calls++;Fake(200)}.post("https://evil.example", "synthetic")}
        assertEquals(0,calls)
        val first=Fake(200)
        expect("payload_too_large") {AppsScriptTransport {first}.post(endpoint,"x".repeat(262145))}
        assertEquals(0,first.sent.size()); assertTrue(first.closed)
    }
}
