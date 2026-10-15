package com.rpos.bridge.delivery

import com.rpos.bridge.model.ExerciseExport
import com.rpos.bridge.model.ExerciseSelection
import com.rpos.bridge.model.RposExercise
import java.time.Instant

/** An explicit, immutable cutover. Pausing never resets it or imports history. */
data class AutomaticPolicy(val enabled: Boolean, val startAt: String,
                           val baselineUids: List<String>, val lastResult: String = "ready")

object AutomaticAcquisition {
    /** Preserve the first queued export while still advancing unrelated records and ACKs. */
    fun synchronize(queue: BridgeQueue, config: BridgeConfig, payloads: List<String>): String {
        var changed = false
        payloads.forEach { payload ->
            try { queue.enqueue(payload) }
            catch (error: BridgeFailure) {
                if (error.code != "record_changed") throw error
                // A newer SDK version under this UID requires review, never replacement.
                changed = true
            }
        }
        queue.sendDue(config, max = 3)
        return if (changed) "completed_with_record_changes" else "completed"
    }

    fun baseline(records: List<RposExercise>, now: Instant): AutomaticPolicy {
        ExerciseSelection(records, "samsung_health", now.toString()) // Validate original identities.
        if (records.size > 1000) throw BridgeFailure("automatic_baseline_too_large")
        return AutomaticPolicy(true, now.toString(), records.map { it.sourceRecordId })
    }

    fun payloads(policy: AutomaticPolicy, records: List<RposExercise>, now: Instant): List<String> {
        if (!policy.enabled) return emptyList()
        val start = try { Instant.parse(policy.startAt) }
            catch (_: Exception) { throw BridgeFailure("automatic_storage_error") }
        if (start > now || policy.baselineUids.size > 1000 ||
            policy.baselineUids.distinct().size != policy.baselineUids.size ||
            policy.baselineUids.any { it.isBlank() }) throw BridgeFailure("automatic_storage_error")
        ExerciseSelection(records, "samsung_health", now.toString())
        val settled = now.minusSeconds(120)
        return records.filter { r ->
            if (r.sourceRecordId in policy.baselineUids) false else {
                try {
                    val begins = Instant.parse(r.startTime)
                    val ends = r.endTime?.let { Instant.parse(it) }
                    val updated = r.updateTime?.let { Instant.parse(it) }
                    begins >= start && ends != null && ends >= begins && ends <= settled &&
                        (updated == null || updated <= settled)
                } catch (_: Exception) { throw BridgeFailure("automatic_record_invalid") }
            }
        }.sortedWith(compareBy<RposExercise> { Instant.parse(it.startTime) }
            .thenBy { it.sourceRecordId }).map {
            ExerciseExport.toJson(it, "samsung_health", now.toString(), records.size)
        }
    }
}
