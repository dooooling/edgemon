#[cfg(unix)]
use std::ffi::CString;
#[cfg(unix)]
use std::mem::MaybeUninit;
use crate::env::detect::EnvType;
use crate::protocol::RootfsMetrics;

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
        if self.env_type == EnvType::Container && self.trusted_limit_bytes.is_none() {
            // Container with untrusted backing filesystem -> return None to prevent showing host disk usage
            return RootfsMetrics { used_bytes: None };
        }

        let used_bytes = get_rootfs_stats().map(|s| s.used_bytes);
        RootfsMetrics { used_bytes }
    }
}

struct StatvfsResult {
    total_bytes: u64,
    used_bytes: u64,
}

fn get_rootfs_stats() -> Option<StatvfsResult> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
        use std::os::windows::ffi::OsStrExt;
        unsafe {
            let drive: Vec<u16> = std::ffi::OsStr::new("C:\\\0").encode_wide().collect();
            let mut free_avail = 0u64;
            let mut total = 0u64;
            let mut total_free = 0u64;
            if GetDiskFreeSpaceExW(drive.as_ptr(), &mut free_avail, &mut total, &mut total_free) != 0 {
                let used = total.saturating_sub(total_free);
                return Some(StatvfsResult {
                    total_bytes: total,
                    used_bytes: used,
                });
            }
        }
    }

    #[cfg(unix)]
    unsafe {
        let path = CString::new("/").ok()?;
        let mut stat = MaybeUninit::<libc::statvfs>::uninit();
        if libc::statvfs(path.as_ptr(), stat.as_mut_ptr()) == 0 {
            let stat = stat.assume_init();
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

fn resolve_disk_capacity(env_type: &EnvType) -> (Option<u64>, &'static str) {
    match env_type {
        EnvType::Vm | EnvType::Physical => {
            if let Some(stats) = get_rootfs_stats() {
                if stats.total_bytes > 0 {
                    return (Some(stats.total_bytes), "visible_filesystem");
                }
            }
            (None, "unknown")
        }
        EnvType::Container | EnvType::Unknown => {
            // Containers with overlayfs/backing host filesystem must not claim host capacity as plan quota
            (None, "unknown")
        }
    }
}
