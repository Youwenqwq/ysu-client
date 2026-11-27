package me.uwen.orahako.nativebridge.capabilities.background

import android.content.Context
import android.util.Log
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.Data
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import me.uwen.orahako.nativebridge.NativeCapabilityState
import java.util.concurrent.TimeUnit

data class BackgroundScheduleSpec(
    val taskId: String,
    val workName: String,
    val tag: String,
    val intervalMinutes: Long,
    val requiresNetwork: Boolean,
)

interface BackgroundWorkScheduler {
    fun schedulePeriodic(spec: BackgroundScheduleSpec)
    fun scheduleOnce(spec: BackgroundScheduleSpec)
    fun cancel(workName: String, tag: String)
}

internal class WorkManagerBackgroundWorkScheduler(context: Context) : BackgroundWorkScheduler {
    private val appContext = context.applicationContext

    override fun schedulePeriodic(spec: BackgroundScheduleSpec) {
        val request = PeriodicWorkRequestBuilder<BackgroundJsWorker>(
            spec.intervalMinutes,
            TimeUnit.MINUTES,
        )
            .setConstraints(constraints(spec.requiresNetwork))
            .setInputData(inputData(spec.taskId))
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 5, TimeUnit.MINUTES)
            .addTag(spec.tag)
            .addTag(BackgroundJsWorker.TAG)
            .build()
        WorkManager.getInstance(appContext).enqueueUniquePeriodicWork(
            spec.workName,
            ExistingPeriodicWorkPolicy.UPDATE,
            request,
        )
    }

    override fun scheduleOnce(spec: BackgroundScheduleSpec) {
        val request = OneTimeWorkRequestBuilder<BackgroundJsWorker>()
            .setConstraints(constraints(spec.requiresNetwork))
            .setInputData(inputData(spec.taskId))
            .addTag(spec.tag)
            .addTag(BackgroundJsWorker.TAG)
            .build()
        WorkManager.getInstance(appContext).enqueue(request)
    }

    override fun cancel(workName: String, tag: String) {
        val wm = WorkManager.getInstance(appContext)
        wm.cancelUniqueWork(workName)
        wm.cancelAllWorkByTag(tag)
    }

    private fun constraints(requiresNetwork: Boolean): Constraints = Constraints.Builder().apply {
        if (requiresNetwork) setRequiredNetworkType(NetworkType.CONNECTED)
    }.build()

    private fun inputData(taskId: String): Data = Data.Builder()
        .putString(BackgroundJsWorker.INPUT_TASK_ID, taskId)
        .build()
}

/**
 * Generic WorkManager worker that executes any plugin-registered JS background
 * task inside an isolated QuickJS runtime.
 */
class BackgroundJsWorker(context: Context, params: WorkerParameters) :
    CoroutineWorker(context, params) {

    companion object {
        const val TAG = "orahako_background_js"
        const val INPUT_TASK_ID = "taskId"
        private const val LOG_TAG = "OrahakoBackgroundJsWorker"
    }

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val taskId = inputData.getString(INPUT_TASK_ID) ?: return@withContext Result.failure()
        val stateStore = NativeCapabilityState(applicationContext, BackgroundTasksCapability.ID)
        val task = BackgroundTaskStore.load(stateStore, taskId)
            ?: return@withContext Result.success()
        if (!task.enabled) return@withContext Result.success()

        val scriptStorage = FileBackgroundScriptStorage(applicationContext)
        val script = scriptStorage.loadScript(taskId)
        if (script.isNullOrBlank()) {
            Log.w(LOG_TAG, "Missing background script for task $taskId")
            return@withContext Result.failure()
        }

        val bridge = AndroidBackgroundHostBridge(
            context = applicationContext,
            pluginId = task.pluginId,
            onDiagnostics = { diagJson ->
                BackgroundTaskStore.saveDiagnostics(stateStore, taskId, diagJson)
            },
        )

        try {
            when (
                BackgroundJsRuntime.execute(
                    pluginId = task.pluginId,
                    taskId = task.taskId,
                    script = script,
                    payloadJson = task.payload.toString(),
                    bridge = bridge,
                    timeoutMs = task.timeoutMs,
                )
            ) {
                BackgroundExecutionOutcome.SUCCESS, BackgroundExecutionOutcome.SKIPPED -> Result.success()
                BackgroundExecutionOutcome.RETRY -> Result.retry()
            }
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            Log.e(LOG_TAG, "QuickJS background task failed: ${task.taskId}", error)
            Result.retry()
        }
    }
}
