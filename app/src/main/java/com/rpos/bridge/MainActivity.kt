package com.rpos.bridge

import android.app.Activity
import android.os.Bundle
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import com.rpos.bridge.source.ExerciseReaderProvider
import kotlinx.coroutines.runBlocking
import kotlin.concurrent.thread

class MainActivity : Activity() {
    private lateinit var status: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        status = TextView(this).apply {
            text = "Ready. Tap READ EXERCISE."
            textSize = 18f
        }

        val button = Button(this).apply {
            text = "READ EXERCISE"
            setOnClickListener { readExercise() }
        }

        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(48, 48, 48, 48)
            addView(status)
            addView(button)
        }

        setContentView(layout)
    }

    private fun readExercise() {
        status.text = "Reading..."
        thread(name = "rpos-exercise-read") {
            val result = runCatching {
                runBlocking {
                    ExerciseReaderProvider.create(this@MainActivity)
                        .readRecentExercises(days = 30)
                }
            }

            runOnUiThread {
                status.text = result.fold(
                    onSuccess = { records ->
                        if (records.isEmpty()) {
                            "READ PASS · 0 Exercise records"
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
            }
        }
    }
}
