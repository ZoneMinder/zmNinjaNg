mod biometric;
mod mjpeg;

/// How often to clear the WebKitGTK resource cache (Linux desktop). The network
/// process never releases the per-frame image resources loaded during MJPEG
/// streaming, so clearing the cache on this interval bounds its memory. refs #150
#[cfg(target_os = "linux")]
const WEBKIT_CACHE_PURGE_INTERVAL_SECS: u64 = 120;

/// Relaunch the whole app to release memory. WebKit holds decoded frames and
/// allocator pages at the WebContent process level that no in-process flush (cache
/// purge, reload, or killing the render process) reliably returns to the OS, so a
/// fresh process is the only dependable reset. tauri-plugin-window-state restores
/// the window size/position across the relaunch, and setup() refocuses the window
/// so it comes back to the foreground. refs #150
#[tauri::command]
fn restart_app(app: tauri::AppHandle) {
  use tauri_plugin_window_state::{AppHandleExt, StateFlags};
  // app.restart() exits without firing the event the plugin saves on, so persist
  // the current geometry explicitly first; setup() restores it on relaunch.
  let _ = app.save_window_state(StateFlags::all());
  app.restart();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  // On some Linux GPU/compositor combinations WebKitGTK cannot create an EGL
  // context for its DMABUF renderer (EGL_BAD_PARAMETER), so the window paints
  // nothing and shows a blank white screen. Disabling the DMABUF renderer
  // falls back to a working path. Only set when the user has not already
  // chosen a value so an explicit override still wins. refs #150 refs #151
  #[cfg(target_os = "linux")]
  if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
    std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
  }

  tauri::Builder::default()
    .manage(mjpeg::MjpegState::default())
    .setup(|app| {
      use tauri::Manager;

      // WebKitGTK's network process never releases the per-frame image resources
      // loaded during MJPEG streaming, so its RSS grows unbounded while the web
      // and Rust processes stay flat. Periodically clearing the resource cache
      // holds it bounded (measured: ~50 MB steady vs. unbounded growth without
      // it). Linux desktop only. refs #150
      #[cfg(target_os = "linux")]
      if let Some(window) = app.get_webview_window("main") {
        std::thread::spawn(move || loop {
          std::thread::sleep(std::time::Duration::from_secs(WEBKIT_CACHE_PURGE_INTERVAL_SECS));
          let _ = window.with_webview(|webview| {
            use webkit2gtk::{WebContextExt, WebViewExt};
            if let Some(context) = webview.inner().context() {
              context.clear_cache();
              log::debug!("Cleared WebKitGTK resource cache to bound network-process memory");
            }
          });
        });
      }

      // Restore the saved window geometry (size/position/maximized/fullscreen)
      // and bring the window to the foreground. The restart_app relaunch is
      // user-triggered (a toolbar click), so the app was frontmost when it fired;
      // refocusing makes the relaunched instance return to front. refs #150
      if let Some(window) = app.get_webview_window("main") {
        use tauri_plugin_window_state::{StateFlags, WindowExt};
        let _ = window.restore_state(StateFlags::all());
        let _ = window.set_focus();
      }
      Ok(())
    })
    .plugin(tauri_plugin_window_state::Builder::default().build())
    .plugin(tauri_plugin_http::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_opener::init())
    .plugin(
      // Persistent log file is owned by the JS-side LogFileStore (writes to
      // <AppLog>/zmninja-ng.log). Don't add a LogDir target here — keeping
      // only Stdout + Webview avoids creating a second on-disk log file
      // that would orphan whenever the productName changes.
      tauri_plugin_log::Builder::default()
        .level(log::LevelFilter::Info)
        .targets([
          tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
          tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Webview),
        ])
        .build(),
    )
    .invoke_handler(tauri::generate_handler![
      restart_app,
      biometric::check_biometric_available,
      biometric::authenticate_biometric,
      mjpeg::mjpeg_start,
      mjpeg::mjpeg_stop,
      mjpeg::mjpeg_snapshot,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
