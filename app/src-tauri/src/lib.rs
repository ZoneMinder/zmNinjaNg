mod biometric;
mod mjpeg;

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
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
