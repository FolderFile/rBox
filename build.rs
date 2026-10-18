fn main() {
    // rust-embed snapshots web/dist at compile time; without this a frontend
    // rebuild leaves the binary serving stale chunks forever
    println!("cargo:rerun-if-changed=web/dist");
}
