package com.rpos.bridge

import android.app.Activity
import android.content.ClipData
import android.content.ClipDescription
import android.content.ClipboardManager
import android.content.Context
import android.os.Build
import android.os.Bundle
import android.os.PersistableBundle
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import com.rpos.bridge.model.ExerciseExport
import com.rpos.bridge.source.ExerciseReaderProvider
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import java.time.Instant

class MainActivity : Activity() {
    private lateinit var status: TextView
    private lateinit var readButton: Button
    private lateinit var copyButton: Button
    private var firstRecordJson: String? = null
    private val readScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        status = TextView(this).apply {
            text = "R-POS Bridge 0.3.0\nReady. Tap READ EXERCISE."
            textSize = 18f
        }

        readButton = Button(this).apply {
            text = "READ EXERCISE"
            setOnClickListener { readExercise() }
        }

        copyButton = Button(this).apply {
            text = "COPY FIRST JSON"
            isEnabled = false
            setOnClickListener { copyFirstRecord() }
        }

        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(48, 48, 48, 48)
            addView(status)
            addView(readButton)
            addView(copyButton)
        }

        setContentView(layout)
    }

    private fun readExercise() {
        status.text = "Reading..."
        firstRecordJson = null
        copyButton.isEnabled = false
        readButton.isEnabled = false
        readScope.launch {
            val result = runCatching {
                ExerciseReaderProvider.create(this@MainActivity)
                    .readRecentExercises(days = 30)
                    .let { records ->
                        // Build the export inside the same error boundary as the read.
                        firstRecordJson = records.firstOrNull()?.let { first ->
                            ExerciseExport.toJson(
                                first, ExerciseReaderProvider.SOURCE,
                                Instant.now().toString(), records.size
                            )
                        }
                        records
                    }
            }.onFailure { if (it is CancellationException) throw it }
            status.text = result.fold(
                onSuccess = { records ->
                    if (records.isEmpty()) {
                        "NO DATA · real Exercise READ gate remains open"
                    } else {
                        val first = records.first()
                        "READ PASS · ${records.size} records\n" +
                            "UID: ${first.sourceRecordId}\n" +
                            "Type: ${first.exerciseType}\n" +
                            "Start: ${first.startTime}\n" +
                            "Sessions: ${first.sessions?.size ?: 0}\n" +
                            "Tap COPY FIRST JSON and paste into the chat."
                    }
                },
                onFailure = { error ->
                    "READ FAIL · ${error::class.java.simpleName}: ${error.message}"
                }
            )
            readButton.isEnabled = true
            copyButton.isEnabled = firstRecordJson != null
        }
    }

    private fun copyFirstRecord() {
        val json = firstRecordJson ?: return
        val clip = ClipData.newPlainText("R-POS Exercise record", json)
        if (Build.VERSION.SDK_INT >= 33) {
            clip.description.extras = PersistableBundle().apply {
                putBoolean(ClipDescription.EXTRA_IS_SENSITIVE, true)
            }
        }
        (getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(clip)
        Toast.makeText(this, "JSON copied. Paste into the chat.", Toast.LENGTH_SHORT).show()
    }

    override fun onDestroy() {
        readScope.cancel()
        super.onDestroy()
    }
}
