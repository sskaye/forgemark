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

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::menu::{Menu, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{Emitter, Manager as _};
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .manage(PendingFiles::default())
        .manage(ExitApproved::default())
        .invoke_handler(tauri::generate_handler![
            take_pending_files,
            print_current_webview,
            approve_exit
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
            let menu = build_menu(app.handle())?;
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

fn build_menu(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
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
    let new = MenuItemBuilder::new("New").id("new").accelerator("CmdOrCtrl+N").build(app)?;
    let open = MenuItemBuilder::new("Open…").id("open").accelerator("CmdOrCtrl+O").build(app)?;
    let save = MenuItemBuilder::new("Save").id("save").accelerator("CmdOrCtrl+S").build(app)?;
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

    MenuBuilder::new(app)
        .item(&app_submenu)
        .item(&file_submenu)
        .item(&edit_submenu)
        .item(&comment_submenu)
        .item(&window_submenu)
        .build()
}
