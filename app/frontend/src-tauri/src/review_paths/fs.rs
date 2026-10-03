//! Guarded std filesystem calls; production preserves std semantics (MIT).
pub use std::fs::*;
use std::{io, path::Path};
use super::{guard_read, guard_write};
pub fn open_file(path: impl AsRef<Path>) -> io::Result<File> { guard_read(&path)?; File::open(path) }
pub fn create_file(path: impl AsRef<Path>) -> io::Result<File> { guard_write(&path)?; File::create(path) }
pub fn read(path: impl AsRef<Path>) -> io::Result<Vec<u8>> { guard_read(&path)?; std::fs::read(path) }
pub fn read_to_string(path: impl AsRef<Path>) -> io::Result<String> { guard_read(&path)?; std::fs::read_to_string(path) }
pub fn read_dir(path: impl AsRef<Path>) -> io::Result<ReadDir> { guard_read(&path)?; std::fs::read_dir(path) }
pub fn metadata(path: impl AsRef<Path>) -> io::Result<Metadata> { guard_read(&path)?; std::fs::metadata(path) }
pub fn symlink_metadata(path: impl AsRef<Path>) -> io::Result<Metadata> { guard_read(&path)?; std::fs::symlink_metadata(path) }
pub fn canonicalize(path: impl AsRef<Path>) -> io::Result<std::path::PathBuf> { guard_read(&path)?; std::fs::canonicalize(path) }
pub fn write(path: impl AsRef<Path>, bytes: impl AsRef<[u8]>) -> io::Result<()> { guard_write(&path)?; std::fs::write(path, bytes) }
pub fn create_dir(path: impl AsRef<Path>) -> io::Result<()> { guard_write(&path)?; std::fs::create_dir(path) }
pub fn create_dir_all(path: impl AsRef<Path>) -> io::Result<()> { guard_write(&path)?; std::fs::create_dir_all(path) }
pub fn remove_file(path: impl AsRef<Path>) -> io::Result<()> { guard_write(&path)?; std::fs::remove_file(path) }
pub fn remove_dir(path: impl AsRef<Path>) -> io::Result<()> { guard_write(&path)?; std::fs::remove_dir(path) }
pub fn remove_dir_all(path: impl AsRef<Path>) -> io::Result<()> { guard_write(&path)?; std::fs::remove_dir_all(path) }
pub fn rename(from: impl AsRef<Path>, to: impl AsRef<Path>) -> io::Result<()> { guard_write(&from)?; guard_write(&to)?; std::fs::rename(from,to) }
pub fn copy(from: impl AsRef<Path>, to: impl AsRef<Path>) -> io::Result<u64> { guard_read(&from)?; guard_write(&to)?; std::fs::copy(from,to) }
pub fn hard_link(from: impl AsRef<Path>, to: impl AsRef<Path>) -> io::Result<()> { guard_write(&from)?; guard_write(&to)?; std::fs::hard_link(from,to) }
#[derive(Clone, Debug)]
pub struct OpenOptions { inner: std::fs::OpenOptions, writing: bool }
impl Default for OpenOptions { fn default() -> Self { Self::new() } }
impl OpenOptions {
    pub fn new() -> Self { Self { inner: std::fs::OpenOptions::new(), writing:false } }
    pub fn read(&mut self, yes:bool)->&mut Self { self.inner.read(yes); self }
    pub fn write(&mut self, yes:bool)->&mut Self { self.inner.write(yes); self.writing |= yes; self }
    pub fn append(&mut self, yes:bool)->&mut Self { self.inner.append(yes); self.writing |= yes; self }
    pub fn truncate(&mut self, yes:bool)->&mut Self { self.inner.truncate(yes); self.writing |= yes; self }
    pub fn create(&mut self, yes:bool)->&mut Self { self.inner.create(yes); self.writing |= yes; self }
    pub fn create_new(&mut self, yes:bool)->&mut Self { self.inner.create_new(yes); self.writing |= yes; self }
    pub fn open(&self,path:impl AsRef<Path>)->io::Result<File> {
        if self.writing { guard_write(&path)?; } else { guard_read(&path)?; }
        self.inner.open(path)
    }
}
