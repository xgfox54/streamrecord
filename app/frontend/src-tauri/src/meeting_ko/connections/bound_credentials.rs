//! An atomic encrypted record binds credentials to an immutable profile revision.
use super::{credentials, types::Profile};
use serde::{Deserialize, Serialize};

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Record {
    revision: String,
    secret: String,
}

pub fn read(profile: &Profile) -> Result<String, String> {
    let value = credentials::read(&profile.credential_key())?
        .ok_or("연결 인증 정보가 변경되거나 삭제되었습니다. 연결을 다시 선택하세요.")?;
    let record: Record = serde_json::from_str(&value)
        .map_err(|_| "연결 인증 정보 형식이 올바르지 않습니다. 연결을 다시 저장하세요.")?;
    if record.revision != profile.revision {
        return Err("연결 설정이 변경되었습니다. 모델 목록을 새로 고치고 다시 선택하세요.".into());
    }
    Ok(record.secret)
}

pub fn write(profile: &Profile, secret: &str) -> Result<(), String> {
    let record = Record {
        revision: profile.revision.clone(),
        secret: secret.to_owned(),
    };
    let value =
        serde_json::to_string(&record).map_err(|_| "연결 인증 정보를 변환하지 못했습니다.")?;
    credentials::write(&profile.credential_key(), &value)
}
