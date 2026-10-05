package com.rpos.bridge

import android.app.Activity
import android.os.Bundle
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import com.rpos.bridge.source.ExerciseReaderProvider
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

class MainActivity : Activity() {
    private lateinit var status: TextView
    private lateinit var readButton: Button
    private val readScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        status = TextView(this).apply {
            text = "Ready. Tap READ EXERCISE."
            textSize = 18f
        }

        readButton = Button(this).apply {
            text = "READ EXERCISE"
            setOnClickListener { readExercise() }
        }

        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(48, 48, 48, 48)
            addView(status)
            addView(readButton)
        }

        setContentView(layout)
    }

    private fun readExercise() {
        status.text = "Reading..."
        readButton.isEnabled = false
        readScope.launch {
            val result = runCatching {
                ExerciseReaderProvider.create(this@MainActivity)
                    .readRecentExercises(days = 30)
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
                            "Start: ${first.startTime}"
                    }
                },
                onFailure = { error ->
                    "READ FAIL · ${error::class.java.simpleName}: ${error.message}"
                }
            )
            readButton.isEnabled = true
        }
    }

    override fun onDestroy() {
        readScope.cancel()
        super.onDestroy()
    }
}
