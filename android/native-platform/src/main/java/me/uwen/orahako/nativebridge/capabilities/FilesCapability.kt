package me.uwen.orahako.nativebridge.capabilities

import android.Manifest
import android.content.ContentValues
import android.content.Intent
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import androidx.core.content.FileProvider
import me.uwen.orahako.nativebridge.NativeCapability
import me.uwen.orahako.nativebridge.NativeCapabilityBinding
import me.uwen.orahako.nativebridge.NativeCapabilityHost
import me.uwen.orahako.nativebridge.NativeInvokeResult
import me.uwen.orahako.nativebridge.requiredString
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL

/**
 * APK cache management, installer hand-off and gallery export.
 *
 * Filesystem locations are composition choices (`apkDirectory`,
 * `galleryDirectory`) rather than hardcoded app paths.
 */
class FilesCapability(
    private val host: NativeCapabilityHost,
    override val config: Map<String, Any?>,
) : NativeCapability {

    override val id: String = ID
    override val version: Int = 1
    override val methods: Set<String> = setOf(
        "downloadApk",
        "installApk",
        "clearDirectory",
        "saveImageToGallery",
        "exportTextFile",
    )

    private val apkDirectory: String = config.requiredString("apkDirectory")
    private val galleryDirectory: String = config.requiredString("galleryDirectory")
    private val fileNamePrefix: String = config.requiredString("fileNamePrefix")

    override fun bind(): NativeCapabilityBinding = Binding()

    private inner class Binding : NativeCapabilityBinding {
        override fun invoke(
            method: String,
            payload: Map<String, Any?>,
            result: NativeInvokeResult,
        ) {
            when (method) {
                "downloadApk" -> downloadApk(payload, result)
                "installApk" -> installApk(payload, result)
                "clearDirectory" -> clearDirectory(result)
                "saveImageToGallery" -> saveImageToGallery(payload, result)
                "exportTextFile" -> exportTextFile(payload, result)
            }
        }

        override fun release() = Unit
    }

    private fun getApkDirectory(): File? {
        val parent = host.context.externalCacheDir ?: return null
        val directory = File(parent, apkDirectory)
        if (!directory.exists()) directory.mkdirs()
        return directory
    }

    private fun downloadApk(payload: Map<String, Any?>, result: NativeInvokeResult) {
        val url = payload["url"] as? String
        if (url.isNullOrBlank()) {
            result.reject("Missing url")
            return
        }
        val fileName = payload["fileName"] as? String ?: DEFAULT_APK_NAME

        val directory = getApkDirectory()
        if (directory == null) {
            result.reject("External storage unavailable")
            return
        }

        directory.listFiles()?.filter { it.extension == "apk" }?.forEach { it.delete() }
        val destination = File(directory, fileName)

        Thread {
            var connection: HttpURLConnection? = null
            try {
                connection = URL(url).openConnection() as HttpURLConnection
                connection.connectTimeout = 15000
                connection.readTimeout = 15000
                connection.connect()

                if (connection.responseCode != HttpURLConnection.HTTP_OK) {
                    result.reject("HTTP ${connection.responseCode}")
                    return@Thread
                }

                val total = connection.contentLength.toLong()
                var downloaded = 0L
                var lastPercent = -1

                connection.inputStream.use { input ->
                    FileOutputStream(destination).use { output ->
                        val buffer = ByteArray(65536)
                        var read: Int
                        while (input.read(buffer).also { read = it } != -1) {
                            output.write(buffer, 0, read)
                            downloaded += read
                            if (total > 0) {
                                val percent = (downloaded * 100 / total).toInt()
                                if (percent != lastPercent) {
                                    lastPercent = percent
                                    host.emit(id, "downloadProgress", mapOf("percent" to percent))
                                }
                            }
                        }
                    }
                }

                result.resolve(mapOf("path" to destination.absolutePath))
            } catch (error: Exception) {
                destination.delete()
                result.reject("Download failed: ${error.message}", error)
            } finally {
                connection?.disconnect()
            }
        }.start()
    }

    private fun installApk(payload: Map<String, Any?>, result: NativeInvokeResult) {
        val path = payload["path"] as? String
        if (path.isNullOrBlank()) {
            result.reject("Missing path")
            return
        }
        val file = File(path)
        if (!file.exists()) {
            result.reject("APK file not found")
            return
        }

        try {
            val uri = FileProvider.getUriForFile(
                host.context,
                "${host.context.packageName}.fileprovider",
                file,
            )
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            host.context.startActivity(intent)
            result.resolve(null)
        } catch (error: Exception) {
            result.reject("Install failed: ${error.message}", error)
        }
    }

    private fun clearDirectory(result: NativeInvokeResult) {
        val directory = getApkDirectory()
        if (directory == null) {
            result.reject("External storage unavailable")
            return
        }
        directory.listFiles()?.forEach { it.delete() }
        result.resolve(null)
    }

    // ─── Gallery image save ─────────────────────────────────────────────── //

    private class ImagePayload(
        val bytes: ByteArray,
        val mimeType: String,
        val displayName: String,
    )

    /**
     * API 29+ uses scoped MediaStore insertion and needs no permission. Older
     * releases write to the public Pictures directory and require
     * WRITE_EXTERNAL_STORAGE, requested through the mounted bridge.
     */
    private fun saveImageToGallery(payload: Map<String, Any?>, result: NativeInvokeResult) {
        val image = decodeImage(payload, result) ?: return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            saveViaMediaStore(image, result)
        } else if (hasLegacyWritePermission()) {
            saveViaLegacyStorage(image, result)
        } else {
            requestLegacyWritePermission { granted ->
                if (granted || hasLegacyWritePermission()) {
                    saveViaLegacyStorage(image, result)
                } else {
                    result.reject("Storage permission denied")
                }
            }
        }
    }

    private fun decodeImage(payload: Map<String, Any?>, result: NativeInvokeResult): ImagePayload? {
        val base64 = payload["base64"] as? String
        if (base64.isNullOrEmpty()) {
            result.reject("base64 is required")
            return null
        }
        val mimeType = payload["mimeType"] as? String ?: "image/jpeg"
        val displayName = payload["fileName"] as? String
            ?: "${fileNamePrefix}_${System.currentTimeMillis()}." + extensionOf(mimeType)
        return try {
            ImagePayload(Base64.decode(base64, Base64.DEFAULT), mimeType, displayName)
        } catch (error: IllegalArgumentException) {
            result.reject("Invalid base64 payload", error)
            null
        }
    }

    private fun hasLegacyWritePermission(): Boolean =
        host.hasPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE)

    private fun requestLegacyWritePermission(onResult: (Boolean) -> Unit) {
        try {
            host.requestPermissions(
                arrayOf(Manifest.permission.WRITE_EXTERNAL_STORAGE),
                onResult,
            )
        } catch (_: Exception) {
            onResult(false)
        }
    }

    private fun saveViaMediaStore(payload: ImagePayload, result: NativeInvokeResult) {
        try {
            val resolver = host.context.contentResolver
            val values = ContentValues().apply {
                put(MediaStore.Images.Media.DISPLAY_NAME, payload.displayName)
                put(MediaStore.Images.Media.MIME_TYPE, payload.mimeType)
                put(
                    MediaStore.Images.Media.RELATIVE_PATH,
                    Environment.DIRECTORY_PICTURES + "/" + galleryDirectory,
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
                null,
            )
            result.resolve(mapOf("uri" to uri.toString()))
        } catch (error: Exception) {
            result.reject("Failed to save image", error)
        }
    }

    private fun saveViaLegacyStorage(payload: ImagePayload, result: NativeInvokeResult) {
        try {
            val directory = File(
                Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES),
                galleryDirectory,
            )
            if (!directory.exists() && !directory.mkdirs()) {
                throw IllegalStateException("Cannot create directory ${directory.absolutePath}")
            }
            val file = File(directory, payload.displayName)
            FileOutputStream(file).use { it.write(payload.bytes) }
            MediaScannerConnection.scanFile(
                host.context,
                arrayOf(file.absolutePath),
                arrayOf(payload.mimeType),
                null,
            )
            result.resolve(mapOf("uri" to Uri.fromFile(file).toString()))
        } catch (error: Exception) {
            result.reject("Failed to save image", error)
        }
    }

    // ─── Text file export (e.g. .ics calendar) ──────────────────────────── //

    private fun exportTextFile(payload: Map<String, Any?>, result: NativeInvokeResult) {
        val content = payload["content"] as? String
        if (content == null) {
            result.reject("content is required")
            return
        }
        val rawName = (payload["fileName"] as? String)?.trim().orEmpty()
        val safeName = rawName.replace(Regex("[^A-Za-z0-9._\\-\\u4e00-\\u9fa5]"), "_")
            .ifBlank { "export_${System.currentTimeMillis()}.txt" }
        val mimeType = (payload["mimeType"] as? String)?.takeIf { it.isNotBlank() } ?: "text/plain"
        val shouldShare = payload["share"] as? Boolean ?: true
        val bytes = content.toByteArray(Charsets.UTF_8)

        var savedToDownloads = false
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            savedToDownloads = runCatching {
                val resolver = host.context.contentResolver
                val values = ContentValues().apply {
                    put(MediaStore.Downloads.DISPLAY_NAME, safeName)
                    put(MediaStore.Downloads.MIME_TYPE, mimeType)
                    put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
                    put(MediaStore.Downloads.IS_PENDING, 1)
                }
                val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                    ?: return@runCatching false
                val stream = resolver.openOutputStream(uri)
                if (stream == null) {
                    resolver.delete(uri, null, null)
                    return@runCatching false
                }
                stream.use { it.write(bytes) }
                resolver.update(
                    uri,
                    ContentValues().apply { put(MediaStore.Downloads.IS_PENDING, 0) },
                    null,
                    null,
                )
                true
            }.getOrDefault(false)
        }

        var shared = false
        if (shouldShare) {
            shared = runCatching {
                val exportDir = File(host.context.cacheDir, "exports").apply { mkdirs() }
                val cacheFile = File(exportDir, safeName)
                FileOutputStream(cacheFile).use { it.write(bytes) }
                val uri = FileProvider.getUriForFile(
                    host.context,
                    "${host.context.packageName}.fileprovider",
                    cacheFile,
                )
                val sendIntent = Intent(Intent.ACTION_SEND).apply {
                    type = mimeType
                    putExtra(Intent.EXTRA_STREAM, uri)
                    putExtra(Intent.EXTRA_SUBJECT, safeName)
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }
                val chooser = Intent.createChooser(sendIntent, safeName).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                host.context.startActivity(chooser)
                true
            }.getOrDefault(false)
        }

        if (!savedToDownloads && !shared) {
            result.reject("Unable to export file")
            return
        }
        result.resolve(
            mapOf(
                "fileName" to safeName,
                "savedToDownloads" to savedToDownloads,
                "shared" to shared,
            ),
        )
    }

    private fun extensionOf(mimeType: String): String {
        val sub = mimeType.substringAfter('/', "").lowercase()
        return when (sub) {
            "", "jpeg" -> "jpg"
            "svg+xml" -> "svg"
            else -> sub
        }
    }

    companion object {
        const val ID = "native.files"
        private const val DEFAULT_APK_NAME = "app-update.apk"
    }
}
