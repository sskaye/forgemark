// Forgemark Tauri shell.
//
// Phase 11: native macOS menu bar. Each menu item carries an id; on
// click we emit a single `forgemark:menu` event with the id as the
// payload. The frontend's command dispatcher (src/state/menuBridge.ts)
// listens for the event and routes to the appropriate action.
//
// Keeping the Rust side as a thin event source is intentional — every
// command already exists on the JS side via keyboard shortcuts and
// reducer actions, so we don't duplicate logic.

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
    // File menu
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
    let close = MenuItemBuilder::new("Close").id("close").accelerator("CmdOrCtrl+W").build(app)?;

    let file_submenu = SubmenuBuilder::new(app, "File")
        .item(&new)
        .item(&open)
        .separator()
        .item(&save)
        .item(&save_as)
        .item(&clean_export)
        .separator()
        .item(&close)
        .build()?;

    // Edit menu — pulls in the standard Cocoa edit items so undo / redo
    // / cut / copy / paste / select all work everywhere a textarea or
    // contenteditable is focused.
    let edit_submenu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    // Comment menu (Phase 11 v1: every command is dispatched as a
    // forgemark:menu event with the id below; the JS side maps each id
    // to the existing reducer action / keyboard handler).
    let new_comment = MenuItemBuilder::new("New Comment")
        .id("new-comment")
        .accelerator("CmdOrCtrl+Alt+M")
        .build(app)?;
    let suggest_edit = MenuItemBuilder::new("Suggest Edit")
        .id("suggest-edit")
        .accelerator("CmdOrCtrl+Alt+E")
        .build(app)?;
    let reply = MenuItemBuilder::new("Reply").id("reply").accelerator("CmdOrCtrl+R").build(app)?;
    let resolve = MenuItemBuilder::new("Resolve")
        .id("resolve")
        .accelerator("CmdOrCtrl+Return")
        .build(app)?;
    let edit_comment = MenuItemBuilder::new("Edit")
        .id("edit-comment")
        .accelerator("CmdOrCtrl+Shift+E")
        .build(app)?;
    let delete_comment = MenuItemBuilder::new("Delete")
        .id("delete-comment")
        .accelerator("Delete")
        .build(app)?;
    let reattach = MenuItemBuilder::new("Reattach…").id("reattach").build(app)?;

    let comment_submenu = SubmenuBuilder::new(app, "Comment")
        .item(&new_comment)
        .item(&suggest_edit)
        .separator()
        .item(&reply)
        .item(&resolve)
        .item(&edit_comment)
        .item(&delete_comment)
        .separator()
        .item(&reattach)
        .build()?;

    // View menu
    let inc_text = MenuItemBuilder::new("Increase Text Size")
        .id("inc-text")
        .accelerator("CmdOrCtrl+Plus")
        .build(app)?;
    let dec_text = MenuItemBuilder::new("Decrease Text Size")
        .id("dec-text")
        .accelerator("CmdOrCtrl+-")
        .build(app)?;
    let reset_text = MenuItemBuilder::new("Reset Text Size")
        .id("reset-text")
        .accelerator("CmdOrCtrl+0")
        .build(app)?;
    let toggle_source = MenuItemBuilder::new("Toggle Source View")
        .id("toggle-source")
        .accelerator("CmdOrCtrl+Shift+M")
        .build(app)?;
    let toggle_sidebar = MenuItemBuilder::new("Toggle Sidebar")
        .id("toggle-sidebar")
        .accelerator("CmdOrCtrl+Alt+S")
        .build(app)?;

    let view_submenu = SubmenuBuilder::new(app, "View")
        .item(&inc_text)
        .item(&dec_text)
        .item(&reset_text)
        .separator()
        .item(&toggle_source)
        .item(&toggle_sidebar)
        .build()?;

    // App menu — gets the standard macOS About / Preferences shape.
    // Settings (⌘,) is conventionally on the App menu on macOS.
    let settings = MenuItemBuilder::new("Settings…")
        .id("settings")
        .accelerator("CmdOrCtrl+,")
        .build(app)?;
    let app_submenu = SubmenuBuilder::new(app, "Forgemark")
        .about(None)
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

    // Window menu — standard.
    let window_submenu = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize()
        .separator()
        .close_window()
        .build()?;

    MenuBuilder::new(app)
        .item(&app_submenu)
        .item(&file_submenu)
        .item(&edit_submenu)
        .item(&comment_submenu)
        .item(&view_submenu)
        .item(&window_submenu)
        .build()
}
