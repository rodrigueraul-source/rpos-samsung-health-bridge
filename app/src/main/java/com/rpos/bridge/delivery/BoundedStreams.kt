package com.rpos.bridge.delivery

import java.io.InputStream
import java.io.ByteArrayOutputStream

object BoundedStreams {
    // InputStream.readNBytes is not available on every supported Android API.
    fun read(input: InputStream, maximum: Int): ByteArray {
        val output = ByteArrayOutputStream()
        val buffer = ByteArray(4096)
        while (output.size() <= maximum) {
            val count = input.read(buffer, 0, minOf(buffer.size, maximum + 1 - output.size()))
            if (count < 0) break
            if (count == 0) continue
            output.write(buffer, 0, count)
        }
        return output.toByteArray()
    }
}
