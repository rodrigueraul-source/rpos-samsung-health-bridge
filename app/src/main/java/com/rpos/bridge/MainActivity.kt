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
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.LinearLayout
import android.widget.Spinner
import android.widget.TextView
import android.widget.Toast
import android.view.View
import com.rpos.bridge.model.ExerciseSelection
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
    private lateinit var recordPicker: Spinner
    private var selection: ExerciseSelection? = null
    private var selectedRecordJson: String? = null
    private val readScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        status = TextView(this).apply {
            text = "R-POS Bridge ${BuildConfig.VERSION_NAME}\nReady. Tap READ EXERCISE."
            textSize = 18f
        }

        readButton = Button(this).apply {
            text = "READ EXERCISE"
            setOnClickListener { readExercise() }
        }

        copyButton = Button(this).apply {
            text = "COPY SELECTED JSON"
            isEnabled = false
            setOnClickListener { copySelectedRecord() }
        }

        recordPicker = Spinner(this).apply {
            isEnabled = false
            onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
                override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) {
                    if (selection != null) renderSelection(position)
                }
                override fun onNothingSelected(parent: AdapterView<*>?) = Unit
            }
        }

        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(48, 48, 48, 48)
            addView(status)
            addView(readButton)
            addView(recordPicker)
            addView(copyButton)
        }

        setContentView(layout)
    }

    private fun readExercise() {
        status.text = "Reading..."
        selectedRecordJson = null
        selection = null
        recordPicker.isEnabled = false
        recordPicker.adapter = ArrayAdapter<String>(this, android.R.layout.simple_spinner_item, emptyList())
        copyButton.isEnabled = false
        readButton.isEnabled = false
        readScope.launch {
            val result = runCatching {
                ExerciseReaderProvider.create(this@MainActivity)
                    .readRecentExercises(days = 30)
                    .let { records ->
                        // Build the export inside the same error boundary as the read.
                        ExerciseSelection(records, ExerciseReaderProvider.SOURCE, Instant.now().toString())
                    }
            }.onFailure { if (it is CancellationException) throw it }
            result.fold(
                onSuccess = { batch ->
                    selection = batch
                    if (batch.count == 0) {
                        status.text = "NO DATA · no Exercise records in the last 30 days"
                    } else {
                        recordPicker.adapter = ArrayAdapter(this@MainActivity,
                            android.R.layout.simple_spinner_item, batch.labels).apply {
                            setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item)
                        }
                        recordPicker.isEnabled = true
                        renderSelection(0)
                    }
                },
                onFailure = { error ->
                    status.text = "READ FAIL · ${error::class.java.simpleName}: ${error.message}"
                }
            )
            readButton.isEnabled = true
            copyButton.isEnabled = selectedRecordJson != null
        }
    }

    private fun renderSelection(index: Int) {
        selectedRecordJson = null
        copyButton.isEnabled = false
        val batch = selection ?: return
        runCatching {
            batch.select(index)
            selectedRecordJson = batch.toJson()
            val record = batch.selectedRecord ?: return
            status.text = "READ PASS · ${batch.count} records\n" +
                "Selected: ${index + 1}/${batch.count}\n" +
                "UID: ${record.sourceRecordId}\n" +
                "Title: ${record.customTitle ?: record.exerciseType}\n" +
                "Type: ${record.exerciseType}\nStart: ${record.startTime}\n" +
                "Sessions: ${record.sessions?.size ?: 0}\n" +
                "Choose a record, then COPY SELECTED JSON."
            copyButton.isEnabled = selectedRecordJson != null
        }.onFailure {
            selectedRecordJson = null
            status.text = "EXPORT FAIL · ${it::class.java.simpleName}"
        }
    }

    private fun copySelectedRecord() {
        val json = selectedRecordJson ?: return
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
