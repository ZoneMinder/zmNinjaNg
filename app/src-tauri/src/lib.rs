mod biometric;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_http::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_opener::init())
    .plugin(
      tauri_plugin_log::Builder::default()
        .level(log::LevelFilter::Info)
        .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepOne)
        .max_file_size(10 * 1024 * 1024)
        .build(),
    )
    .invoke_handler(tauri::generate_handler![
      biometric::check_biometric_available,
      biometric::authenticate_biometric,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
