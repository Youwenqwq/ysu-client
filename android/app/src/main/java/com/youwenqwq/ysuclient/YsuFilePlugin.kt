package com.youwenqwq.ysuclient

import android.Manifest
import android.content.ContentValues
import android.content.Intent
import android.content.pm.PackageManager
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL

@CapacitorPlugin(
    name = "YsuFile",
    permissions = [
        Permission(
            strings = [Manifest.permission.WRITE_EXTERNAL_STORAGE],
            alias = "storage"
        )
    ]
)
class YsuFilePlugin : Plugin() {

    companion object {
        private const val APK_DIR_NAME = "ysu_apk_update"
        private const val GALLERY_DIR_NAME = "skbird"
    }

    private fun getApkDir(): File? {
        val parent = context.externalCacheDir ?: return null
        val dir = File(parent, APK_DIR_NAME)
        if (!dir.exists()) dir.mkdirs()
        return dir
    }

    @PluginMethod
    fun downloadApk(call: PluginCall) {
        val urlStr = call.getString("url") ?: return call.reject("Missing url")
        val fileName = call.getString("fileName") ?: "app-update.apk"

        val dir = getApkDir()
        if (dir == null) {
            call.reject("External storage unavailable")
            return
        }

        // 清理旧 APK 文件
        dir.listFiles()?.filter { it.extension == "apk" }?.forEach { it.delete() }

        val dest = File(dir, fileName)

        // 在后台线程执行下载
        Thread {
            var conn: HttpURLConnection? = null
            try {
                val url = URL(urlStr)
                conn = url.openConnection() as HttpURLConnection
                conn.connectTimeout = 15000
                conn.readTimeout = 15000
                conn.connect()

                if (conn.responseCode != HttpURLConnection.HTTP_OK) {
                    call.reject("HTTP ${conn.responseCode}")
                    return@Thread
                }

                val total = conn.contentLength
                var downloaded = 0
                var lastPercent = -1

                conn.inputStream.use { input ->
                    FileOutputStream(dest).use { output ->
                        val buffer = ByteArray(65536)
                        var read: Int
                        while (input.read(buffer).also { read = it } != -1) {
                            output.write(buffer, 0, read)
                            downloaded += read
                            if (total > 0) {
                                val percent = (downloaded * 100 / total)
                                if (percent != lastPercent) {
                                    lastPercent = percent
                                    val data = JSObject().put("percent", percent)
                                    notifyListeners("downloadProgress", data)
                                }
                            }
                        }
                    }
                }

                val result = JSObject().put("path", dest.absolutePath)
                call.resolve(result)
            } catch (e: Exception) {
                dest.delete() // 清理部分下载的文件
                call.reject("Download failed: ${e.message}", e)
            } finally {
                conn?.disconnect()
            }
        }.start()
    }

    @PluginMethod
    fun installApk(call: PluginCall) {
        val path = call.getString("path") ?: return call.reject("Missing path")
        val file = File(path)
        if (!file.exists()) {
            call.reject("APK file not found")
            return
        }

        try {
            val uri = FileProvider.getUriForFile(
                context,
                "${context.packageName}.fileprovider",
                file
            )

            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }

            context.startActivity(intent)
            call.resolve()
        } catch (e: Exception) {
            call.reject("Install failed: ${e.message}", e)
        }
    }

    @PluginMethod
    fun clearDirectory(call: PluginCall) {
        val dir = getApkDir()
        if (dir == null) {
            call.reject("External storage unavailable")
            return
        }
        dir.listFiles()?.forEach { it.delete() }
        call.resolve()
    }

    // ─── Gallery image save (长按保存图片) ────────────────────────────────

    private class ImagePayload(val bytes: ByteArray, val mimeType: String, val displayName: String)

    /**
     * 将 base64 图片保存到系统相册（Pictures/skbird）。
     * API 29+ 走 MediaStore 受限插入，无需存储权限；旧版本写入公共 Pictures
     * 目录并触发媒体扫描，需要 WRITE_EXTERNAL_STORAGE 运行时权限。
     */
    @PluginMethod
    fun saveImageToGallery(call: PluginCall) {
        val payload = decodeImageCall(call) ?: return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            saveViaMediaStore(call, payload)
        } else if (hasLegacyWritePermission()) {
            saveViaLegacyStorage(call, payload)
        } else {
            requestPermissionForAlias("storage", call, "storagePermissionCallback")
        }
    }

    @PermissionCallback
    fun storagePermissionCallback(call: PluginCall) {
        if (!hasLegacyWritePermission()) {
            call.reject("Storage permission denied")
            return
        }
        val payload = decodeImageCall(call) ?: return
        saveViaLegacyStorage(call, payload)
    }

    private fun decodeImageCall(call: PluginCall): ImagePayload? {
        val base64 = call.getString("base64")
        if (base64.isNullOrEmpty()) {
            call.reject("base64 is required")
            return null
        }
        val mimeType = call.getString("mimeType") ?: "image/jpeg"
        val displayName = call.getString("fileName")
            ?: "skbird_${System.currentTimeMillis()}." + extensionOf(mimeType)
        return try {
            ImagePayload(Base64.decode(base64, Base64.DEFAULT), mimeType, displayName)
        } catch (e: IllegalArgumentException) {
            call.reject("Invalid base64 payload", e)
            null
        }
    }

    private fun hasLegacyWritePermission(): Boolean =
        ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.WRITE_EXTERNAL_STORAGE
        ) == PackageManager.PERMISSION_GRANTED

    private fun saveViaMediaStore(call: PluginCall, payload: ImagePayload) {
        try {
            val resolver = context.contentResolver
            val values = ContentValues().apply {
                put(MediaStore.Images.Media.DISPLAY_NAME, payload.displayName)
                put(MediaStore.Images.Media.MIME_TYPE, payload.mimeType)
                put(
                    MediaStore.Images.Media.RELATIVE_PATH,
                    Environment.DIRECTORY_PICTURES + "/" + GALLERY_DIR_NAME
                )
                put(MediaStore.Images.Media.IS_PENDING, 1)
            }
            val uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
                ?: throw IllegalStateException("MediaStore insert returned null")
            val stream = resolver.openOutputStream(uri)
            if (stream == null) {
                resolver.delete(uri, null, null)
                throw IllegalStateException("Cannot open output stream for $uri")
            }
            stream.use { it.write(payload.bytes) }
            resolver.update(
                uri,
                ContentValues().apply { put(MediaStore.Images.Media.IS_PENDING, 0) },
                null,
                null
            )
            call.resolve(JSObject().put("uri", uri.toString()))
        } catch (e: Exception) {
            call.reject("Failed to save image", e)
        }
    }

    private fun saveViaLegacyStorage(call: PluginCall, payload: ImagePayload) {
        try {
            val dir = File(
                Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES),
                GALLERY_DIR_NAME
            )
            if (!dir.exists() && !dir.mkdirs()) {
                throw IllegalStateException("Cannot create directory ${dir.absolutePath}")
            }
            val file = File(dir, payload.displayName)
            FileOutputStream(file).use { it.write(payload.bytes) }
            MediaScannerConnection.scanFile(
                context,
                arrayOf(file.absolutePath),
                arrayOf(payload.mimeType),
                null
            )
            call.resolve(JSObject().put("uri", Uri.fromFile(file).toString()))
        } catch (e: Exception) {
            call.reject("Failed to save image", e)
        }
    }

    private fun extensionOf(mimeType: String): String {
        val sub = mimeType.substringAfter('/', "").lowercase()
        return when (sub) {
            "", "jpeg" -> "jpg"
            "svg+xml" -> "svg"
            else -> sub
        }
    }
}
