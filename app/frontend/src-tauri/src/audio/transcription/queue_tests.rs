use super::*;

pub(super) fn chunk(id: u64, device_type: DeviceType) -> AudioChunk {
    AudioChunk {
        data: vec![0.25, -0.5, 1.0],
        sample_rate: 16_000,
        timestamp: id as f64 + 0.5,
        chunk_id: id,
        device_type,
    }
}

#[tokio::test]
async fn disk_queue_preserves_order_and_audio_metadata_with_coalesced_wakes() {
    let temp = tempfile::tempdir().unwrap();
    let (sender, mut receiver) = disk_backed_queue_for_session(temp.path(), "test-session")
        .await
        .unwrap();
    let root = receiver.root.clone();
    sender.enqueue(chunk(2, DeviceType::System)).await.unwrap();
    sender
        .enqueue(chunk(1, DeviceType::Microphone))
        .await
        .unwrap();
    sender
        .enqueue(chunk(3, DeviceType::Microphone))
        .await
        .unwrap();
    drop(sender);

    let mut first = receiver.recv().await.unwrap().unwrap();
    let first_chunk = first.take_chunk();
    assert_eq!(first_chunk.chunk_id, 1);
    assert_eq!(first_chunk.data, vec![0.25, -0.5, 1.0]);
    first.commit().await.unwrap();
    let mut second = receiver.recv().await.unwrap().unwrap();
    let second_chunk = second.take_chunk();
    assert_eq!(second_chunk.chunk_id, 2);
    assert_eq!(second_chunk.device_type, DeviceType::System);
    second.commit().await.unwrap();
    let mut third = receiver.recv().await.unwrap().unwrap();
    let third_chunk = third.take_chunk();
    assert_eq!(third_chunk.chunk_id, 3);
    assert_eq!(third_chunk.sample_rate, 16_000);
    third.commit().await.unwrap();
    assert!(receiver.recv().await.unwrap().is_none());
    assert_eq!(recovery::inspect(&root).unwrap().completed, 3);
}

#[tokio::test]
async fn failed_work_is_retained_outside_the_active_queue() {
    let temp = tempfile::tempdir().unwrap();
    let (sender, mut receiver) = disk_backed_queue_for_session(temp.path(), "test-session")
        .await
        .unwrap();
    let root = receiver.root.clone();
    sender
        .enqueue(chunk(7, DeviceType::Microphone))
        .await
        .unwrap();
    drop(sender);
    let item = receiver.recv().await.unwrap().unwrap();
    let retained = item.retain("failed").await.unwrap();
    assert!(retained.exists());
    assert!(receiver.recv().await.unwrap().is_none());
    assert!(root.exists());
    fs::remove_file(retained).await.unwrap();
    drop(receiver);
}

#[test]
fn malformed_or_oversized_queue_files_are_rejected() {
    assert!(decode_chunk(b"not-a-queue-file").is_err());
    let mut bytes = encode_chunk(&chunk(1, DeviceType::Microphone));
    bytes.truncate(bytes.len() - 1);
    assert!(decode_chunk(&bytes).is_err());
}
