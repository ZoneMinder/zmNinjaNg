mod biometric;
mod mjpeg;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
#[allow(deprecated)] // webkit2gtk run_javascript is deprecated but stable; used for the purge marker
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
      // EXPERIMENT (WebKitGTK NetworkProcess leak): the network process never
      // frees the per-frame image resources loaded while streaming, even after
      // streams stop. Periodically clear WebKitGTK's resource cache and watch
      // whether RSS drops. If it does, this is the fix; if not, it is a true
      // leak and we decode to pixels instead. Linux desktop only.
      #[cfg(target_os = "linux")]
      {
        if let Some(window) = app.get_webview_window("main") {
          std::thread::spawn(move || loop {
            std::thread::sleep(std::time::Duration::from_secs(120));
            let _ = window.with_webview(|webview| {
              use webkit2gtk::{WebContextExt, WebViewExt};
              let wv = webview.inner();
              if let Some(context) = wv.context() {
                context.clear_cache();
              }
              // Bold/colored devtools marker so the purge is visible in the console.
              wv.run_javascript(
                "console.log('%c CACHE PURGE: WebKitGTK resource cache cleared ','background:#c0392b;color:#fff;font-weight:bold;padding:2px 8px;border-radius:3px;font-size:12px')",
                webkit2gtk::gio::Cancellable::NONE,
                |_| {},
              );
            });
          });
        }
      }
      #[cfg(not(target_os = "linux"))]
      let _ = app;
      Ok(())
    })
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
      biometric::check_biometric_available,
      biometric::authenticate_biometric,
      mjpeg::mjpeg_start,
      mjpeg::mjpeg_stop,
      mjpeg::mjpeg_snapshot,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
