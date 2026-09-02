//! Уровневый файловый лог с ротацией (P2-13).
//!
//! Раньше диагностика шла только через `eprintln!`: в release-сборке
//! (`windows_subsystem = "windows"`) stderr никуда не пишется, и причины
//! падения API/IPC-серверов терялись безвозвратно. Теперь логи пишутся в
//! `<app_data_dir>/logs/mynx.log` с уровнями INFO/WARN/ERROR; при
//! превышении 5 МБ файл переименовывается в `mynx.old.log` (хранится
//! одна предыдущая ротация — лог не содержит секретов, только текст
//! ошибок серверов, и никто в векторе атак на него не завязан).
//! WARN/ERROR дублируются в stderr — при запуске из терминала видно так же,
//! как раньше, плюс остаётся файл.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub enum Level {
    Info,
    Warn,
    Error,
}

impl Level {
    fn as_str(self) -> &'static str {
        match self {
            Level::Info => "INFO",
            Level::Warn => "WARN",
            Level::Error => "ERROR",
        }
    }
}

const MAX_LOG_BYTES: u64 = 5 * 1024 * 1024;

static LOG_DIR: OnceLock<PathBuf> = OnceLock::new();
static START: OnceLock<Instant> = OnceLock::new();
static WRITE_LOCK: Mutex<()> = Mutex::new(());

/// Каталог логов задаётся один раз из `main::setup` (app_data_dir).
/// До инициализации логируем только в stderr.
pub fn init(dir: PathBuf) {
    let _ = START.set(Instant::now());
    let _ = LOG_DIR.set(dir);
}

pub fn log(level: Level, message: &str) {
    let uptime = START
        .get()
        .map(|s| s.elapsed().as_secs_f64())
        .unwrap_or(0.0);
    let line = format!("[+{uptime:9.3}s] [{:<5}] {}", level.as_str(), message);

    if let Some(dir) = LOG_DIR.get() {
        let _guard = WRITE_LOCK.lock();
        if fs::create_dir_all(dir).is_ok() {
            let path = dir.join("mynx.log");
            // Ротация: текущий файл вырос — переименовываем в mynx.old.log.
            if let Ok(meta) = fs::metadata(&path) {
                if meta.len() > MAX_LOG_BYTES {
                    let _ = fs::rename(&path, dir.join("mynx.old.log"));
                }
            }
            if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(&path) {
                let _ = writeln!(f, "{line}");
            }
        }
    }

    if level >= Level::Warn {
        eprintln!("{line}");
    }
}

#[macro_export]
macro_rules! log_info {
    ($($arg:tt)*) => { $crate::logging::log($crate::logging::Level::Info, &format!($($arg)*)) };
}

#[macro_export]
macro_rules! log_warn {
    ($($arg:tt)*) => { $crate::logging::log($crate::logging::Level::Warn, &format!($($arg)*)) };
}

#[macro_export]
macro_rules! log_error {
    ($($arg:tt)*) => { $crate::logging::log($crate::logging::Level::Error, &format!($($arg)*)) };
}
