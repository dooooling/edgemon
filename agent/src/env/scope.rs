use crate::env::detect::EnvType;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ResourceScope {
    Container,
    Machine,
    Unknown,
}

impl ResourceScope {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Container => "container",
            Self::Machine => "machine",
            Self::Unknown => "unknown",
        }
    }
}

pub fn determine_resource_scope(env_type: &EnvType, _has_cgroup: bool) -> ResourceScope {
    match env_type {
        EnvType::Container => ResourceScope::Container,
        EnvType::Vm | EnvType::Physical => ResourceScope::Machine,
        EnvType::Unknown => ResourceScope::Unknown,
    }
}
