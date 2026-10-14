package com.rpos.bridge.delivery

import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context
import com.rpos.bridge.source.ExerciseReaderProvider
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout
import java.time.Instant

/** OS-scheduled work, never an Activity or permission popup in the background. */
class AutomaticSyncJob : JobService() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var run: Job? = null
    override fun onStartJob(params: JobParameters): Boolean {
        run = scope.launch {
            try {
                withTimeout(120000) {
                    val runtime = AndroidBridgeRuntime.get(this@AutomaticSyncJob)
                    if (runtime.automaticPolicy()?.enabled == true) {
                        val records = ExerciseReaderProvider.createBackground(applicationContext)
                            .readRecentExercises(30)
                        runtime.synchronizeAutomatic(records, Instant.now())
                    }
                }
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) {
                // No exception message, export, credential or UID is logged.
                try { AndroidBridgeRuntime.get(this@AutomaticSyncJob).automaticResult(
                    if (e is BridgeFailure) e.code else "automatic_read_failed") }
                catch (_: Exception) { /* Locked private storage stays locked. */ }
            } finally { jobFinished(params, false) }
        }
        return true
    }
    override fun onStopJob(params: JobParameters): Boolean { run?.cancel(); return true }
    override fun onDestroy() { scope.cancel(); super.onDestroy() }

    companion object {
        private const val JOB_ID = 7011
        fun schedule(context: Context) {
            val scheduler = context.getSystemService(JobScheduler::class.java)
            val info = JobInfo.Builder(JOB_ID, ComponentName(context, AutomaticSyncJob::class.java))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setPeriodic(15 * 60 * 1000L).setPersisted(true).build()
            if (scheduler.schedule(info) != JobScheduler.RESULT_SUCCESS) {
                throw BridgeFailure("automatic_schedule_failed")
            }
        }
        fun pause(context: Context) { context.getSystemService(JobScheduler::class.java).cancel(JOB_ID) }
    }
}
