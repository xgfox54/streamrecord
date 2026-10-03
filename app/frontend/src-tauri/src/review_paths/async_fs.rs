//! Guarded Tokio filesystem calls; returned handles retain their existing types (MIT).
pub use tokio::fs::*;
use std::{io,path::Path};
use super::{guard_read, guard_write};
pub async fn open_file(path:impl AsRef<Path>)->io::Result<File> { guard_read(&path)?; File::open(path).await }
pub async fn create_file(path:impl AsRef<Path>)->io::Result<File> { guard_write(&path)?; File::create(path).await }
pub async fn read(path:impl AsRef<Path>)->io::Result<Vec<u8>> { guard_read(&path)?; tokio::fs::read(path).await }
pub async fn read_to_string(path:impl AsRef<Path>)->io::Result<String> { guard_read(&path)?; tokio::fs::read_to_string(path).await }
pub async fn read_dir(path:impl AsRef<Path>)->io::Result<ReadDir> { guard_read(&path)?; tokio::fs::read_dir(path).await }
pub async fn metadata(path:impl AsRef<Path>)->io::Result<std::fs::Metadata> { guard_read(&path)?; tokio::fs::metadata(path).await }
pub async fn write(path:impl AsRef<Path>,bytes:impl AsRef<[u8]>)->io::Result<()> { guard_write(&path)?; tokio::fs::write(path,bytes).await }
pub async fn create_dir(path:impl AsRef<Path>)->io::Result<()> { guard_write(&path)?; tokio::fs::create_dir(path).await }
pub async fn create_dir_all(path:impl AsRef<Path>)->io::Result<()> { guard_write(&path)?; tokio::fs::create_dir_all(path).await }
pub async fn remove_file(path:impl AsRef<Path>)->io::Result<()> { guard_write(&path)?; tokio::fs::remove_file(path).await }
pub async fn remove_dir_all(path:impl AsRef<Path>)->io::Result<()> { guard_write(&path)?; tokio::fs::remove_dir_all(path).await }
pub async fn rename(from:impl AsRef<Path>,to:impl AsRef<Path>)->io::Result<()> { guard_write(&from)?; guard_write(&to)?; tokio::fs::rename(from,to).await }
pub async fn copy(from:impl AsRef<Path>,to:impl AsRef<Path>)->io::Result<u64> { guard_read(&from)?; guard_write(&to)?; tokio::fs::copy(from,to).await }
#[derive(Clone, Debug)]
pub struct OpenOptions { inner:tokio::fs::OpenOptions, writing:bool }
impl Default for OpenOptions { fn default()->Self { Self::new() } }
impl OpenOptions {
    pub fn new()->Self { Self { inner:tokio::fs::OpenOptions::new(),writing:false } }
    pub fn read(&mut self,yes:bool)->&mut Self { self.inner.read(yes); self }
    pub fn write(&mut self,yes:bool)->&mut Self { self.inner.write(yes); self.writing|=yes;self }
    pub fn append(&mut self,yes:bool)->&mut Self { self.inner.append(yes);self.writing|=yes;self }
    pub fn truncate(&mut self,yes:bool)->&mut Self { self.inner.truncate(yes);self.writing|=yes;self }
    pub fn create(&mut self,yes:bool)->&mut Self { self.inner.create(yes);self.writing|=yes;self }
    pub fn create_new(&mut self,yes:bool)->&mut Self { self.inner.create_new(yes);self.writing|=yes;self }
    pub async fn open(&self,path:impl AsRef<Path>)->io::Result<File> {
        if self.writing { guard_write(&path)?; } else { guard_read(&path)?; }
        self.inner.open(path).await
    }
}
