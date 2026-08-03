#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{stdin, IsTerminal};

fn main() {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    let code = flect_lib::run_public(&args, stdin().is_terminal());
    if code != 0 {
        std::process::exit(code);
    }
}
