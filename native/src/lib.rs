mod documents;
#[cfg(desktop)]
mod menu;
mod net;
mod origin;

use serde::Serialize;
use tauri::{Emitter, Manager, RunEvent};

use documents::Library;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HostInfo {
    platform: &'static str,
    self_test: bool,
}

/// `--self-test`: the UI runs launch checks, reports them, and the app exits
/// with 0 (all passed) or 1. Used for CI smoke runs of packaged builds.
struct SelfTest(bool);

const SELF_TEST_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(90);

#[derive(serde::Deserialize, Serialize)]
struct SelfTestCheck {
    name: String,
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    detail: Option<String>,
}

#[tauri::command]
fn self_test_report<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    enabled: tauri::State<'_, SelfTest>,
    approved: tauri::State<'_, QuitApproved>,
    checks: Vec<SelfTestCheck>,
) {
    if !enabled.0 {
        return;
    }
    let passed = checks.iter().all(|c| c.ok);
    println!(
        "{}",
        serde_json::json!({ "platform": host_info(enabled.clone()).platform, "passed": passed, "checks": checks })
    );
    let _ = std::io::Write::flush(&mut std::io::stdout());
    // AppHandle::exit does not propagate the code, and CI needs it.
    let _ = (app, approved);
    std::process::exit(if passed { 0 } else { 1 });
}

#[tauri::command]
fn host_info(self_test: tauri::State<'_, SelfTest>) -> HostInfo {
    let platform = if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "android") {
        "android"
    } else if cfg!(target_os = "ios") {
        "ios"
    } else {
        "linux"
    };
    HostInfo {
        platform,
        self_test: self_test.0,
    }
}

#[tauri::command]
fn open_external<R: tauri::Runtime>(app: tauri::AppHandle<R>, url: String) -> Result<(), String> {
    let parsed = url::Url::parse(&url).map_err(|e| e.to_string())?;
    if !matches!(parsed.scheme(), "http" | "https" | "mailto") {
        return Err(format!("Refusing to open {} links", parsed.scheme()));
    }
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_url(parsed.as_str(), None::<&str>)
        .map_err(|e| e.to_string())
}

/// Set once the UI has approved quitting, so the next exit request passes.
struct QuitApproved(std::sync::atomic::AtomicBool);

#[tauri::command]
fn quit_app<R: tauri::Runtime>(app: tauri::AppHandle<R>, approved: tauri::State<'_, QuitApproved>) {
    approved.0.store(true, std::sync::atomic::Ordering::SeqCst);
    app.exit(0);
}

/// The origin the app pages are served from, for the navigation lock.
fn app_origin<R: tauri::Runtime>(app: &tauri::AppHandle<R>, start: &tauri::WebviewUrl) -> url::Origin {
    let fallback = if cfg!(any(windows, target_os = "android")) {
        "http://tauri.localhost/"
    } else {
        "tauri://localhost/"
    };
    match start {
        tauri::WebviewUrl::External(u) => u.origin(),
        _ if tauri::is_dev() => app
            .config()
            .build
            .dev_url
            .as_ref()
            .map(|u| u.origin())
            .unwrap_or_else(|| url::Url::parse(fallback).unwrap().origin()),
        _ => url::Url::parse(fallback).unwrap().origin(),
    }
}

fn create_main_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<()> {
    let mut config = app
        .config()
        .app
        .windows
        .iter()
        .find(|w| w.label == "main")
        .cloned()
        .expect("main window is configured in tauri.conf.json");
    let start = origin::start_url(app)?;
    let allowed = app_origin(app, &start);
    config.url = start;
    let opener = app.clone();
    tauri::WebviewWindowBuilder::from_config(app, &config)?
        // Keep the webview on the app; links to the web open in the browser.
        .on_navigation(move |url| {
            if origin::is_app_url(url, &allowed) {
                return true;
            }
            if matches!(url.scheme(), "http" | "https" | "mailto") {
                use tauri_plugin_opener::OpenerExt;
                let _ = opener.opener().open_url(url.as_str(), None::<&str>);
            }
            false
        })
        .build()?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg_attr(mobile, allow(unused_mut))]
    let mut builder = tauri::Builder::default();

    // A second launch (e.g. double-clicking another PDF) hands its arguments
    // to the running instance instead of opening a new window.
    let self_test = std::env::args().any(|a| a == "--self-test");

    // Self-test runs always get their own instance.
    #[cfg(desktop)]
    if !self_test {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            let paths = documents::paths_from_args(&args, Some(std::path::Path::new(&cwd)));
            app.state::<Library>().deliver_opened(app, paths);
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }));
    }

    let app = builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .manage(QuitApproved(Default::default()))
        .manage(SelfTest(self_test))
        .setup(|app| {
            let handle = app.handle().clone();
            app.manage(Library::load(documents::data_dir(&handle)));

            create_main_window(&handle)?;

            if app.state::<SelfTest>().0 {
                std::thread::spawn(|| {
                    std::thread::sleep(SELF_TEST_TIMEOUT);
                    eprintln!("self-test: no report after {SELF_TEST_TIMEOUT:?}");
                    std::process::exit(2);
                });
            }

            #[cfg(desktop)]
            {
                app.set_menu(menu::build(&handle)?)?;
                app.on_menu_event(|app, event| menu::dispatch(app, event.id().as_ref()));
                let args: Vec<String> = std::env::args().collect();
                let paths = documents::paths_from_args(&args, std::env::current_dir().ok().as_deref());
                app.state::<Library>().deliver_opened(&handle, paths);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            host_info,
            self_test_report,
            open_external,
            quit_app,
            documents::host_ready,
            documents::pick_documents,
            documents::read_document,
            documents::open_recent,
            documents::save_document,
            documents::save_document_as,
            documents::export_file,
            documents::recents_list,
            documents::recents_remove,
            documents::recents_clear,
            documents::reveal_file,
            net::net_fetch,
        ])
        .build(tauri::generate_context!())
        .expect("failed to build UnAcrobat");

    app.run(|app, event| match event {
        // macOS "Open With" / dropping files on the Dock icon.
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        RunEvent::Opened { urls } => {
            let paths = urls
                .into_iter()
                .map(|u| match u.to_file_path() {
                    Ok(p) => tauri_plugin_dialog::FilePath::Path(p),
                    Err(_) => tauri_plugin_dialog::FilePath::Url(u),
                })
                .collect();
            app.state::<Library>().deliver_opened(app, paths);
        }
        // Cmd+Q / quit from the menu: let the UI offer to save first.
        RunEvent::ExitRequested { api, code, .. } => {
            let approved = app.state::<QuitApproved>().0.load(std::sync::atomic::Ordering::SeqCst);
            let has_windows = !app.webview_windows().is_empty();
            if code.is_none() && has_windows && !approved {
                api.prevent_exit();
                let _ = app.emit("quit-requested", ());
            }
        }
        _ => {}
    });
}
