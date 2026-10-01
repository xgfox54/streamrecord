use super::*;
use serde::{de::DeserializeOwned, Serialize};

impl DiskQueueItem {
    /// Persist inference before the transcript snapshot commit. Retry can reuse it verbatim.
    pub async fn save_result<T: Serialize>(&self, result: &T) -> Result<()> {
        let destination = self.path.with_extension("result.json");
        let temporary = self
            .path
            .with_extension(format!("result-{}.tmp", uuid::Uuid::new_v4()));
        let bytes = serde_json::to_vec(result)?;
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .await?;
        file.write_all(&bytes).await?;
        file.sync_all().await?;
        drop(file);
        fs::hard_link(&temporary, &destination).await?;
        fs::remove_file(temporary).await?;
        Ok(())
    }

    pub async fn saved_result<T: DeserializeOwned>(&self) -> Result<Option<T>> {
        match fs::read(self.path.with_extension("result.json")).await {
            Ok(bytes) => Ok(Some(serde_json::from_slice(&bytes)?)),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error.into()),
        }
    }
}

impl DiskQueueReceiver {
    pub fn bind_session_folder(&self, folder: &Path) -> Result<()> {
        use std::io::Write;
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(self.root.join("recording-folder.json"))?;
        file.write_all(&serde_json::to_vec(folder)?)?;
        file.sync_all()?;
        Ok(())
    }
}
