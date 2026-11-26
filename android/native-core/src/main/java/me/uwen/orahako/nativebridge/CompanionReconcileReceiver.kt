package me.uwen.orahako.nativebridge

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * The single generic companion reconciler.
 *
 * Instead of a receiver per feature, one system event asks the installed
 * composition to rebuild every enabled capability and let each capability
 * restore its own persisted OS state (WorkManager jobs, class alarms,
 * notification channels). Features are never referenced here by name.
 */
class CompanionReconcileReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "OrahakoCompanionReconciler"
    }

    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED,
            Intent.ACTION_MY_PACKAGE_REPLACED,
            Intent.ACTION_TIME_CHANGED,
            Intent.ACTION_TIMEZONE_CHANGED -> Unit
            else -> return
        }
        try {
            NativeComposition.reconcile(context.applicationContext)
        } catch (error: Exception) {
            Log.e(TAG, "Companion reconciliation failed after ${intent.action}", error)
        }
    }
}
