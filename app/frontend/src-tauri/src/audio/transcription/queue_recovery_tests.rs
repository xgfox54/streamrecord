use super::*;

#[tokio::test]
async fn interrupted_queue_resumes_pending_and_inflight_without_completed_replay() {
    // Given: a durable session with one committed and one interrupted item.
    let temp = tempfile::tempdir().unwrap();
    let (sender, mut receiver) = disk_backed_queue_for_session(temp.path(), "session-a")
        .await
        .unwrap();
    let root = receiver.directory().to_path_buf();
    sender
        .enqueue(tests::chunk(1, DeviceType::System))
        .await
        .unwrap();
    sender
        .enqueue(tests::chunk(2, DeviceType::System))
        .await
        .unwrap();
    receiver
        .recv()
        .await
        .unwrap()
        .unwrap()
        .commit()
        .await
        .unwrap();
    let interrupted = receiver.recv().await.unwrap().unwrap();
    drop(interrupted);
    drop(sender);
    drop(receiver);
    // When: a fresh receiver claims that persisted session.
    let mut recovered = DiskQueueReceiver::resume(&root, false).await.unwrap();
    // Then: completed audio is excluded; interrupted audio retains identity.
    let item = recovered.recv().await.unwrap().unwrap();
    assert_eq!(item.chunk_id(), 2);
    item.commit().await.unwrap();
    assert!(recovered.recv().await.unwrap().is_none());
}

#[tokio::test]
async fn active_queue_cannot_be_claimed_by_another_receiver() {
    // Given: an active producer and receiver own a session.
    let temp = tempfile::tempdir().unwrap();
    let (_sender, receiver) = disk_backed_queue_for_session(temp.path(), "active")
        .await
        .unwrap();
    // When: another receiver tries to claim the same directory.
    let result = DiskQueueReceiver::resume(receiver.directory(), false).await;
    // Then: ownership is rejected without modifying the queue.
    assert!(result.is_err());
}

#[tokio::test]
async fn retained_failure_requires_explicit_retry() {
    // Given: a failed item survives the original process ownership.
    let temp = tempfile::tempdir().unwrap();
    let (sender, mut receiver) = disk_backed_queue_for_session(temp.path(), "failed")
        .await
        .unwrap();
    let root = receiver.directory().to_path_buf();
    sender
        .enqueue(tests::chunk(7, DeviceType::System))
        .await
        .unwrap();
    receiver
        .recv()
        .await
        .unwrap()
        .unwrap()
        .retain("failed")
        .await
        .unwrap();
    drop(sender);
    drop(receiver);
    // When: normal recovery excludes failures.
    let mut recovered = DiskQueueReceiver::resume(&root, false).await.unwrap();
    assert!(recovered.recv().await.unwrap().is_none());
    drop(recovered);
    // Then: explicit retry includes the preserved original.
    let mut retry = DiskQueueReceiver::resume(&root, true).await.unwrap();
    assert_eq!(retry.recv().await.unwrap().unwrap().chunk_id(), 7);
}

#[tokio::test]
async fn receiver_exit_preserves_accepted_audio_and_duplicate_ids_do_not_overwrite() {
    // Given: the receiver stopped while capture still holds a producer.
    let temp = tempfile::tempdir().unwrap();
    let (sender, receiver) = disk_backed_queue_for_session(temp.path(), "closed")
        .await
        .unwrap();
    let root = receiver.directory().to_path_buf();
    drop(receiver);
    // When: delivery cannot notify the worker.
    assert!(sender
        .enqueue(tests::chunk(9, DeviceType::System))
        .await
        .is_err());
    assert!(sender
        .enqueue(tests::chunk(9, DeviceType::Microphone))
        .await
        .is_err());
    drop(sender);
    // Then: recovery still has the first committed audio, not replacement input.
    let mut recovered = DiskQueueReceiver::resume(&root, false).await.unwrap();
    assert_eq!(
        recovered
            .recv()
            .await
            .unwrap()
            .unwrap()
            .take_chunk()
            .device_type,
        DeviceType::System
    );
}

#[test]
fn process_death_releases_claim_and_preserves_inflight_audio() {
    // Given: an isolated child process owns a session and exits without destructors.
    let temp = tempfile::tempdir().unwrap();
    let status = std::process::Command::new(std::env::current_exe().unwrap())
        .args(["crash_fixture_child", "--nocapture"])
        .env("STREAM_RECORD_RECOVERY_FIXTURE", temp.path())
        .status()
        .unwrap();
    assert_eq!(status.code(), Some(29));
    // When: a fresh runtime resumes the abandoned queue.
    let sessions = recovery::discover(temp.path()).unwrap();
    let runtime = tokio::runtime::Runtime::new().unwrap();
    runtime.block_on(async {
        let mut recovered = DiskQueueReceiver::resume(&sessions[0].directory, false)
            .await
            .unwrap();
        // Then: completed chunk 1 stays excluded, in-flight chunk 2 is available once.
        let item = recovered.recv().await.unwrap().unwrap();
        assert_eq!(item.chunk_id(), 2);
        item.commit().await.unwrap();
        assert!(recovered.recv().await.unwrap().is_none());
    });
}

#[test]
fn crash_fixture_child() {
    let Some(root) = std::env::var_os("STREAM_RECORD_RECOVERY_FIXTURE") else {
        return;
    };
    tokio::runtime::Runtime::new().unwrap().block_on(async {
        let (sender, mut receiver) =
            disk_backed_queue_for_session(Path::new(&root), "child-session")
                .await
                .unwrap();
        sender
            .enqueue(tests::chunk(1, DeviceType::System))
            .await
            .unwrap();
        sender
            .enqueue(tests::chunk(2, DeviceType::System))
            .await
            .unwrap();
        receiver
            .recv()
            .await
            .unwrap()
            .unwrap()
            .commit()
            .await
            .unwrap();
        let _inflight = receiver.recv().await.unwrap().unwrap();
        std::process::exit(29);
    });
}

#[tokio::test]
async fn inference_receipt_survives_before_transcript_commit() {
    // Given: inference was durably journaled, but the process never acknowledged its chunk.
    let temp = tempfile::tempdir().unwrap();
    let (sender, mut receiver) = disk_backed_queue_for_session(temp.path(), "receipt")
        .await
        .unwrap();
    let root = receiver.directory().to_path_buf();
    sender
        .enqueue(tests::chunk(3, DeviceType::System))
        .await
        .unwrap();
    let item = receiver.recv().await.unwrap().unwrap();
    item.save_result(&vec!["original transcript", "raw engine output"])
        .await
        .unwrap();
    drop(item);
    drop(sender);
    drop(receiver);
    // When: recovery claims the abandoned chunk.
    let mut recovered = DiskQueueReceiver::resume(&root, false).await.unwrap();
    let item = recovered.recv().await.unwrap().unwrap();
    // Then: the exact prior result is reusable instead of generating another transcript.
    assert_eq!(
        item.saved_result::<Vec<String>>().await.unwrap(),
        Some(vec![
            "original transcript".into(),
            "raw engine output".into()
        ])
    );
}

#[tokio::test]
async fn legacy_queue_is_visible_but_never_assumed_to_be_current_session() {
    // Given: an old version left audio without session metadata.
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("transcription-spool-legacy");
    crate::review_paths::fs::create_dir(&root).unwrap();
    crate::review_paths::fs::write(
        root.join("00000000000000000001.chunk"),
        encode_chunk(&tests::chunk(1, DeviceType::System)),
    )
    .unwrap();
    // When: discovery inspects the legacy directory without changing it.
    let sessions = recovery::discover(temp.path()).unwrap();
    // Then: it remains identifiable but cannot silently replay into today's session.
    assert!(sessions[0].legacy);
    assert_eq!(sessions[0].pending, 1);
    assert!(DiskQueueReceiver::resume(&root, true).await.is_err());
}

#[tokio::test]
async fn failed_receipt_write_keeps_original_audio_recoverable() {
    // Given: a read-only destination conflict makes receipt persistence fail.
    let temp = tempfile::tempdir().unwrap();
    let (sender, mut receiver) = disk_backed_queue_for_session(temp.path(), "write-failure")
        .await
        .unwrap();
    let root = receiver.directory().to_path_buf();
    sender
        .enqueue(tests::chunk(4, DeviceType::System))
        .await
        .unwrap();
    let item = receiver.recv().await.unwrap().unwrap();
    crate::review_paths::fs::create_dir(root.join("00000000000000000004.result.json")).unwrap();
    // When: saving inference fails before acknowledging the audio.
    assert!(item.save_result(&vec!["recoverable text"]).await.is_err());
    drop(item);
    drop(sender);
    drop(receiver);
    // Then: the original queue item remains pending, not falsely completed.
    let info = recovery::inspect(&root).unwrap();
    assert_eq!(info.pending, 1);
    assert_eq!(info.completed, 0);
}

#[tokio::test]
async fn partial_write_fragments_prevent_recovery_completion() {
    // Given: the queue has no pending chunks, but an interrupted write remains.
    let temp = tempfile::tempdir().unwrap();
    let (sender, receiver) = disk_backed_queue_for_session(temp.path(), "partial-write")
        .await
        .unwrap();
    let root = receiver.directory().to_path_buf();
    crate::review_paths::fs::write(root.join("00000000000000000001.tmp"), b"partial audio").unwrap();
    drop(sender);
    drop(receiver);
    // When: recovery inspects the remaining disk contents.
    let status = recovery::inspect(&root).unwrap();
    // Then: it reports an incomplete write and cannot claim complete recovery.
    assert_eq!(status.pending, 0);
    assert_eq!(status.partial_writes, 1);
    assert!(!status.processing_complete());
}
