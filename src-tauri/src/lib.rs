// Forgemark Tauri shell.
//
// Native macOS menu bar. Each menu item carries an id; on click we
// emit a single `forgemark:menu` event with the id as the payload.
// The frontend's command dispatcher (src/state/menuBridge.ts) listens
// for the event and routes to the appropriate action — every command
// already exists on the JS side via keyboard shortcuts, so the menu
// doesn't duplicate logic.
//
// The menu set is intentionally tight: only commands the app actually
// has, and nothing the macOS conventions don't strictly require. View
// items (text-size, sidebar) live in Settings; comment-card actions
// (Reply, Resolve, Edit, Delete, Reattach) live on the card itself.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::menu::{Menu, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{Emitter, Manager};
// RunEvent::Opened is macOS-only, so the bare-name import that the
// file-open handler uses stays gated. (Manager is imported unconditionally
// above — the quit guard needs `.state()` on every platform.)
#[cfg(target_os = "macos")]
use tauri::RunEvent;

// Queue of file paths that arrived before the webview was ready to
// receive them. macOS fires RunEvent::Opened during cold-start (when
// the user right-clicks → Open With → Forgemark on a file), often
// before the JS event listener is attached. The frontend's
// `take_pending_files` command drains this on mount.
#[derive(Default)]
struct PendingFiles(Mutex<Vec<String>>);

// The paths behind File > Open Recent, newest first. The frontend owns
// the list (it lives in localStorage with the other preferences) and
// pushes it here whenever it changes; the menu is rebuilt from it, and a
// click on an entry sends the path back down `forgemark:open-path`, the
// same road a Finder open takes.
#[derive(Default)]
struct RecentFiles(Mutex<Vec<String>>);

#[tauri::command]
fn set_recent_files(app: tauri::AppHandle, paths: Vec<String>) -> Result<(), String> {
    {
        let state = app.state::<RecentFiles>();
        let mut guard = state.0.lock().unwrap_or_else(|e| e.into_inner());
        *guard = paths.clone();
    }
    let menu = build_menu(&app, &paths).map_err(|e| e.to_string())?;
    app.set_menu(menu).map_err(|e| e.to_string())?;
    Ok(())
}

// HTML reports under review, served to their frames by the `fmreport`
// protocol below. A report runs its own scripts, so it must not share
// the app's origin: the protocol gives every report an origin of its
// own, from which the app's IPC is unreachable, and serves the files
// beside the report (a stylesheet, an image, a data file) from the same
// origin so the report loads as it would from disk in a browser. The
// frontend registers a report before pointing a frame at it and clears
// it when the frame goes.
struct Report {
    html: String,
    base_dir: Option<PathBuf>,
}

#[derive(Default)]
struct Reports(Mutex<HashMap<String, Report>>);

#[tauri::command]
fn set_report(
    state: tauri::State<Reports>,
    id: String,
    html: String,
    base_dir: Option<String>,
) -> Result<(), String> {
    let mut guard = state.0.lock().unwrap_or_else(|e| e.into_inner());
    guard.insert(
        id,
        Report {
            html,
            base_dir: base_dir.map(PathBuf::from),
        },
    );
    Ok(())
}

#[tauri::command]
fn clear_report(state: tauri::State<Reports>, id: String) {
    let mut guard = state.0.lock().unwrap_or_else(|e| e.into_inner());
    guard.remove(&id);
}

// `/<id>/<path>` from a report URL, percent-decoded. The path is what
// the report asked for relative to itself; empty or `index.html` is the
// report.
fn report_request(path: &str) -> Option<(String, String)> {
    let trimmed = path.trim_start_matches('/');
    let decoded = percent_decode(trimmed);
    let mut parts = decoded.splitn(2, '/');
    let id = parts.next()?.to_string();
    if id.is_empty() {
        return None;
    }
    let rest = parts.next().unwrap_or("").to_string();
    Some((id, rest))
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn mime_for(path: &str) -> &'static str {
    let ext = Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();
    match ext.as_str() {
        "html" | "htm" => "text/html; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "json" => "application/json; charset=utf-8",
        "csv" => "text/csv; charset=utf-8",
        "txt" | "md" => "text/plain; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "pdf" => "application/pdf",
        "wasm" => "application/wasm",
        _ => "application/octet-stream",
    }
}

// A file beside the report, if `rel` stays inside the report's folder.
fn sibling_file(base_dir: &Path, rel: &str) -> Option<Vec<u8>> {
    let base = base_dir.canonicalize().ok()?;
    let target = base.join(rel).canonicalize().ok()?;
    if !target.starts_with(&base) {
        return None;
    }
    std::fs::read(target).ok()
}

fn report_response(reports: &Reports, path: &str) -> (u16, &'static str, Vec<u8>) {
    let Some((id, rest)) = report_request(path) else {
        return (404, "text/plain", b"not found".to_vec());
    };
    let guard = reports.0.lock().unwrap_or_else(|e| e.into_inner());
    let Some(report) = guard.get(&id) else {
        return (404, "text/plain", b"no such report".to_vec());
    };
    if rest.is_empty() || rest == "index.html" {
        return (
            200,
            "text/html; charset=utf-8",
            report.html.clone().into_bytes(),
        );
    }
    match report
        .base_dir
        .as_deref()
        .and_then(|dir| sibling_file(dir, &rest))
    {
        Some(bytes) => (200, mime_for(&rest), bytes),
        None => (404, "text/plain", b"not found".to_vec()),
    }
}

#[tauri::command]
fn take_pending_files(state: tauri::State<PendingFiles>) -> Vec<String> {
    let mut guard = state.0.lock().unwrap_or_else(|e| e.into_inner());
    std::mem::take(&mut *guard)
}

#[tauri::command]
fn print_current_webview(window: tauri::WebviewWindow) -> Result<(), String> {
    window.print().map_err(|err| err.to_string())
}

// Set once the frontend has dealt with unsaved work and the app is
// genuinely allowed to go away. Both quit paths below consult it, so a
// second close request after approval isn't intercepted again — without
// it, `app.exit` would re-enter ExitRequested and the app could never
// actually quit.
#[derive(Default)]
struct ExitApproved(AtomicBool);

// The frontend calls this after the unsaved-work guard is satisfied
// (nothing dirty, saved, or explicitly discarded).
#[tauri::command]
fn approve_exit(app: tauri::AppHandle) {
    app.state::<ExitApproved>().0.store(true, Ordering::SeqCst);
    app.exit(0);
}

// The document paths among a launch's arguments. Windows and Linux hand
// a double-clicked file to the app this way (macOS uses RunEvent::Opened
// instead); anything that isn't a file we open is left alone.
fn file_args(args: &[String]) -> Vec<String> {
    args.iter()
        .skip(1)
        .filter(|a| !a.starts_with('-'))
        .filter(|a| {
            let lower = a.to_ascii_lowercase();
            [".md", ".markdown", ".html", ".htm", ".xhtml"]
                .iter()
                .any(|ext| lower.ends_with(ext))
        })
        .cloned()
        .collect()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        // A second launch — another double-click while the app is running
        // — hands its arguments to this instance and exits. Registered
        // first, as the plugin requires. The paths go down the same road
        // a Finder open takes; the window comes forward so the user sees
        // the result.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            for path in file_args(&args) {
                let _ = app.emit("forgemark:open-path", path);
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .manage(PendingFiles::default())
        .manage(ExitApproved::default())
        .manage(RecentFiles::default())
        .manage(Reports::default())
        .register_uri_scheme_protocol("fmreport", |ctx, request| {
            let reports = ctx.app_handle().state::<Reports>();
            let (status, mime, body) = report_response(&reports, request.uri().path());
            tauri::http::Response::builder()
                .status(status)
                .header("Content-Type", mime)
                .header("Cache-Control", "no-store")
                .body(body)
                .unwrap_or_else(|_| tauri::http::Response::new(Vec::new()))
        })
        .invoke_handler(tauri::generate_handler![
            take_pending_files,
            print_current_webview,
            approve_exit,
            set_recent_files,
            set_report,
            clear_report
        ])
        // Closing the window (red button / ⌘W) must not throw away
        // unsaved work. Rust can't know whether there is any, so hand the
        // decision to the frontend: block the close, ask, and let it call
        // `approve_exit` once it's satisfied. ⌘Q takes the ExitRequested
        // path in `app.run` below and lands in the same place.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.state::<ExitApproved>().0.load(Ordering::SeqCst) {
                    return;
                }
                api.prevent_close();
                let _ = window.emit("forgemark:close-requested", ());
            }
        })
        .setup(|app| {
            // A cold launch with a file on the command line: queue it for
            // the frontend to claim once its listener is up.
            let from_argv = file_args(&std::env::args().collect::<Vec<_>>());
            if !from_argv.is_empty() {
                let state = app.state::<PendingFiles>();
                let mut guard = state.0.lock().unwrap_or_else(|e| e.into_inner());
                guard.extend(from_argv);
            }
            let menu = build_menu(app.handle(), &[])?;
            app.set_menu(menu)?;
            app.on_menu_event(|app, event| {
                let id = event.id().0.clone();
                // Quit is a custom item (see build_menu) so it lands here
                // rather than terminating the process behind our back.
                // Send it down the same road as a window close.
                if id == "quit" {
                    if app.state::<ExitApproved>().0.load(Ordering::SeqCst) {
                        app.exit(0);
                    } else {
                        let _ = app.emit("forgemark:close-requested", ());
                    }
                    return;
                }
                // An Open Recent entry: look its path up and open it the
                // way a Finder open is opened.
                if let Some(index) = id.strip_prefix("recent-") {
                    if let Ok(index) = index.parse::<usize>() {
                        let path = {
                            let state = app.state::<RecentFiles>();
                            let guard = state.0.lock().unwrap_or_else(|e| e.into_inner());
                            guard.get(index).cloned()
                        };
                        if let Some(path) = path {
                            let _ = app.emit("forgemark:open-path", path);
                        }
                        return;
                    }
                }
                let _ = app.emit("forgemark:menu", id);
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    // RunEvent::Opened fires when macOS hands the app one or more
    // files (Finder Open With, drag-onto-dock, double-click on a
    // file association). We forward each path through a single
    // `forgemark:open-path` event the JS side already listens for.
    // For cold-start launches the webview may not have its listener
    // attached yet, so we also stash the paths in PendingFiles for
    // the JS `take_pending_files` invoke to claim on mount.
    app.run(|_app, _event| {
        // Backstop for exit requests that reach neither the window-close
        // handler nor the Quit menu item — e.g. Dock > Quit, or a system
        // logout. Verified against ⌘Q and the red close button; the other
        // routes are covered by construction rather than by testing.
        //
        // Note this can't intercept `app.exit(n)`: that arrives as
        // ExitRequested with `code: Some(n)` and prevent_exit is ignored
        // for it. Which is exactly what makes `approve_exit` work.
        if let tauri::RunEvent::ExitRequested { api, .. } = &_event {
            if !_app.state::<ExitApproved>().0.load(Ordering::SeqCst) {
                api.prevent_exit();
                let _ = _app.emit("forgemark:close-requested", ());
            }
        }
        // RunEvent::Opened is macOS-only (Finder "Open With", file
        // associations, drag-onto-dock). Compile it out on other platforms
        // so the Windows/Linux build doesn't reference a variant that
        // doesn't exist there. File-open on Windows arrives via argv/
        // single-instance instead, handled separately.
        #[cfg(target_os = "macos")]
        {
            if let RunEvent::Opened { urls } = _event {
                let pending = _app.state::<PendingFiles>();
                let mut guard = pending.0.lock().unwrap_or_else(|e| e.into_inner());
                for url in urls {
                    if let Ok(path) = url.to_file_path() {
                        let path_str = path.to_string_lossy().to_string();
                        // Best-effort live emit (no-op if no listener).
                        let _ = _app.emit("forgemark:open-path", path_str.clone());
                        guard.push(path_str);
                    }
                }
            }
        }
    });
}

fn build_menu(app: &tauri::AppHandle, recent: &[String]) -> tauri::Result<Menu<tauri::Wry>> {
    // App menu — About, Settings, Hide (standard ⌘H), Quit. The
    // Services / Hide Others / Show All conventions are deliberately
    // omitted; Forgemark doesn't surface anything to Services and
    // the others are noise for a single-window app.
    let settings = MenuItemBuilder::new("Settings…")
        .id("settings")
        .accelerator("CmdOrCtrl+,")
        .build(app)?;
    // Deliberately NOT SubmenuBuilder::quit(). The predefined Quit item
    // maps to NSApplication `terminate:` on macOS, which tears the
    // process down without ever entering Tauri's event loop — so
    // RunEvent::ExitRequested never fires and the unsaved-work guard
    // never runs. A custom item routes ⌘Q through on_menu_event instead.
    let quit = MenuItemBuilder::new("Quit Forgemark")
        .id("quit")
        .accelerator("CmdOrCtrl+Q")
        .build(app)?;
    let app_submenu = SubmenuBuilder::new(app, "Forgemark")
        .about(None)
        .separator()
        .item(&settings)
        .separator()
        .hide()
        .separator()
        .item(&quit)
        .build()?;

    // File menu — every item maps to an existing keyboard shortcut.
    let new = MenuItemBuilder::new("New")
        .id("new")
        .accelerator("CmdOrCtrl+N")
        .build(app)?;
    let open = MenuItemBuilder::new("Open…")
        .id("open")
        .accelerator("CmdOrCtrl+O")
        .build(app)?;
    // Open Recent: one entry per remembered path, newest first, and a
    // Clear Menu at the bottom, as every macOS app has it. Entries show
    // the file name; the full path is what the click opens.
    let mut open_recent = SubmenuBuilder::new(app, "Open Recent");
    for (index, path) in recent.iter().enumerate() {
        let name = path
            .rsplit(['/', '\\'])
            .next()
            .filter(|s| !s.is_empty())
            .unwrap_or(path.as_str());
        let item = MenuItemBuilder::new(name)
            .id(format!("recent-{index}"))
            .build(app)?;
        open_recent = open_recent.item(&item);
    }
    let clear_recent = MenuItemBuilder::new("Clear Menu")
        .id("recent-clear")
        .enabled(!recent.is_empty())
        .build(app)?;
    let open_recent = open_recent.separator().item(&clear_recent).build()?;
    let save = MenuItemBuilder::new("Save")
        .id("save")
        .accelerator("CmdOrCtrl+S")
        .build(app)?;
    let save_as = MenuItemBuilder::new("Save As…")
        .id("save-as")
        .accelerator("CmdOrCtrl+Shift+S")
        .build(app)?;
    let clean_export = MenuItemBuilder::new("Clean Export…")
        .id("clean-export")
        .accelerator("CmdOrCtrl+Shift+E")
        .build(app)?;
    let print = MenuItemBuilder::new("Print…")
        .id("print")
        .accelerator("CmdOrCtrl+P")
        .build(app)?;

    // File > Close clears the open document but keeps the window
    // open (TextEdit / Pages convention). Quitting the app is ⌘Q via
    // the Forgemark menu; the red traffic light still closes the
    // window outright.
    let close_file = MenuItemBuilder::new("Close")
        .id("close-file")
        .accelerator("CmdOrCtrl+W")
        .build(app)?;

    let file_submenu = SubmenuBuilder::new(app, "File")
        .item(&new)
        .item(&open)
        .item(&open_recent)
        .separator()
        .item(&save)
        .item(&save_as)
        .item(&clean_export)
        .separator()
        .item(&print)
        .separator()
        .item(&close_file)
        .build()?;

    // Edit menu — Undo / Redo / Cut / Copy / Paste, plus Forgemark's
    // compact Find/Replace bar. Extra find commands stay keyboard-only
    // so the menu remains quiet.
    let find_replace = MenuItemBuilder::new("Find/Replace…")
        .id("find-replace")
        .accelerator("CmdOrCtrl+F")
        .build(app)?;
    let edit_submenu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .separator()
        .item(&find_replace)
        .build()?;

    // Comment menu — only the two creation commands. Card-level
    // actions (Reply, Resolve, Edit, Delete, Reattach) live on the
    // card itself; the menu stayed tight.
    let new_comment = MenuItemBuilder::new("New Comment")
        .id("new-comment")
        .accelerator("CmdOrCtrl+Alt+M")
        .build(app)?;
    let suggest_edit = MenuItemBuilder::new("Suggest Edit")
        .id("suggest-edit")
        .accelerator("CmdOrCtrl+Alt+E")
        .build(app)?;

    let comment_submenu = SubmenuBuilder::new(app, "Comment")
        .item(&new_comment)
        .item(&suggest_edit)
        .build()?;

    // Window menu — matches the macOS native structure so users
    // can find what they expect, and System Settings → Keyboard →
    // Shortcuts → App Shortcuts can remap by item name. Item names
    // reproduce Apple's exactly: "Left", "Right", "Top Left",
    // "Return to Previous Size", etc.
    //
    // Default accelerators are Ctrl+Option+arrow (matches Rectangle
    // and Magnet defaults). Tauri/Electron can't bind to Fn (Globe),
    // so we can't reproduce the macOS Sequoia native Fn+Ctrl+arrow
    // exactly — pick the next-most-conventional set instead.

    // Halves
    let mr_h_left = MenuItemBuilder::new("Left")
        .id("window-left-half")
        .accelerator("Ctrl+Alt+Left")
        .build(app)?;
    let mr_h_right = MenuItemBuilder::new("Right")
        .id("window-right-half")
        .accelerator("Ctrl+Alt+Right")
        .build(app)?;
    let mr_h_top = MenuItemBuilder::new("Top")
        .id("window-top-half")
        .accelerator("Ctrl+Alt+Up")
        .build(app)?;
    let mr_h_bottom = MenuItemBuilder::new("Bottom")
        .id("window-bottom-half")
        .accelerator("Ctrl+Alt+Down")
        .build(app)?;
    let halves_submenu = SubmenuBuilder::new(app, "Halves")
        .item(&mr_h_left)
        .item(&mr_h_right)
        .item(&mr_h_top)
        .item(&mr_h_bottom)
        .build()?;

    // Quarters
    let mr_q_tl = MenuItemBuilder::new("Top Left")
        .id("window-top-left-quarter")
        .accelerator("Ctrl+Alt+U")
        .build(app)?;
    let mr_q_tr = MenuItemBuilder::new("Top Right")
        .id("window-top-right-quarter")
        .accelerator("Ctrl+Alt+I")
        .build(app)?;
    let mr_q_bl = MenuItemBuilder::new("Bottom Left")
        .id("window-bottom-left-quarter")
        .accelerator("Ctrl+Alt+J")
        .build(app)?;
    let mr_q_br = MenuItemBuilder::new("Bottom Right")
        .id("window-bottom-right-quarter")
        .accelerator("Ctrl+Alt+K")
        .build(app)?;
    let quarters_submenu = SubmenuBuilder::new(app, "Quarters")
        .item(&mr_q_tl)
        .item(&mr_q_tr)
        .item(&mr_q_bl)
        .item(&mr_q_br)
        .build()?;

    let mr_return = MenuItemBuilder::new("Return to Previous Size")
        .id("window-return-previous")
        .accelerator("Ctrl+Alt+R")
        .build(app)?;

    let move_resize_submenu = SubmenuBuilder::new(app, "Move & Resize")
        .item(&halves_submenu)
        .item(&quarters_submenu)
        .separator()
        .item(&mr_return)
        .build()?;

    // Fill / Center live at the Window-menu top level (matches macOS).
    let mr_fill = MenuItemBuilder::new("Fill")
        .id("window-fill")
        .accelerator("Ctrl+Alt+F")
        .build(app)?;
    let mr_center = MenuItemBuilder::new("Center")
        .id("window-center")
        .accelerator("Ctrl+Alt+C")
        .build(app)?;

    // No tab navigation commands here on purpose: switching tabs is a
    // click on the tab strip, and duplicating that as a menu item plus
    // accelerator earns nothing.
    let window_submenu = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize() // shows as "Zoom" — the Cocoa convention
        .separator()
        .item(&mr_fill)
        .item(&mr_center)
        .item(&move_resize_submenu)
        .build()?;

    // Help holds the one thing a user may go looking for without
    // knowing it lives in Settings.
    let install_skill = MenuItemBuilder::new("Install AI Skill…")
        .id("install-skill")
        .build(app)?;
    let help_submenu = SubmenuBuilder::new(app, "Help")
        .item(&install_skill)
        .build()?;

    MenuBuilder::new(app)
        .item(&app_submenu)
        .item(&file_submenu)
        .item(&edit_submenu)
        .item(&comment_submenu)
        .item(&window_submenu)
        .item(&help_submenu)
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_document_paths_and_drops_the_rest() {
        let args = vec![
            "forgemark".to_string(),
            "--flag".to_string(),
            "C:\\notes\\draft.md".to_string(),
            "report.HTML".to_string(),
            "not-a-doc.txt".to_string(),
        ];
        assert_eq!(
            file_args(&args),
            vec!["C:\\notes\\draft.md".to_string(), "report.HTML".to_string()]
        );
        assert!(file_args(&["forgemark".to_string()]).is_empty());
    }

    #[test]
    fn report_paths_are_split_and_decoded() {
        assert_eq!(
            report_request("/r1/index.html"),
            Some(("r1".to_string(), "index.html".to_string()))
        );
        assert_eq!(
            report_request("/r1/"),
            Some(("r1".to_string(), String::new()))
        );
        assert_eq!(
            report_request("/r1/data%20files/a.json"),
            Some(("r1".to_string(), "data files/a.json".to_string()))
        );
        assert_eq!(report_request("/"), None);
    }

    #[test]
    fn report_is_served_and_siblings_stay_inside_the_folder() {
        let dir = std::env::temp_dir().join(format!("fm-report-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("sub")).unwrap();
        std::fs::write(dir.join("style.css"), "p{}").unwrap();
        let reports = Reports::default();
        reports.0.lock().unwrap().insert(
            "r1".to_string(),
            Report {
                html: "<p>hi</p>".to_string(),
                base_dir: Some(dir.clone()),
            },
        );
        let (status, mime, body) = report_response(&reports, "/r1/index.html");
        assert_eq!(
            (status, mime, body),
            (200, "text/html; charset=utf-8", b"<p>hi</p>".to_vec())
        );
        let (status, mime, body) = report_response(&reports, "/r1/style.css");
        assert_eq!(
            (status, mime, body),
            (200, "text/css; charset=utf-8", b"p{}".to_vec())
        );
        let (status, _, _) = report_response(&reports, "/r1/../../etc/passwd");
        assert_eq!(status, 404);
        let (status, _, _) = report_response(&reports, "/r2/index.html");
        assert_eq!(status, 404);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
