mod documents;
#[cfg(desktop)]
mod menu;
mod net;

use serde::Serialize;
use tauri::{Emitter, Manager, RunEvent};

use documents::Library;

#[derive(Serialize)]
struct HostInfo {
    platform: &'static str,
}

#[tauri::command]
fn host_info() -> HostInfo {
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
    HostInfo { platform }
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    // A second launch (e.g. double-clicking another PDF) hands its arguments
    // to the running instance instead of opening a new window.
    #[cfg(desktop)]
    {
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
        .setup(|app| {
            let handle = app.handle().clone();
            app.manage(Library::load(documents::data_dir(&handle)));

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
