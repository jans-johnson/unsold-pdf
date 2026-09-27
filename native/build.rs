// Every command the UI may call is declared here and granted explicitly in
// capabilities/default.json. Required because on macOS, iOS and Linux the app
// is served from a loopback origin, which Tauri treats as remote.
const COMMANDS: &[&str] = &[
    "host_info",
    "self_test_report",
    "open_external",
    "quit_app",
    "host_ready",
    "pick_documents",
    "read_document",
    "open_recent",
    "save_document",
    "save_document_as",
    "export_file",
    "recents_list",
    "recents_remove",
    "recents_clear",
    "reveal_file",
    "net_fetch",
];

fn main() {
    // Read by `host_info` (lib.rs): set for app-store builds.
    println!("cargo:rerun-if-env-changed=UNSOLD_STORE_BUILD");
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("failed to run tauri-build");
}
