use super::*;
pub(super) fn encode_chunk(chunk: &AudioChunk) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(HEADER_BYTES + chunk.data.len() * 4);
    bytes.extend_from_slice(MAGIC);
    bytes.extend_from_slice(&chunk.sample_rate.to_le_bytes());
    bytes.extend_from_slice(&chunk.timestamp.to_bits().to_le_bytes());
    bytes.extend_from_slice(&chunk.chunk_id.to_le_bytes());
    bytes.push(match chunk.device_type {
        DeviceType::Microphone => 0,
        DeviceType::System => 1,
    });
    bytes.extend_from_slice(&(chunk.data.len() as u64).to_le_bytes());
    for sample in &chunk.data {
        bytes.extend_from_slice(&sample.to_bits().to_le_bytes());
    }
    bytes
}

pub(super) fn decode_chunk(bytes: &[u8]) -> Result<AudioChunk> {
    if bytes.len() < HEADER_BYTES || &bytes[..4] != MAGIC {
        bail!("받아쓰기 대기열 파일 헤더가 올바르지 않습니다");
    }
    let sample_rate = u32::from_le_bytes(bytes[4..8].try_into()?);
    let timestamp = f64::from_bits(u64::from_le_bytes(bytes[8..16].try_into()?));
    let chunk_id = u64::from_le_bytes(bytes[16..24].try_into()?);
    let device_type = match bytes[24] {
        0 => DeviceType::Microphone,
        1 => DeviceType::System,
        _ => bail!("받아쓰기 대기열의 입력 장치 구분값이 올바르지 않습니다"),
    };
    let sample_count = usize::try_from(u64::from_le_bytes(bytes[25..33].try_into()?))?;
    if sample_rate == 0
        || !timestamp.is_finite()
        || timestamp < 0.0
        || sample_count > MAX_CHUNK_SAMPLES
        || bytes.len() != HEADER_BYTES.saturating_add(sample_count.saturating_mul(4))
    {
        bail!("받아쓰기 대기열 파일 크기가 올바르지 않습니다");
    }
    let mut data = Vec::with_capacity(sample_count);
    for raw in bytes[HEADER_BYTES..].chunks_exact(4) {
        data.push(f32::from_bits(u32::from_le_bytes(raw.try_into()?)));
    }
    Ok(AudioChunk {
        data,
        sample_rate,
        timestamp,
        chunk_id,
        device_type,
    })
}
