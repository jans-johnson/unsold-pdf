//! Document access for the UI.
//!
//! The webview never gets general file-system access. It can only read or
//! write a file the user explicitly handed to the app: picked in a dialog,
//! saved via "Save As", opened from the OS ("Open with", file association),
//! or previously opened and still in the recents list. Handles are the
//! string form of a `FilePath`, so desktop paths and mobile URIs share one
//! code path.

use std::collections::HashSet;
use std::fs;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::str::FromStr;
use std::sync::Mutex;

use percent_encoding::percent_decode_str;
use serde::{Deserialize, Serialize};
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tauri_plugin_dialog::{DialogExt, FilePath};
use tauri_plugin_fs::{FsExt, OpenOptions};

const MAX_RECENTS: usize = 30;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentRef {
    handle: String,
    name: String,
    size: u64,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecentEntry {
    handle: String,
    name: String,
    size: u64,
    opened_at: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentDocument {
    #[serde(flatten)]
    entry: RecentEntry,
    exists: bool,
}

#[derive(Serialize)]
pub struct SavedDocument {
    handle: String,
    name: String,
}

pub struct Library {
    granted: Mutex<HashSet<String>>,
    recents: Mutex<Vec<RecentEntry>>,
    recents_file: PathBuf,
    /// Documents opened from the OS before the UI finished loading.
    pending: Mutex<Option<Vec<DocumentRef>>>,
}

impl Library {
    pub fn load(data_dir: PathBuf) -> Self {
        let recents_file = data_dir.join("recent-documents.json");
        let recents: Vec<RecentEntry> = fs::read(&recents_file)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
        // Anything in recents was granted in an earlier session.
        let granted = recents.iter().map(|r| r.handle.clone()).collect();
        Self {
            granted: Mutex::new(granted),
            recents: Mutex::new(recents),
            recents_file,
            pending: Mutex::new(Some(Vec::new())),
        }
    }

    fn grant(&self, handle: &str) {
        self.granted.lock().unwrap().insert(handle.to_owned());
    }

    fn check(&self, handle: &str) -> Result<(), String> {
        if self.granted.lock().unwrap().contains(handle) {
            Ok(())
        } else {
            Err("This file was not opened through UnAcrobat".into())
        }
    }

    fn touch_recent(&self, doc: &DocumentRef) {
        if !doc.name.to_lowercase().ends_with(".pdf") {
            return;
        }
        let mut list = self.recents.lock().unwrap();
        list.retain(|r| r.handle != doc.handle);
        list.insert(
            0,
            RecentEntry {
                handle: doc.handle.clone(),
                name: doc.name.clone(),
                size: doc.size,
                opened_at: now_ms(),
            },
        );
        list.truncate(MAX_RECENTS);
        self.persist(&list);
    }

    fn persist(&self, list: &[RecentEntry]) {
        if let Some(dir) = self.recents_file.parent() {
            let _ = fs::create_dir_all(dir);
        }
        if let Ok(json) = serde_json::to_vec(list) {
            let _ = fs::write(&self.recents_file, json);
        }
    }

    /// Registers documents that arrived from the OS and forwards them to the
    /// UI, or queues them until `host_ready`.
    pub fn deliver_opened<R: Runtime>(&self, app: &AppHandle<R>, paths: Vec<FilePath>) {
        let docs: Vec<DocumentRef> = paths
            .into_iter()
            .filter_map(|p| describe(app, &p).ok())
            .collect();
        if docs.is_empty() {
            return;
        }
        for doc in &docs {
            self.grant(&doc.handle);
            self.touch_recent(doc);
        }
        let mut pending = self.pending.lock().unwrap();
        match pending.as_mut() {
            Some(queue) => queue.extend(docs),
            None => {
                let _ = app.emit("documents-opened", docs);
            }
        }
    }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn display_name(path: &FilePath) -> String {
    let raw = match path {
        FilePath::Path(p) => p
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default(),
        // Android content URIs encode the provider path in the last segment,
        // e.g. ".../document/primary%3ADownload%2Freport.pdf".
        FilePath::Url(u) => {
            let last = u.path_segments().and_then(|mut s| s.next_back()).unwrap_or("");
            let decoded = percent_decode_str(last).decode_utf8_lossy();
            decoded.rsplit(['/', ':']).next().unwrap_or("").to_owned()
        }
    };
    if raw.is_empty() {
        "Document.pdf".into()
    } else {
        raw
    }
}

fn parse_handle(handle: &str) -> FilePath {
    FilePath::from_str(handle).expect("FilePath parsing is infallible")
}

/// Opens a file through the fs plugin (which understands content URIs and
/// iOS security-scoped URLs), runs `f`, and releases iOS access afterwards.
fn with_file<R: Runtime, T>(
    app: &AppHandle<R>,
    path: &FilePath,
    opts: OpenOptions,
    f: impl FnOnce(&mut fs::File) -> std::io::Result<T>,
) -> Result<T, String> {
    let mut file = app
        .fs()
        .open(path.clone(), opts)
        .map_err(|e| format!("Could not open file: {e}"))?;
    let result = f(&mut file).map_err(|e| e.to_string());
    #[cfg(target_os = "ios")]
    let _ = app.fs().stop_accessing_security_scoped_resource(path.clone());
    result
}

fn read_opts() -> OpenOptions {
    let mut o = OpenOptions::new();
    o.read(true);
    o
}

fn write_opts() -> OpenOptions {
    let mut o = OpenOptions::new();
    o.read(false).write(true).create(true).truncate(true);
    o
}

fn describe<R: Runtime>(app: &AppHandle<R>, path: &FilePath) -> Result<DocumentRef, String> {
    let size = with_file(app, path, read_opts(), |f| f.metadata().map(|m| m.len()))?;
    Ok(DocumentRef {
        handle: path.to_string(),
        name: display_name(path),
        size,
    })
}

fn header(request: &Request<'_>, name: &str) -> Result<String, String> {
    let value = request
        .headers()
        .get(name)
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| format!("missing {name} header"))?;
    Ok(percent_decode_str(value).decode_utf8_lossy().into_owned())
}

fn raw_body<'a>(request: &'a Request<'_>) -> Result<&'a [u8], String> {
    match request.body() {
        InvokeBody::Raw(bytes) => Ok(bytes),
        _ => Err("expected a binary request body".into()),
    }
}

fn extension_filter(name: &str) -> Option<(String, String)> {
    let ext = name.rsplit_once('.')?.1.to_lowercase();
    (!ext.is_empty() && ext.len() <= 8).then(|| (ext.to_uppercase(), ext))
}

#[tauri::command]
pub async fn pick_documents<R: Runtime>(
    app: AppHandle<R>,
    library: State<'_, Library>,
) -> Result<Vec<DocumentRef>, String> {
    let picked = app
        .dialog()
        .file()
        .add_filter("PDF Documents", &["pdf"])
        .add_filter(
            "Documents and images",
            &["pdf", "docx", "doc", "xlsx", "pptx", "odt", "rtf", "txt", "md", "jpg", "jpeg", "png", "webp", "tif", "tiff", "heic", "svg", "eml", "msg", "epub"],
        )
        .blocking_pick_files()
        .unwrap_or_default();
    let mut docs = Vec::new();
    for path in picked {
        let doc = describe(&app, &path)?;
        library.grant(&doc.handle);
        library.touch_recent(&doc);
        docs.push(doc);
    }
    Ok(docs)
}

#[tauri::command]
pub async fn read_document<R: Runtime>(
    app: AppHandle<R>,
    library: State<'_, Library>,
    handle: String,
) -> Result<Response, String> {
    library.check(&handle)?;
    let bytes = with_file(&app, &parse_handle(&handle), read_opts(), |f| {
        let mut buf = Vec::new();
        f.read_to_end(&mut buf)?;
        Ok(buf)
    })?;
    Ok(Response::new(bytes))
}

#[tauri::command]
pub async fn open_recent<R: Runtime>(
    app: AppHandle<R>,
    library: State<'_, Library>,
    handle: String,
) -> Result<Option<DocumentRef>, String> {
    library.check(&handle)?;
    match describe(&app, &parse_handle(&handle)) {
        Ok(doc) => {
            library.touch_recent(&doc);
            Ok(Some(doc))
        }
        Err(_) => Ok(None),
    }
}

#[tauri::command]
pub async fn save_document<R: Runtime>(
    app: AppHandle<R>,
    library: State<'_, Library>,
    request: Request<'_>,
) -> Result<(), String> {
    let handle = header(&request, "x-handle")?;
    library.check(&handle)?;
    let data = raw_body(&request)?;
    let path = parse_handle(&handle);
    with_file(&app, &path, write_opts(), |f| f.write_all(data))?;
    library.touch_recent(&DocumentRef {
        name: display_name(&path),
        size: data.len() as u64,
        handle,
    });
    Ok(())
}

#[tauri::command]
pub async fn save_document_as<R: Runtime>(
    app: AppHandle<R>,
    library: State<'_, Library>,
    request: Request<'_>,
) -> Result<Option<SavedDocument>, String> {
    let name = header(&request, "x-name")?;
    let data = raw_body(&request)?;
    let Some(path) = app
        .dialog()
        .file()
        .set_file_name(&name)
        .add_filter("PDF Document", &["pdf"])
        .blocking_save_file()
    else {
        return Ok(None);
    };
    with_file(&app, &path, write_opts(), |f| f.write_all(data))?;
    let doc = DocumentRef {
        handle: path.to_string(),
        name: display_name(&path),
        size: data.len() as u64,
    };
    library.grant(&doc.handle);
    library.touch_recent(&doc);
    Ok(Some(SavedDocument {
        handle: doc.handle,
        name: doc.name,
    }))
}

#[tauri::command]
pub async fn export_file<R: Runtime>(
    app: AppHandle<R>,
    request: Request<'_>,
) -> Result<Option<String>, String> {
    let name = header(&request, "x-name")?;
    let data = raw_body(&request)?;
    let mut dialog = app.dialog().file().set_file_name(&name);
    if let Some((label, ext)) = extension_filter(&name) {
        dialog = dialog.add_filter(label, &[ext.as_str()]);
    }
    let Some(path) = dialog.blocking_save_file() else {
        return Ok(None);
    };
    with_file(&app, &path, write_opts(), |f| f.write_all(data))?;
    Ok(Some(display_name(&path)))
}

#[tauri::command]
pub fn recents_list(library: State<'_, Library>) -> Vec<RecentDocument> {
    library
        .recents
        .lock()
        .unwrap()
        .iter()
        .map(|entry| RecentDocument {
            exists: match parse_handle(&entry.handle) {
                FilePath::Path(p) => p.is_file(),
                // Mobile URIs can't be probed without opening them.
                FilePath::Url(_) => true,
            },
            entry: entry.clone(),
        })
        .collect()
}

#[tauri::command]
pub fn recents_remove(library: State<'_, Library>, handle: String) {
    let mut list = library.recents.lock().unwrap();
    list.retain(|r| r.handle != handle);
    library.persist(&list);
}

#[tauri::command]
pub fn recents_clear(library: State<'_, Library>) {
    let mut list = library.recents.lock().unwrap();
    list.clear();
    library.persist(&list);
}

#[tauri::command]
pub fn reveal_file<R: Runtime>(
    app: AppHandle<R>,
    library: State<'_, Library>,
    handle: String,
) -> Result<(), String> {
    library.check(&handle)?;
    let FilePath::Path(path) = parse_handle(&handle) else {
        return Err("Only local files can be revealed".into());
    };
    use tauri_plugin_opener::OpenerExt;
    app.opener().reveal_item_in_dir(path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn host_ready<R: Runtime>(app: AppHandle<R>, library: State<'_, Library>) {
    let queued = library.pending.lock().unwrap().take().unwrap_or_default();
    if !queued.is_empty() {
        let _ = app.emit("documents-opened", queued);
    }
}

/// Paths passed on the command line (Windows/Linux file associations, and the
/// arguments forwarded by a second instance).
pub fn paths_from_args(args: &[String], cwd: Option<&std::path::Path>) -> Vec<FilePath> {
    args.iter()
        .skip(1)
        .filter(|a| !a.starts_with('-'))
        .map(PathBuf::from)
        .map(|p| match (p.is_absolute(), cwd) {
            (false, Some(dir)) => dir.join(p),
            _ => p,
        })
        .filter(|p| p.is_file())
        .map(FilePath::Path)
        .collect()
}

pub fn data_dir<R: Runtime>(app: &AppHandle<R>) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("unacrobat"))
}
