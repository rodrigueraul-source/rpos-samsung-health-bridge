package com.rpos.bridge.model

/** Selection belongs to one fresh read; changing rows preserves its provenance. */
class ExerciseSelection(
    records: List<RposExercise>,
    private val source: String,
    private val readAt: String
) {
    private val records = records.toList()
    var selectedIndex: Int = if (records.isEmpty()) -1 else 0
        private set

    init {
        require(records.all { it.sourceRecordId.isNotBlank() }) { "Missing original UID" }
        require(records.map { it.sourceRecordId }.distinct().size == records.size) {
            "Duplicate UID in read result"
        }
    }

    val count: Int get() = records.size
    val selectedRecord: RposExercise? get() = records.getOrNull(selectedIndex)
    val labels: List<String> get() = records.map {
        "${it.startTime} · ${it.customTitle ?: it.exerciseType} · ${it.sourceRecordId.takeLast(8)}"
    }

    fun select(index: Int) {
        require(index in records.indices) { "Record selection is out of range" }
        selectedIndex = index
    }

    fun toJson(): String? = selectedRecord?.let {
        ExerciseExport.toJson(it, source, readAt, count)
    }
}
