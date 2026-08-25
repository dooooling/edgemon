use serde::{Deserialize, Serialize};

pub const PROTOCOL_VERSION_V1: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Envelope<T> {
    pub v: u32,
    #[serde(rename = "type")]
    pub msg_type: String,
    pub instance_id: String,
    pub seq: u64,
    pub ts_ms: u64,
    pub data: T,
}

impl<T> Envelope<T> {
    pub fn new(msg_type: &str, instance_id: &str, seq: u64, ts_ms: u64, data: T) -> Self {
        Self {
            v: PROTOCOL_VERSION_V1,
            msg_type: msg_type.to_string(),
            instance_id: instance_id.to_string(),
            seq,
            ts_ms,
            data,
        }
    }
}
