package com.rpos.bridge

import android.app.Activity
import android.app.AlertDialog
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
import android.view.WindowManager
import android.view.inputmethod.EditorInfo
import android.text.InputType
import android.widget.EditText
import android.widget.ScrollView
import com.rpos.bridge.delivery.AndroidBridgeRuntime
import com.rpos.bridge.delivery.BridgeFailure
import com.rpos.bridge.model.ExerciseSelection
import com.rpos.bridge.source.ExerciseReaderProvider
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.Instant

class MainActivity : Activity() {
    private lateinit var status: TextView
    private lateinit var readButton: Button
    private lateinit var copyButton: Button
    private lateinit var recordPicker: Spinner
    private lateinit var sendButton: Button
    private lateinit var pendingButton: Button
    private lateinit var configureButton: Button
    private lateinit var recoveryButton: Button
    private lateinit var deliveryStatus: TextView
    private var deliveryBusy = false
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

        deliveryStatus = TextView(this).apply { text = "Delivery not configured"; textSize = 15f }
        configureButton = Button(this).apply {
            text = "CONFIGURE DELIVERY"
            setOnClickListener { configureDelivery() }
        }
        sendButton = Button(this).apply {
            text = "QUEUE SELECTED + SYNC ONE"
            isEnabled = false
            setOnClickListener { sendSelected() }
        }
        pendingButton = Button(this).apply {
            text = "CHECK PENDING RECEIPTS"
            setOnClickListener { deliveryTask { runtime ->
                runtime.checkPending()
            } }
            setOnLongClickListener {
                AlertDialog.Builder(this@MainActivity).setTitle("Backend review completed?")
                    .setMessage("Only recheck blocked receipts after reviewing the backend issue. This does not clear backend write intents or replace the original export.")
                    .setNegativeButton("Cancel", null)
                    .setPositiveButton("Reviewed: recheck") { _, _ ->
                        deliveryTask { runtime ->
                            runtime.recovery.recheckReviewedBlocked()
                            runtime.queue.recheckReviewedBlocked()
                            runtime.summary()
                        }
                    }.show()
                true
            }
        }

        recoveryButton = Button(this).apply {
            text = "TEST RECEIPT RECOVERY"
            visibility = if (ExerciseReaderProvider.SOURCE == "samsung_health") View.VISIBLE else View.GONE
            setOnClickListener {
                AlertDialog.Builder(this@MainActivity).setTitle("Test receipt recovery?")
                    .setMessage("Checks the one confirmed receipt without uploading a workout. Deliberately discards its first confirmation before saving the test result. Then restart the phone and use CHECK PENDING RECEIPTS. Your normal receipt stays confirmed.")
                    .setNegativeButton("Cancel", null)
                    .setPositiveButton("Start recovery test") { _, _ ->
                        deliveryTask { runtime ->
                            val config = runtime.config() ?: throw BridgeFailure("not_configured")
                            runtime.recovery.begin(config)
                        }
                    }.show()
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
            addView(deliveryStatus)
            addView(configureButton)
            addView(sendButton)
            addView(pendingButton)
            addView(recoveryButton)
        }

        setContentView(ScrollView(this).apply { addView(layout) })
        deliveryTask { it.summary() }
    }

    private fun readExercise() {
        status.text = "Reading..."
        selectedRecordJson = null
        selection = null
        recordPicker.isEnabled = false
        recordPicker.adapter = ArrayAdapter<String>(this, android.R.layout.simple_spinner_item, emptyList())
        copyButton.isEnabled = false
        sendButton.isEnabled = false
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
            updateSendEnabled()
        }
    }

    private fun renderSelection(index: Int) {
        selectedRecordJson = null
        copyButton.isEnabled = false
        sendButton.isEnabled = false
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
            updateSendEnabled()
        }.onFailure {
            selectedRecordJson = null
            sendButton.isEnabled = false
            status.text = "EXPORT FAIL · ${it::class.java.simpleName}"
        }
    }

    private fun updateSendEnabled() {
        sendButton.isEnabled = !deliveryBusy && selectedRecordJson != null && ExerciseReaderProvider.SOURCE == "samsung_health"
    }

    private fun deliveryTask(task: (AndroidBridgeRuntime) -> String) {
        if (deliveryBusy) return
        deliveryBusy = true
        updateSendEnabled()
        pendingButton.isEnabled = false
        configureButton.isEnabled = false
        recoveryButton.isEnabled = false
        deliveryStatus.text = "Checking private receipt state..."
        readScope.launch {
            try {
                deliveryStatus.text = withContext(Dispatchers.IO) { task(AndroidBridgeRuntime.get(this@MainActivity)) }
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) {
                val safe = if (e is BridgeFailure) e.code else "delivery_error"
                deliveryStatus.text = "DELIVERY · $safe · original receipts retained"
            } finally {
                deliveryBusy = false
                pendingButton.isEnabled = true
                configureButton.isEnabled = true
                recoveryButton.isEnabled = true
                updateSendEnabled()
            }
        }
    }

    private fun sendSelected() {
        val json = selectedRecordJson ?: return
        deliveryTask { runtime ->
            if (runtime.recovery.active()) throw BridgeFailure("recovery_pending")
            runtime.queue.enqueue(json)
            val config = runtime.config() ?: throw BridgeFailure("not_configured")
            runtime.queue.sendDue(config, max = 1)
        }
    }

    private fun configureDelivery() {
        // Protect only credential entry; existing read/copy evidence workflow is preserved.
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        val endpoint = EditText(this).apply {
            hint = "Approved Apps Script /exec URL"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            isSaveEnabled = false
            importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS
            imeOptions = imeOptions or EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING
        }
        val secret = EditText(this).apply {
            hint = "Private 64-character signing key"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            isSaveEnabled = false
            importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS
            imeOptions = imeOptions or EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING
        }
        val form = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; setPadding(32, 16, 32, 16)
            addView(endpoint); addView(secret)
        }
        val dialog = AlertDialog.Builder(this).setTitle("Private delivery setup")
            .setMessage("Use the approved deployed endpoint and dedicated Bridge key. Do not enter Notion or IFTTT credentials. Queue is preserved.")
            .setView(form).setNegativeButton("Cancel", null)
            .setPositiveButton("Save privately") { _, _ ->
                val url = endpoint.text.toString().trim()
                val key = secret.text.toString().trim()
                secret.text.clear(); endpoint.text.clear()
                deliveryTask { runtime -> runtime.configure(url, key); "Private setup saved · " + runtime.queue.summary() }
            }.create()
        dialog.setOnDismissListener {
            secret.text.clear(); endpoint.text.clear()
            window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
        }
        dialog.show()
        dialog.window?.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
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
