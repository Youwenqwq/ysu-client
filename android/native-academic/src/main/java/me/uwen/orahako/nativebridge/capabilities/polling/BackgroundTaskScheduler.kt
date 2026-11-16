package me.uwen.orahako.nativebridge.capabilities.polling

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.workDataOf
import java.util.concurrent.TimeUnit

/** One persisted polling task, reduced to what WorkManager needs. */
data class BackgroundTaskSpec(
    val handlerId: String,
    val workName: String,
    val tag: String,
    val intervalMinutes: Long,
    val payloadJson: String,
    val requiresNetwork: Boolean = true,
)

/** Scheduling seam so the polling capability is testable without WorkManager. */
interface BackgroundTaskScheduler {
    fun schedulePeriodic(spec: BackgroundTaskSpec)
    fun scheduleOnce(spec: BackgroundTaskSpec)
    fun cancel(workName: String, tag: String)
}

class WorkManagerBackgroundTaskScheduler(context: Context) : BackgroundTaskScheduler {

    private val workManager = WorkManager.getInstance(context.applicationContext)

    override fun schedulePeriodic(spec: BackgroundTaskSpec) {
        val request = PeriodicWorkRequestBuilder<BackgroundTaskWorker>(
            spec.intervalMinutes,
            TimeUnit.MINUTES,
        )
            .setInitialDelay(spec.intervalMinutes, TimeUnit.MINUTES)
            .setConstraints(constraints(spec))
            .setInputData(inputData(spec))
            .addTag(BackgroundTaskWorker.TAG)
            .addTag(spec.tag)
            .build()
        workManager.enqueueUniquePeriodicWork(
            spec.workName,
            ExistingPeriodicWorkPolicy.UPDATE,
            request,
        )
    }

    override fun scheduleOnce(spec: BackgroundTaskSpec) {
        val request = OneTimeWorkRequestBuilder<BackgroundTaskWorker>()
            .setConstraints(constraints(spec))
            .setInputData(inputData(spec))
            .addTag(BackgroundTaskWorker.TAG)
            .addTag(spec.tag)
            .build()
        workManager.enqueueUniqueWork(
            immediateWorkName(spec.workName),
            ExistingWorkPolicy.KEEP,
            request,
        )
    }

    override fun cancel(workName: String, tag: String) {
        workManager.cancelUniqueWork(workName)
        workManager.cancelUniqueWork(immediateWorkName(workName))
        workManager.cancelAllWorkByTag(tag)
    }

    private fun constraints(spec: BackgroundTaskSpec): Constraints =
        Constraints.Builder()
            .setRequiredNetworkType(
                if (spec.requiresNetwork) NetworkType.CONNECTED else NetworkType.NOT_REQUIRED
            )
            .build()

    private fun inputData(spec: BackgroundTaskSpec) = workDataOf(
        BackgroundTaskWorker.INPUT_HANDLER_ID to spec.handlerId,
        BackgroundTaskWorker.INPUT_PAYLOAD to spec.payloadJson,
    )

    private fun immediateWorkName(workName: String) = "$workName:once"
}
