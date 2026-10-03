# bindgen Clang 22 compatibility backport

Vendored bindgen 0.69.5 from the existing offline Cargo registry. Its BSD-3-Clause LICENSE and original copyright notices are retained. No registry sources were modified.

Only clang.rs Type::declaration is changed: use the definition cursor when available. The method is copied from bindgen 0.72.1, which contains upstream fix #3278. All other Rust dependencies retain their locked versions and dependency edges.

Sources: https://github.com/rust-lang/rust-bindgen/pull/3278 and https://github.com/rust-lang/rust-bindgen/blob/main/CHANGELOG.md#0721-2025-08-31

A fresh target build must generate bindings; do not copy cached bindings or set WHISPER_DONT_GENERATE_BINDINGS.
