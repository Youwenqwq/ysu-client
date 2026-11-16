package me.uwen.orahako.notify

import android.content.Context
import me.uwen.orahako.nativebridge.NativeCapabilityState
import me.uwen.orahako.nativebridge.NativeStateStore

/**
 * Persisted class reminder configuration, owned by `reminders.classes`.
 *
 * The alarm list is the desired state: it is restored after reboot or clock
 * changes and dropped when the user disables class reminders.
 */
internal object ClassReminderState {
    private const val KEY_ALARMS = "alarms"

    private fun store(context: Context): NativeStateStore =
        NativeCapabilityState(context, ClassRemindersCapability.ID)

    fun alarmsJson(context: Context): String = store(context).getString(KEY_ALARMS, "[]")

    fun save(context: Context, alarmsJson: String) {
        store(context).putString(KEY_ALARMS, alarmsJson)
    }

    fun clear(context: Context) {
        store(context).remove(KEY_ALARMS)
    }
}
