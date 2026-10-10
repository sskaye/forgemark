// Prevents additional console window on Windows in release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // WebKitGTK's DMA-BUF renderer draws a blank window on a number of
    // Linux setups (NVIDIA drivers under Wayland most often). The
    // fallback renderer costs nothing a document viewer would notice.
    // A value the user set themselves wins. Set before Tauri starts any
    // threads, which is what makes set_var safe here.
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }
    forgemark_lib::run()
}
