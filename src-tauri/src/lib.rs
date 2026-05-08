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

use tauri::menu::{Menu, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::Emitter;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let menu = build_menu(app.handle())?;
            app.set_menu(menu)?;
            app.on_menu_event(|app, event| {
                let id = event.id().0.clone();
                let _ = app.emit("forgemark:menu", id);
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
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
    let app_submenu = SubmenuBuilder::new(app, "Forgemark")
        .about(None)
        .separator()
        .item(&settings)
        .separator()
        .hide()
        .separator()
        .quit()
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
        .item(&close_file)
        .build()?;

    // Edit menu — Undo / Redo / Cut / Copy / Paste. Select All is
    // omitted intentionally; clicking + drag-select is faster than
    // the menu route, and the menu was getting noisy.
    let edit_submenu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
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

    // Window menu — macOS standard plus a Move & Resize submenu so
    // the keyboard window-resize shortcuts (Ctrl+Cmd+arrows /
    // Ctrl+Cmd+F) work the way users expect from Rectangle, Magnet,
    // and the macOS Sequoia native commands. Items emit
    // window-* ids that the JS bridge handles via the Tauri window
    // API (set_size + set_position).
    let mr_fill = MenuItemBuilder::new("Fill")
        .id("window-fill")
        .accelerator("Ctrl+Cmd+F")
        .build(app)?;
    let mr_center = MenuItemBuilder::new("Center")
        .id("window-center")
        .accelerator("Ctrl+Cmd+C")
        .build(app)?;
    let mr_left = MenuItemBuilder::new("Left Half")
        .id("window-left-half")
        .accelerator("Ctrl+Cmd+Left")
        .build(app)?;
    let mr_right = MenuItemBuilder::new("Right Half")
        .id("window-right-half")
        .accelerator("Ctrl+Cmd+Right")
        .build(app)?;
    let mr_top = MenuItemBuilder::new("Top Half")
        .id("window-top-half")
        .accelerator("Ctrl+Cmd+Up")
        .build(app)?;
    let mr_bottom = MenuItemBuilder::new("Bottom Half")
        .id("window-bottom-half")
        .accelerator("Ctrl+Cmd+Down")
        .build(app)?;
    let move_resize_submenu = SubmenuBuilder::new(app, "Move & Resize")
        .item(&mr_fill)
        .item(&mr_center)
        .separator()
        .item(&mr_left)
        .item(&mr_right)
        .item(&mr_top)
        .item(&mr_bottom)
        .build()?;

    let window_submenu = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize()
        .separator()
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
