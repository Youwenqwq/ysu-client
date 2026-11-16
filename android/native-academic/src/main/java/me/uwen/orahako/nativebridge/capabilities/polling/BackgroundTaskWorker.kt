package me.uwen.orahako.nativebridge.capabilities.polling

import android.content.Context
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Generic WorkManager worker. It never knows what the task does: the input data
 * names the registered adapter and carries its opaque payload.
 */
class BackgroundTaskWorker(context: Context, params: WorkerParameters) :
    CoroutineWorker(context, params) {

    companion object {
        const val TAG = "orahako_background_task"
        const val INPUT_HANDLER_ID = "handlerId"
        const val INPUT_PAYLOAD = "payload"
        private const val LOG_TAG = "OrahakoBackgroundTask"
    }

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val handlerId = inputData.getString(INPUT_HANDLER_ID)
            ?: return@withContext Result.failure()
        val handler = try {
            BackgroundTaskDispatch.resolve(handlerId)
        } catch (error: UnknownBackgroundTaskHandlerException) {
            Log.e(LOG_TAG, "Scheduled task has no registered handler", error)
            return@withContext Result.failure()
        }
        val payload = BackgroundTaskDispatch.payload(inputData.getString(INPUT_PAYLOAD))
        try {
            when (handler.run(applicationContext, payload)) {
                BackgroundTaskResult.SUCCESS, BackgroundTaskResult.SKIPPED -> Result.success()
                BackgroundTaskResult.RETRY -> Result.retry()
            }
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            Log.e(LOG_TAG, "Background task handler failed: ${handler.id}", error)
            Result.retry()
        }
    }
}
