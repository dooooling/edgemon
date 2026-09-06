#[cfg(unix)]
use std::path::Path;

/// Host CPU topology: logical vs physical cores.
///
/// `physical_cores` is `None` when it cannot be determined (accuracy first:
/// never report the host total as a container quota). `cpu_capacity_cores`
/// in the hello envelope remains the sole quota-normalized capacity figure.
/// Efficiency (P-core / E-core) classification is intentionally NOT reported:
/// no OS exposes it uniformly (Linux has no sysfs interface for it), and
/// raw class numbers without a uniform interpretation would be fake data.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CpuTopology {
    pub logical_cores: u64,
    pub physical_cores: Option<u64>,
}

pub fn read_cpu_topology() -> CpuTopology {
    #[cfg(windows)]
    {
        if let Some(topo) = read_windows_topology() {
            return topo;
        }
    }
    #[cfg(unix)]
    {
        return read_linux_topology(Path::new("/sys/devices/system/cpu"));
    }
    #[allow(unreachable_code)]
    CpuTopology::default()
}

#[cfg(windows)]
fn read_windows_topology() -> Option<CpuTopology> {
    use windows_sys::Win32::System::SystemInformation::{
        GetLogicalProcessorInformationEx, RelationProcessorCore,
        SYSTEM_LOGICAL_PROCESSOR_INFORMATION_EX,
    };

    unsafe {
        let mut len: u32 = 0;
        // First call with a null buffer returns the required size.
        GetLogicalProcessorInformationEx(
            RelationProcessorCore,
            std::ptr::null_mut(),
            &mut len,
        );
        if len == 0 {
            return None;
        }
        let mut buf = vec![0u8; len as usize];
        if GetLogicalProcessorInformationEx(
            RelationProcessorCore,
            buf.as_mut_ptr() as *mut SYSTEM_LOGICAL_PROCESSOR_INFORMATION_EX,
            &mut len,
        ) == 0
        {
            return None;
        }

        let mut physical = 0u64;
        let mut logical = 0u64;
        let mut offset = 0usize;
        // NOTE: entries are variable-size; only the 8-byte
        // (Relationship, Size) header is guaranteed present. Never use
        // size_of::<ENTRY>() as the loop guard — the Rust union is sized
        // by its largest variant and would truncate the trailing entry.
        while offset + 8 <= buf.len() {
            let entry = &*(buf.as_ptr().add(offset) as *const SYSTEM_LOGICAL_PROCESSOR_INFORMATION_EX);
            let size = entry.Size as usize;
            if size < 8 || offset + size > buf.len() {
                break;
            }
            if entry.Relationship == RelationProcessorCore {
                let proc = entry.Anonymous.Processor;
                let group_count = proc.GroupCount as usize;
                let masks =
                    std::slice::from_raw_parts(proc.GroupMask.as_ptr(), group_count.min(64));
                let core_logical: u64 = masks.iter().map(|m| m.Mask.count_ones() as u64).sum();
                if core_logical > 0 {
                    physical += 1;
                    logical += core_logical;
                }
            }
            offset += size;
        }

        if physical == 0 {
            return None;
        }
        Some(CpuTopology {
            logical_cores: logical,
            physical_cores: Some(physical),
        })
    }
}

/// Linux topology from sysfs: one directory per logical CPU, each carrying
/// `topology/core_id` + `topology/physical_package_id`. Physical cores are
/// distinct (package, core) pairs. Any unreadable layout yields
/// `physical_cores: None` instead of a fabricated number.
///
/// `base` is a parameter (normally `/sys/devices/system/cpu`) so tests can
/// point it at a fixture tree.
#[cfg(unix)]
pub fn read_linux_topology(base: &Path) -> CpuTopology {
    use std::collections::BTreeSet;

    let mut logical = 0u64;
    let mut pairs = BTreeSet::new();
    let mut complete = true;

    let entries = match std::fs::read_dir(base) {
        Ok(entries) => entries,
        Err(_) => return CpuTopology::default(),
    };

    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        let rest = match name.strip_prefix("cpu") {
            Some(rest) if !rest.is_empty() && rest.bytes().all(|b| b.is_ascii_digit()) => rest,
            _ => continue,
        };
        let _ = rest;
        let topo = entry.path().join("topology");
        let core_id = std::fs::read_to_string(topo.join("core_id"))
            .ok()
            .and_then(|s| s.trim().parse::<u64>().ok());
        let package_id = std::fs::read_to_string(topo.join("physical_package_id"))
            .ok()
            .and_then(|s| s.trim().parse::<u64>().ok());
        match (core_id, package_id) {
            (Some(core), Some(package)) => {
                logical += 1;
                pairs.insert((package, core));
            }
            _ => {
                complete = false;
            }
        }
    }

    if logical == 0 {
        return CpuTopology::default();
    }
    CpuTopology {
        logical_cores: logical,
        physical_cores: if complete { Some(pairs.len() as u64) } else { None },
    }
}
