//! "Make Unsold PDF your PDF app": whether this app opens PDFs by default, and
//! the most each system allows towards making it so.
//! - macOS / Linux: set it directly (Launch Services / xdg-mime).
//! - Windows: apps can't set defaults, so open Settings › Default apps.
//! - Android: apps can't set defaults either. If another app is the default,
//!   open its App info (where "Open by default › Clear defaults" lives);
//!   otherwise the next PDF opened shows the "Always" choice.
//! - iOS has no default PDF app, and the web can't tell.

use serde::Serialize;
use tauri::{AppHandle, Runtime};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MakeDefault {
    /// "done", "settings" (opened the place to finish it), "guide" (the
    /// person finishes it next time they open a PDF) or "unsupported".
    outcome: &'static str,
    message: Option<String>,
}

impl MakeDefault {
    fn new(outcome: &'static str, message: Option<String>) -> Self {
        Self { outcome, message }
    }
}

/// "yes", "no" or "unknown".
#[tauri::command]
pub fn default_pdf_status<R: Runtime>(app: AppHandle<R>) -> &'static str {
    match is_default(&app) {
        Some(true) => "yes",
        Some(false) => "no",
        None => "unknown",
    }
}

#[tauri::command]
pub fn make_default_pdf_app<R: Runtime>(app: AppHandle<R>) -> MakeDefault {
    make_default(&app)
}

// ------------------------------------------------------------------ macOS

#[cfg(target_os = "macos")]
mod mac {
    use std::ffi::{c_char, c_void, CStr, CString};

    type CFStringRef = *const c_void;
    const UTF8: u32 = 0x0800_0100;
    const ROLES_ALL: u32 = 0xFFFF_FFFF;

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFStringCreateWithCString(a: *const c_void, s: *const c_char, enc: u32) -> CFStringRef;
        fn CFStringGetCString(s: CFStringRef, buf: *mut c_char, len: isize, enc: u32) -> bool;
        fn CFRelease(p: *const c_void);
    }
    #[link(name = "CoreServices", kind = "framework")]
    extern "C" {
        fn LSCopyDefaultRoleHandlerForContentType(uti: CFStringRef, role: u32) -> CFStringRef;
        fn LSSetDefaultRoleHandlerForContentType(uti: CFStringRef, role: u32, bundle: CFStringRef) -> i32;
    }

    fn cf(s: &str) -> CFStringRef {
        let c = CString::new(s).unwrap();
        unsafe { CFStringCreateWithCString(std::ptr::null(), c.as_ptr(), UTF8) }
    }

    pub fn handler() -> Option<String> {
        unsafe {
            let uti = cf("com.adobe.pdf");
            let h = LSCopyDefaultRoleHandlerForContentType(uti, ROLES_ALL);
            CFRelease(uti);
            if h.is_null() {
                return None;
            }
            let mut buf = [0 as c_char; 256];
            let ok = CFStringGetCString(h, buf.as_mut_ptr(), buf.len() as isize, UTF8);
            CFRelease(h);
            ok.then(|| CStr::from_ptr(buf.as_ptr()).to_string_lossy().into_owned())
        }
    }

    pub fn set(bundle: &str) -> bool {
        unsafe {
            let uti = cf("com.adobe.pdf");
            let id = cf(bundle);
            let status = LSSetDefaultRoleHandlerForContentType(uti, ROLES_ALL, id);
            CFRelease(uti);
            CFRelease(id);
            status == 0
        }
    }
}

#[cfg(target_os = "macos")]
fn is_default<R: Runtime>(app: &AppHandle<R>) -> Option<bool> {
    let id = &app.config().identifier;
    Some(mac::handler().is_some_and(|h| h.eq_ignore_ascii_case(id)))
}

#[cfg(target_os = "macos")]
fn make_default<R: Runtime>(app: &AppHandle<R>) -> MakeDefault {
    if mac::set(&app.config().identifier) && is_default(app) == Some(true) {
        MakeDefault::new("done", None)
    } else {
        MakeDefault::new(
            "guide",
            Some("In Finder, select any PDF, choose File › Get Info, pick Unsold PDF under “Open with”, then click Change All.".into()),
        )
    }
}

// ------------------------------------------------------------------ Linux

#[cfg(target_os = "linux")]
const DESKTOP_FILE: &str = "Unsold PDF.desktop";

#[cfg(target_os = "linux")]
fn xdg_mime(args: &[&str]) -> Option<String> {
    let out = std::process::Command::new("xdg-mime").args(args).output().ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).trim().to_owned())
}

#[cfg(target_os = "linux")]
fn is_default<R: Runtime>(_app: &AppHandle<R>) -> Option<bool> {
    xdg_mime(&["query", "default", "application/pdf"]).map(|d| d == DESKTOP_FILE)
}

#[cfg(target_os = "linux")]
fn make_default<R: Runtime>(app: &AppHandle<R>) -> MakeDefault {
    // An AppImage has no installed .desktop file to point at.
    if std::env::var_os("APPIMAGE").is_none()
        && xdg_mime(&["default", DESKTOP_FILE, "application/pdf"]).is_some()
        && is_default(app) == Some(true)
    {
        MakeDefault::new("done", None)
    } else {
        MakeDefault::new(
            "guide",
            Some("Right-click any PDF in your file manager, choose “Open With”, pick Unsold PDF and set it as the default.".into()),
        )
    }
}

// ------------------------------------------------------------------ Windows

#[cfg(windows)]
fn is_default<R: Runtime>(_app: &AppHandle<R>) -> Option<bool> {
    use winreg::{enums::*, RegKey};
    // The person's own choice wins; otherwise the class registered for .pdf.
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let choice: Option<String> = hkcu
        .open_subkey(r"Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.pdf\UserChoice")
        .and_then(|k| k.get_value("ProgId"))
        .ok();
    let prog_id = choice.or_else(|| {
        RegKey::predef(HKEY_CLASSES_ROOT)
            .open_subkey(".pdf")
            .and_then(|k| k.get_value::<String, _>(""))
            .ok()
    })?;
    Some(prog_id.to_ascii_lowercase().contains("unsold"))
}

#[cfg(windows)]
fn make_default<R: Runtime>(app: &AppHandle<R>) -> MakeDefault {
    use tauri_plugin_opener::OpenerExt;
    if app.opener().open_url("ms-settings:defaultapps", None::<&str>).is_ok() {
        MakeDefault::new(
            "settings",
            Some("In Default apps, search for “.pdf” and choose Unsold PDF.".into()),
        )
    } else {
        MakeDefault::new("unsupported", None)
    }
}

// ------------------------------------------------------------------ Android

#[cfg(target_os = "android")]
fn is_default<R: Runtime>(app: &AppHandle<R>) -> Option<bool> {
    crate::android::default_pdf_app(app).map(|d| d == "self")
}

#[cfg(target_os = "android")]
fn make_default<R: Runtime>(app: &AppHandle<R>) -> MakeDefault {
    match crate::android::default_pdf_app(app).as_deref() {
        Some("self") => MakeDefault::new("done", None),
        Some("none") | None => MakeDefault::new(
            "guide",
            Some("Next time you open a PDF from Files, Gmail or Chrome, choose Unsold PDF and tap “Always”.".into()),
        ),
        Some(other) => {
            let label = crate::android::app_label(app, other).unwrap_or_else(|| "the current PDF app".into());
            crate::android::open_app_settings(app, other);
            MakeDefault::new(
                "settings",
                Some(format!(
                    "{label} opens PDFs now. In its settings, tap “Open by default”, then “Clear defaults”. Next time you open a PDF, choose Unsold PDF and tap “Always”."
                )),
            )
        }
    }
}

// ------------------------------------------------------------------ iOS

#[cfg(target_os = "ios")]
fn is_default<R: Runtime>(_app: &AppHandle<R>) -> Option<bool> {
    None
}

#[cfg(target_os = "ios")]
fn make_default<R: Runtime>(_app: &AppHandle<R>) -> MakeDefault {
    MakeDefault::new("unsupported", None)
}
