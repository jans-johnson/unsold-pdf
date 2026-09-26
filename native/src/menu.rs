//! Native application menu (desktop only). Every custom item is encoded as
//! `command` or `command:arg` in its id and forwarded to the UI as a
//! `host-command` event; the UI owns the behaviour.

use serde::Serialize;
use tauri::menu::{Menu, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Runtime};

#[derive(Clone, Serialize)]
struct HostCommand {
    command: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    arg: Option<serde_json::Value>,
}

type Item = (&'static str, &'static str, Option<&'static str>);

const FILE: &[Item] = &[
    ("open", "Open…", Some("CmdOrCtrl+O")),
    ("-", "", None),
    ("open-tool:image-to-pdf", "Create PDF from Files…", None),
    ("open-tool:merge-pdf", "Combine Files…", None),
    ("-", "", None),
    ("close-tab", "Close Tab", Some("CmdOrCtrl+W")),
    ("save", "Save", Some("CmdOrCtrl+S")),
    ("save-as", "Save As…", Some("CmdOrCtrl+Shift+S")),
    ("revert", "Revert to Saved", None),
    ("-", "", None),
    ("reveal", "Show in Folder", None),
    ("properties", "Document Properties…", Some("CmdOrCtrl+D")),
    ("-", "", None),
    ("print", "Print…", Some("CmdOrCtrl+P")),
];

const EDIT_HEAD: &[Item] = &[
    ("undo", "Undo", Some("CmdOrCtrl+Z")),
    ("redo", "Redo", Some("CmdOrCtrl+Shift+Z")),
];

const EDIT_TAIL: &[Item] = &[
    ("find", "Find…", Some("CmdOrCtrl+F")),
    ("find-next", "Find Next", Some("CmdOrCtrl+G")),
    ("find-prev", "Find Previous", Some("CmdOrCtrl+Shift+G")),
];

const VIEW: &[Item] = &[
    ("home", "Home", Some("CmdOrCtrl+1")),
    ("all-tools", "All Tools", Some("CmdOrCtrl+2")),
    ("-", "", None),
    ("zoom-in", "Zoom In", Some("CmdOrCtrl+=")),
    ("zoom-out", "Zoom Out", Some("CmdOrCtrl+-")),
    ("zoom:1", "Actual Size", Some("CmdOrCtrl+0")),
    ("zoom:page-fit", "Fit Page", Some("CmdOrCtrl+9")),
    ("zoom:page-width", "Fit Width", Some("CmdOrCtrl+8")),
    ("-", "", None),
    ("rotate:90", "Rotate Clockwise", Some("CmdOrCtrl+Shift+=")),
    ("rotate:-90", "Rotate Counterclockwise", Some("CmdOrCtrl+Shift+-")),
    ("-", "", None),
    ("spread:single", "Single Page", None),
    ("spread:odd", "Two-Page View", None),
    ("spread:even", "Two-Page (Cover Page)", None),
    ("-", "", None),
    ("toggle-left", "Toggle Tools Pane", Some("CmdOrCtrl+\\")),
    ("panel:thumbnails", "Toggle Page Thumbnails", Some("CmdOrCtrl+Alt+T")),
    ("panel:bookmarks", "Toggle Bookmarks", Some("CmdOrCtrl+Alt+B")),
];

const TOOLS: &[Item] = &[
    ("run-tool:edit-pdf-text", "Edit Text", None),
    ("run-tool:edit-pdf", "Comment & Annotate", None),
    ("run-tool:sign-pdf", "Fill & Sign", None),
    ("run-tool:organize-pdf", "Organize Pages", None),
    ("run-tool:compress-pdf", "Compress", None),
    ("run-tool:ocr-pdf", "Recognize Text (OCR)", None),
    ("run-tool:protect-pdf", "Protect", None),
    ("run-tool:sanitize-pdf", "Redact / Sanitize", None),
    ("-", "", None),
    ("run-tool:pdf-to-word", "Export to Word", None),
    ("run-tool:pdf-to-png", "Export to Images", None),
    ("-", "", None),
    ("open-tool:pdf-workflow", "Workflow Builder", None),
    ("all-tools", "All Tools…", Some("CmdOrCtrl+Shift+A")),
];

fn submenu<R: Runtime>(
    app: &AppHandle<R>,
    title: &str,
    head: Vec<PredefinedMenuItem<R>>,
    items: &[Item],
) -> tauri::Result<tauri::menu::Submenu<R>> {
    let mut b = SubmenuBuilder::new(app, title);
    for item in head {
        b = b.item(&item);
    }
    for (id, label, accel) in items {
        if *id == "-" {
            b = b.separator();
            continue;
        }
        let mut mi = MenuItemBuilder::with_id(*id, *label);
        if let Some(a) = accel {
            mi = mi.accelerator(*a);
        }
        b = b.item(&mi.build(app)?);
    }
    b.build()
}

// Undo/redo are UI commands (not predefined items) because the UI decides
// between undoing text in a field and undoing an edit to the document.
fn edit_menu<R: Runtime>(
    app: &AppHandle<R>,
    clipboard: Vec<PredefinedMenuItem<R>>,
) -> tauri::Result<tauri::menu::Submenu<R>> {
    let mut b = SubmenuBuilder::new(app, "Edit");
    for (id, label, accel) in EDIT_HEAD.iter().chain(EDIT_TAIL) {
        if *id == "find" {
            for item in &clipboard {
                b = b.item(item);
            }
        }
        let mut mi = MenuItemBuilder::with_id(*id, *label);
        if let Some(a) = accel {
            mi = mi.accelerator(*a);
        }
        b = b.item(&mi.build(app)?);
    }
    b.build()
}

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let mut menu = MenuBuilder::new(app);

    #[cfg(target_os = "macos")]
    {
        let about = PredefinedMenuItem::about(app, None, None)?;
        let settings = MenuItemBuilder::with_id("open-tool:wasm-settings", "Settings…")
            .accelerator("CmdOrCtrl+,")
            .build(app)?;
        let app_menu = SubmenuBuilder::new(app, "UnAcrobat")
            .item(&about)
            .separator()
            .item(&settings)
            .separator()
            .services()
            .separator()
            .hide()
            .hide_others()
            .show_all()
            .separator()
            .quit()
            .build()?;
        menu = menu.item(&app_menu);
    }

    let clipboard = vec![
        PredefinedMenuItem::separator(app)?,
        PredefinedMenuItem::cut(app, None)?,
        PredefinedMenuItem::copy(app, None)?,
        PredefinedMenuItem::paste(app, None)?,
        PredefinedMenuItem::select_all(app, None)?,
        PredefinedMenuItem::separator(app)?,
    ];
    #[cfg_attr(target_os = "macos", allow(unused_mut))]
    let mut file_items: Vec<Item> = FILE.to_vec();
    #[cfg(not(target_os = "macos"))]
    file_items.extend_from_slice(&[("-", "", None), ("quit", "Exit", Some("Ctrl+Q"))]);

    menu = menu
        .item(&submenu(app, "File", vec![], &file_items)?)
        .item(&edit_menu(app, clipboard)?)
        .item(&submenu(app, "View", vec![PredefinedMenuItem::fullscreen(app, None)?], VIEW)?)
        .item(&submenu(app, "Tools", vec![], TOOLS)?);

    #[cfg(target_os = "macos")]
    {
        let window = SubmenuBuilder::new(app, "Window").minimize().maximize().close_window().build()?;
        menu = menu.item(&window);
    }
    menu.build()
}

/// Turns a menu id into a UI command.
pub fn dispatch<R: Runtime>(app: &AppHandle<R>, id: &str) {
    if id == "quit" {
        let _ = app.emit("quit-requested", ());
        return;
    }
    let (command, arg) = match id.split_once(':') {
        Some((c, a)) => (
            c,
            Some(
                a.parse::<i64>()
                    .map(serde_json::Value::from)
                    .unwrap_or_else(|_| serde_json::Value::from(a)),
            ),
        ),
        None => (id, None),
    };
    let _ = app.emit(
        "host-command",
        HostCommand {
            command: command.to_owned(),
            arg,
        },
    );
}
