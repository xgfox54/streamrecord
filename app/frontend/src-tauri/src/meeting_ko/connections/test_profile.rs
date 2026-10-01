use super::{bound_credentials, credentials, ConnectionKind, Profile};
use std::ops::{Deref, DerefMut};

pub struct TestProfile(Profile);
impl Deref for TestProfile {
    type Target = Profile;
    fn deref(&self) -> &Self::Target {
        &self.0
    }
}
impl DerefMut for TestProfile {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.0
    }
}
impl Drop for TestProfile {
    fn drop(&mut self) {
        credentials::remove(&self.0.credential_key()).expect("remove disposable test credential");
    }
}

pub fn profile(base: String, kind: ConnectionKind) -> TestProfile {
    let profile = Profile {
        id: uuid::Uuid::new_v4().to_string(),
        label: "Test connection".into(),
        kind,
        base,
        enabled: true,
        manual_model_ids: vec![],
        text_only_confirmed: false,
        username: String::new(),
        revision: "test".into(),
    };
    bound_credentials::write(&profile, "").unwrap();
    TestProfile(profile)
}
