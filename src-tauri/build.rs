use std::env;
use std::path::PathBuf;
use std::process::Command;

fn build_macos_native_adapter() {
    if env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("macos") {
        return;
    }
    let output = PathBuf::from(env::var_os("OUT_DIR").expect("OUT_DIR is set"));
    let archive = output.join("libFlectNative.a");
    let status = Command::new("swiftc")
        .args([
            "-parse-as-library",
            "-emit-library",
            "-static",
            "native/FlectNative.swift",
            "-o",
        ])
        .arg(&archive)
        .status()
        .expect("Swift is required to build the supported macOS adapter");
    assert!(status.success(), "the macOS Swift adapter must compile");
    println!("cargo:rerun-if-changed=native/FlectNative.swift");
    println!("cargo:rustc-link-search=native={}", output.display());
    println!("cargo:rustc-link-lib=static=FlectNative");
    println!("cargo:rustc-link-lib=framework=AppKit");
}

fn main() {
    build_macos_native_adapter();
    tauri_build::build()
}
