use crate::env::detect::EnvType;
use crate::protocol::{MountUsage, RootfsMetrics};
#[cfg(unix)]
use std::ffi::CString;
#[cfg(unix)]
use std::fs;
#[cfg(unix)]
use std::mem::MaybeUninit;

pub struct DiskCollector {
    env_type: EnvType,
    trusted_limit_bytes: Option<u64>,
    scope_str: &'static str,
}

impl DiskCollector {
    pub fn new(env_type: EnvType) -> Self {
        let (limit, scope_str) = resolve_disk_capacity(&env_type);
        Self {
            env_type,
            trusted_limit_bytes: limit,
            scope_str,
        }
    }

    pub fn trusted_limit_bytes(&self) -> Option<u64> {
        self.trusted_limit_bytes
    }

    pub fn scope_str(&self) -> &'static str {
        self.scope_str
    }

    pub fn sample(&self) -> RootfsMetrics {
        let mounts = read_mounts(&self.env_type);

        if self.env_type == EnvType::Container && self.trusted_limit_bytes.is_none() {
            // Container with untrusted backing filesystem -> return None to prevent showing host disk usage
            return RootfsMetrics {
                used_bytes: None,
                mounts,
            };
        }

        let used_bytes = get_path_stats("/").map(|s| s.used_bytes);
        RootfsMetrics { used_bytes, mounts }
    }
}

struct StatvfsResult {
    total_bytes: u64,
    used_bytes: u64,
}

#[allow(clippy::unnecessary_cast, clippy::useless_conversion)]
fn get_path_stats(path_str: &str) -> Option<StatvfsResult> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
        unsafe {
            let win_path = if path_str == "/" { "C:\\" } else { path_str };
            let mut wide: Vec<u16> = std::ffi::OsStr::new(win_path).encode_wide().collect();
            wide.push(0);
            let mut free_avail = 0u64;
            let mut total = 0u64;
            let mut total_free = 0u64;
            if GetDiskFreeSpaceExW(wide.as_ptr(), &mut free_avail, &mut total, &mut total_free) != 0
            {
                let used = total.saturating_sub(total_free);
                return Some(StatvfsResult {
                    total_bytes: total,
                    used_bytes: used,
                });
            }
        }
    }

    #[cfg(unix)]
    {
        let path = CString::new(path_str).ok()?;
        let mut stat = MaybeUninit::<libc::statvfs>::uninit();
        let res = unsafe { libc::statvfs(path.as_ptr(), stat.as_mut_ptr()) };
        if res == 0 {
            let stat = unsafe { stat.assume_init() };
            let bsize = stat.f_frsize as u64;
            let total = stat.f_blocks as u64 * bsize;
            let free = stat.f_bfree as u64 * bsize;
            let used = total.saturating_sub(free);
            return Some(StatvfsResult {
                total_bytes: total,
                used_bytes: used,
            });
        }
    }
    None
}

fn read_mounts(_env_type: &EnvType) -> Option<Vec<MountUsage>> {
    #[cfg(windows)]
    {
        let mut results = Vec::new();
        for drive_letter in b'C'..=b'Z' {
            let root = format!("{}:\\", drive_letter as char);
            if let Some(stats) = get_path_stats(&root) {
                if stats.total_bytes > 0 {
                    results.push(MountUsage {
                        mount_point: root,
                        total_bytes: Some(stats.total_bytes),
                        used_bytes: Some(stats.used_bytes),
                        fs_type: "NTFS".to_string(),
                    });
                }
            }
        }
        if !results.is_empty() {
            return Some(results);
        }
    }

    #[cfg(unix)]
    {
        if *_env_type == EnvType::Container {
            return None;
        }

        if let Ok(content) = fs::read_to_string("/proc/mounts") {
            let mut results = Vec::new();
            let mut seen_mounts = std::collections::HashSet::new();

            for line in content.lines() {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 3 {
                    let dev = parts[0];
                    let mount_point = parts[1];
                    let fs_type = parts[2];

                    // Only physical and common block devices
                    if (dev.starts_with("/dev/") || dev.starts_with("/dev/mapper/"))
                        && !fs_type.starts_with("tmpfs")
                        && !fs_type.starts_with("devtmpfs")
                        && !fs_type.starts_with("squashfs")
                        && !seen_mounts.contains(mount_point)
                    {
                        seen_mounts.insert(mount_point.to_string());
                        if let Some(stats) = get_path_stats(mount_point) {
                            if stats.total_bytes > 0 {
                                results.push(MountUsage {
                                    mount_point: mount_point.to_string(),
                                    total_bytes: Some(stats.total_bytes),
                                    used_bytes: Some(stats.used_bytes),
                                    fs_type: fs_type.to_string(),
                                });
                            }
                        }
                    }
                }
            }
            if !results.is_empty() {
                return Some(results);
            }
        }
    }

    None
}

fn resolve_disk_capacity(env_type: &EnvType) -> (Option<u64>, &'static str) {
    match env_type {
        EnvType::Vm | EnvType::Physical => {
            if let Some(stats) = get_path_stats("/") {
                if stats.total_bytes > 0 {
                    return (Some(stats.total_bytes), "visible_filesystem");
                }
            }
            (None, "unknown")
        }
        EnvType::Container => (None, "container_untrusted"),
        EnvType::Unknown => (None, "unknown"),
    }
}
