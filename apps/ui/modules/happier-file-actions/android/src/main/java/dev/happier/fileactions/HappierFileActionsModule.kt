package dev.happier.fileactions

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.util.Base64
import android.provider.DocumentsContract
import expo.modules.kotlin.activityresult.AppContextActivityResultContract
import expo.modules.kotlin.activityresult.AppContextActivityResultLauncher
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.OutputStream
import kotlinx.coroutines.sync.Mutex
import java.io.Serializable
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext

internal data class SaveDocumentOptions(val name: String, val mimeType: String) : Serializable

internal class SaveDocumentContract : AppContextActivityResultContract<SaveDocumentOptions, String?> {
  override fun createIntent(context: Context, input: SaveDocumentOptions): Intent =
    AndroidFileActions.documentIntent(input.name, input.mimeType)

  override fun parseResult(input: SaveDocumentOptions, resultCode: Int, intent: Intent?): String? {
    if (resultCode != Activity.RESULT_OK) return null
    return requireNotNull(intent?.data) { "Save destination is unavailable" }.toString()
  }
}

internal class DownloadDocumentContract : AppContextActivityResultContract<SaveDocumentOptions, String?> {
  override fun createIntent(context: Context, input: SaveDocumentOptions): Intent =
    AndroidFileActions.documentIntent(input.name, input.mimeType)

  override fun parseResult(input: SaveDocumentOptions, resultCode: Int, intent: Intent?): String? {
    if (resultCode != Activity.RESULT_OK) return null
    return requireNotNull(intent?.data) { "Download destination is unavailable" }.toString()
  }
}

private data class ActiveDownload(
  val uri: Uri,
  val output: OutputStream,
  val mediaStorePending: Boolean,
)

class HappierFileActionsModule : Module() {
  private lateinit var saveLauncher: AppContextActivityResultLauncher<SaveDocumentOptions, String?>
  private lateinit var downloadLauncher: AppContextActivityResultLauncher<SaveDocumentOptions, String?>
  private val saveMutex = Mutex()
  private val downloads = ConcurrentHashMap<String, ActiveDownload>()

  override fun definition() = ModuleDefinition {
    Name("HappierFileActions")

    RegisterActivityContracts {
      saveLauncher = registerForActivityResult(SaveDocumentContract()) { _, _ -> }
      downloadLauncher = registerForActivityResult(DownloadDocumentContract()) { _, _ -> }
    }

    AsyncFunction("saveFile") Coroutine { fileUri: String, name: String ->
      check(saveMutex.tryLock()) { "Another save is already in progress" }
      try {
        val context = requireNotNull(appContext.reactContext) { "App context is unavailable" }
        val file = AndroidFileActions.checkedDownloadFile(context, fileUri)
        val selectedUri = saveLauncher.launch(SaveDocumentOptions(name, AndroidFileActions.mimeType(name)))
        if (selectedUri == null) {
          mapOf("canceled" to true)
        } else {
          AndroidFileActions.copyToDocument(context, file, selectedUri)
          mapOf("canceled" to false, "uri" to selectedUri)
        }
      } finally {
        saveMutex.unlock()
      }
    }

    AsyncFunction("beginDownload") Coroutine { name: String ->
      val context = requireNotNull(appContext.reactContext) { "App context is unavailable" }
      val mimeType = AndroidFileActions.mimeType(name)
      val uri = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        AndroidFileActions.createDownloadsEntry(context, name, mimeType)
      } else {
        val selectedUri = downloadLauncher.launch(SaveDocumentOptions(name, mimeType))
          ?: return@Coroutine mapOf("canceled" to true)
        Uri.parse(selectedUri)
      }
      val output = try {
        withContext(Dispatchers.IO) {
          requireNotNull(context.contentResolver.openOutputStream(uri, "w")) {
            "Unable to open the Downloads destination"
          }
        }
      } catch (failure: Throwable) {
        withContext(NonCancellable + Dispatchers.IO) {
          runCatching { if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) context.contentResolver.delete(uri, null, null)
          else DocumentsContract.deleteDocument(context.contentResolver, uri) }
        }
        throw failure
      }
      val downloadId = UUID.randomUUID().toString()
      downloads[downloadId] = ActiveDownload(uri, output, Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q)
      mapOf("canceled" to false, "downloadId" to downloadId)
    }

    AsyncFunction("writeDownload") Coroutine { downloadId: String, contentBase64: String ->
      val download = requireNotNull(downloads[downloadId]) { "Download is no longer active" }
      val bytes = Base64.decode(contentBase64, Base64.DEFAULT)
      withContext(Dispatchers.IO) { download.output.write(bytes) }
    }

    AsyncFunction("finishDownload") Coroutine { downloadId: String ->
      val context = requireNotNull(appContext.reactContext) { "App context is unavailable" }
      val download = requireNotNull(downloads.remove(downloadId)) { "Download is no longer active" }
      try {
        withContext(Dispatchers.IO) {
          download.output.flush()
          download.output.close()
          if (download.mediaStorePending) AndroidFileActions.finalizeDownloadsEntry(context, download.uri)
        }
      } catch (failure: Throwable) {
        withContext(NonCancellable + Dispatchers.IO) {
          runCatching {
            download.output.close()
            if (download.mediaStorePending) context.contentResolver.delete(download.uri, null, null)
            else DocumentsContract.deleteDocument(context.contentResolver, download.uri)
          }
        }
        throw failure
      }
    }

    AsyncFunction("cancelDownload") Coroutine { downloadId: String ->
      val context = requireNotNull(appContext.reactContext) { "App context is unavailable" }
      val download = downloads.remove(downloadId) ?: return@Coroutine
      withContext(NonCancellable + Dispatchers.IO) {
        var closeFailure: Throwable? = null
        try {
          download.output.close()
        } catch (failure: Throwable) {
          closeFailure = failure
        }
        val deleted = if (download.mediaStorePending) {
          context.contentResolver.delete(download.uri, null, null) == 1
        } else {
          DocumentsContract.deleteDocument(context.contentResolver, download.uri)
        }
        check(deleted) { "Unable to remove the incomplete Downloads entry" }
        closeFailure?.let { throw it }
      }
    }

    AsyncFunction("openFile") { fileUri: String, name: String ->
      launchFileIntent(fileUri, name, share = false)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("shareFile") { fileUri: String, name: String, dialogTitle: String? ->
      launchFileIntent(fileUri, name, share = true, dialogTitle = dialogTitle)
    }.runOnQueue(Queues.MAIN)
  }

  private fun launchFileIntent(fileUri: String, name: String, share: Boolean, dialogTitle: String? = null) {
    val context = requireNotNull(appContext.reactContext) { "App context is unavailable" }
    val file = AndroidFileActions.checkedDownloadFile(context, fileUri)
    val uri = AndroidFileActions.contentUri(context, file, name)
    val intent = AndroidFileActions.fileIntent(uri, name, share)
    val chooser = AndroidFileActions.chooserIntent(intent, dialogTitle)
    appContext.throwingActivity.startActivity(chooser)
  }
}
