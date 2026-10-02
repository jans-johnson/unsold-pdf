//! Android specifics, talking to `MainActivity` over JNI:
//! - "Open with" / "Share to": the activity hands the intent's content URIs to
//!   `nativeOpened`, which may run before setup is done, so they wait here
//!   until `attach` supplies the app.
//! - Picking: the system document picker with lasting access, so recents and
//!   save-in-place still work after a restart.
//! - Names: content URIs often end in an opaque id, so ask the provider.

use std::str::FromStr;
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::Duration;

use jni::objects::{JClass, JObject, JString, JValue};
use jni::JNIEnv;
use tauri::{AppHandle, Manager, Runtime, Wry};
use tauri_plugin_dialog::FilePath;

use crate::documents::Library;

static STATE: Mutex<(Option<AppHandle>, Vec<String>)> = Mutex::new((None, Vec::new()));
static PICKED: Mutex<Option<mpsc::Sender<Vec<String>>>> = Mutex::new(None);

pub fn attach(app: &AppHandle<Wry>) {
    let mut state = STATE.lock().unwrap();
    state.0 = Some(app.clone());
    let uris = std::mem::take(&mut state.1);
    deliver(app.clone(), uris);
}

fn deliver(app: AppHandle, uris: Vec<String>) {
    if uris.is_empty() {
        return;
    }
    // Called from the UI thread, but reading content URIs needs it free.
    std::thread::spawn(move || {
        let paths = uris
            .iter()
            .filter_map(|u| FilePath::from_str(u).ok())
            .collect();
        app.state::<Library>().deliver_opened(&app, paths);
    });
}

#[no_mangle]
pub extern "system" fn Java_app_unsold_pdf_MainActivity_nativeOpened(
    mut env: JNIEnv,
    _class: JClass,
    uris: JString,
) {
    let Ok(joined) = env.get_string(&uris).map(String::from) else {
        return;
    };
    let uris = joined.lines().filter(|l| !l.is_empty()).map(String::from);
    let mut state = STATE.lock().unwrap();
    match state.0.clone() {
        Some(app) => deliver(app, uris.collect()),
        None => state.1.extend(uris),
    }
}

/// Shows the system document picker and waits for the user's choice.
pub fn pick<R: Runtime>(app: &AppHandle<R>) -> Vec<String> {
    let (tx, rx) = mpsc::channel();
    // A pick still pending gets an empty answer when its sender drops here.
    *PICKED.lock().unwrap() = Some(tx);
    on_activity(app, |env, activity| {
        env.call_method(activity, "pickDocuments", "()V", &[])?;
        Ok(())
    });
    rx.recv().unwrap_or_default()
}

#[no_mangle]
pub extern "system" fn Java_app_unsold_pdf_MainActivity_nativePicked(
    mut env: JNIEnv,
    _class: JClass,
    uris: JString,
) {
    let uris = env
        .get_string(&uris)
        .map(|s| String::from(s).lines().map(String::from).collect())
        .unwrap_or_default();
    if let Some(tx) = PICKED.lock().unwrap().take() {
        let _ = tx.send(uris);
    }
}

/// Keeps access to `uri` across restarts, where its provider allows that.
pub fn keep_access<R: Runtime>(app: &AppHandle<R>, uri: &str) {
    let uri = uri.to_owned();
    on_activity(app, move |env, activity| {
        let uri = env.new_string(&uri)?;
        env.call_method(
            activity,
            "keepAccess",
            "(Ljava/lang/String;)V",
            &[JValue::Object(&uri)],
        )?;
        Ok(())
    });
}

/// Runs `f` with the activity on the UI thread, clearing any Java exception.
fn on_activity<R: Runtime>(
    app: &AppHandle<R>,
    f: impl FnOnce(&mut JNIEnv, &JObject) -> jni::errors::Result<()> + Send + 'static,
) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let _ = window.with_webview(move |webview| {
        webview.jni_handle().exec(move |env, activity, _| {
            let _ = f(env, activity);
            if env.exception_check().unwrap_or(false) {
                let _ = env.exception_clear();
            }
        });
    });
}

/// The name the content provider shows for `uri`. Must not be called on the
/// UI thread, which does the lookup.
pub fn display_name<R: Runtime>(app: &AppHandle<R>, uri: &str) -> Option<String> {
    let (tx, rx) = mpsc::channel();
    let uri = uri.to_owned();
    on_activity(app, move |env, activity| {
        let name = query_name(env, activity, &uri);
        let _ = tx.send(name.as_ref().ok().cloned().flatten());
        name.map(|_| ())
    });
    rx.recv_timeout(Duration::from_secs(5)).ok().flatten()
}

fn query_name(
    env: &mut JNIEnv,
    activity: &JObject,
    uri: &str,
) -> jni::errors::Result<Option<String>> {
    let resolver = env
        .call_method(
            activity,
            "getContentResolver",
            "()Landroid/content/ContentResolver;",
            &[],
        )?
        .l()?;
    let uri = env.new_string(uri)?;
    let uri = env
        .call_static_method(
            "android/net/Uri",
            "parse",
            "(Ljava/lang/String;)Landroid/net/Uri;",
            &[JValue::Object(&uri)],
        )?
        .l()?;
    let column = env.new_string("_display_name")?;
    let columns = env.new_object_array(1, "java/lang/String", &column)?;
    let null = JObject::null();
    let cursor = env
        .call_method(
            &resolver,
            "query",
            "(Landroid/net/Uri;[Ljava/lang/String;Ljava/lang/String;[Ljava/lang/String;Ljava/lang/String;)Landroid/database/Cursor;",
            &[
                JValue::Object(&uri),
                JValue::Object(&columns),
                JValue::Object(&null),
                JValue::Object(&null),
                JValue::Object(&null),
            ],
        )?
        .l()?;
    if cursor.is_null() {
        return Ok(None);
    }
    let mut name = None;
    if env.call_method(&cursor, "moveToFirst", "()Z", &[])?.z()? {
        let value = env
            .call_method(
                &cursor,
                "getString",
                "(I)Ljava/lang/String;",
                &[JValue::Int(0)],
            )?
            .l()?;
        if !value.is_null() {
            name = Some(env.get_string(&JString::from(value))?.into());
        }
    }
    env.call_method(&cursor, "close", "()V", &[])?;
    Ok(name.filter(|n: &String| !n.is_empty()))
}

/// Runs `f` on the UI thread with the activity and waits for its answer.
fn ask_activity<R: Runtime, T: Send + 'static>(
    app: &AppHandle<R>,
    f: impl FnOnce(&mut JNIEnv, &JObject) -> jni::errors::Result<T> + Send + 'static,
) -> Option<T> {
    let (tx, rx) = mpsc::channel();
    on_activity(app, move |env, activity| {
        let _ = tx.send(f(env, activity).ok());
        Ok(())
    });
    rx.recv_timeout(Duration::from_secs(5)).ok().flatten()
}

fn string_result(env: &mut JNIEnv, value: jni::objects::JValueOwned) -> jni::errors::Result<String> {
    let obj = value.l()?;
    if obj.is_null() {
        return Ok(String::new());
    }
    Ok(env.get_string(&JString::from(obj))?.into())
}

/// The app that opens PDFs by default: "self", "none" (Android asks each
/// time) or another app's package name.
pub fn default_pdf_app<R: Runtime>(app: &AppHandle<R>) -> Option<String> {
    ask_activity(app, |env, activity| {
        let v = env.call_method(activity, "defaultPdfApp", "()Ljava/lang/String;", &[])?;
        string_result(env, v)
    })
}

/// A package's name as the person sees it ("Drive", "Adobe Acrobat").
pub fn app_label<R: Runtime>(app: &AppHandle<R>, package: &str) -> Option<String> {
    let package = package.to_owned();
    ask_activity(app, move |env, activity| {
        let p = env.new_string(&package)?;
        let v = env.call_method(activity, "appLabel", "(Ljava/lang/String;)Ljava/lang/String;", &[JValue::Object(&p)])?;
        string_result(env, v)
    })
    .filter(|s| !s.is_empty())
}

/// Opens a package's App info screen (where "Open by default" lives).
pub fn open_app_settings<R: Runtime>(app: &AppHandle<R>, package: &str) {
    let package = package.to_owned();
    on_activity(app, move |env, activity| {
        let p = env.new_string(&package)?;
        env.call_method(activity, "openAppSettings", "(Ljava/lang/String;)V", &[JValue::Object(&p)])?;
        Ok(())
    });
}
