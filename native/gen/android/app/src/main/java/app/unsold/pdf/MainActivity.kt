package app.unsold.pdf

import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.Settings
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import android.os.Build
import android.os.Bundle
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts

class MainActivity : TauriActivity() {
  // The system document picker; unlike the dialog plugin's GET_CONTENT, its
  // grants can be kept, so recents and save-in-place survive a restart.
  private val openDocuments =
    registerForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
      uris.forEach(::keepAccess)
      nativePicked(uris.joinToString("\n"))
    }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    // A relaunch after process death replays the old intent; skip it then.
    if (savedInstanceState == null) forward(intent)
  }

  /**
   * Back goes to the previous screen, not out of the app: the page closes
   * whatever is on top (menu, dialog, search, a tool, the document) and
   * answers whether it did. At Home it doesn't, and the app steps aside the
   * way Android apps do. Registered after Tauri's own handler, so it wins.
   */
  override fun onWebViewCreate(webView: WebView) {
    onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        webView.evaluateJavascript("window.__unsoldBack ? window.__unsoldBack() : false") { handled ->
          if (handled != "true") moveTaskToBack(true)
        }
      }
    })
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    forward(intent)
  }

  /** Passes the documents of an "Open with" / "Share" intent to the app. */
  private fun forward(intent: Intent?) {
    val uris = documentsOf(intent ?: return)
    uris.forEach(::keepAccess)
    if (uris.isNotEmpty()) nativeOpened(uris.joinToString("\n"))
  }

  /**
   * Called from Rust: the app that opens PDFs by default. "self", "none"
   * (Android asks each time) or another app's package name.
   */
  @Suppress("unused")
  fun defaultPdfApp(): String {
    val probe = Intent(Intent.ACTION_VIEW)
      .setDataAndType(Uri.parse("content://app.unsold.pdf.probe/document.pdf"), "application/pdf")
    val info = packageManager.resolveActivity(probe, PackageManager.MATCH_DEFAULT_ONLY)?.activityInfo
      ?: return "none"
    return when {
      info.packageName == packageName -> "self"
      // No default chosen: the system's chooser answers instead.
      info.packageName == "android" || info.name.contains("Resolver") -> "none"
      else -> info.packageName
    }
  }

  /** Called from Rust: an app's name as the person sees it. */
  @Suppress("unused")
  fun appLabel(pkg: String): String =
    try {
      packageManager.getApplicationLabel(packageManager.getApplicationInfo(pkg, 0)).toString()
    } catch (e: PackageManager.NameNotFoundException) {
      ""
    }

  /** Called from Rust: App info for a package ("Open by default" lives there). */
  @Suppress("unused")
  fun openAppSettings(pkg: String) {
    startActivity(
      Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", pkg, null))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    )
  }

  /** Called from Rust; the choice comes back through [nativePicked]. */
  @Suppress("unused")
  fun pickDocuments() = runOnUiThread { openDocuments.launch(arrayOf("*/*")) }

  /** Called from Rust for files it created through the save dialog. */
  @Suppress("unused")
  fun keepAccess(uri: String) = keepAccess(Uri.parse(uri))

  private fun keepAccess(uri: Uri) {
    val read = Intent.FLAG_GRANT_READ_URI_PERMISSION
    for (flags in intArrayOf(read or Intent.FLAG_GRANT_WRITE_URI_PERMISSION, read)) {
      try {
        contentResolver.takePersistableUriPermission(uri, flags)
        return
      } catch (_: SecurityException) {
        // Not granted that way (or not persistable at all); try less.
      }
    }
  }

  private fun documentsOf(intent: Intent): List<Uri> = when (intent.action) {
    Intent.ACTION_VIEW -> listOfNotNull(intent.data)
    Intent.ACTION_SEND -> listOfNotNull(stream(intent))
    Intent.ACTION_SEND_MULTIPLE -> streams(intent)
    else -> emptyList()
  }

  @Suppress("DEPRECATION")
  private fun stream(intent: Intent): Uri? =
    if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
    else intent.getParcelableExtra(Intent.EXTRA_STREAM)

  @Suppress("DEPRECATION")
  private fun streams(intent: Intent): List<Uri> =
    (if (Build.VERSION.SDK_INT >= 33) intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java)
    else intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM)) ?: emptyList()

  companion object {
    @JvmStatic private external fun nativeOpened(uris: String)
    @JvmStatic private external fun nativePicked(uris: String)
  }
}
