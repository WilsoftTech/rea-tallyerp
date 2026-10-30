fn main() {
    if std::env::var_os("CARGO_FEATURE_DESKTOP").is_some() {
        tauri_build::try_build(
            tauri_build::Attributes::new()
                .app_manifest(tauri_build::AppManifest::new().commands(&["accounting"])),
        )
        .expect("Tauri build metadata");
    }
}
