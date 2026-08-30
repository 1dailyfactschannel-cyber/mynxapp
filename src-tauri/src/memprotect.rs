//! Защита памяти процесса: запрет системных дампов, повышение квоты
//! заблокированных (non-paged) страниц, вытеснение рабочего набора
//! после очистки секретов.

#[cfg(target_os = "windows")]
mod imp {
    use windows::Win32::Foundation::{CloseHandle, HANDLE, LUID};
    use windows::Win32::Security::{
        AdjustTokenPrivileges, LookupPrivilegeValueW, LUID_AND_ATTRIBUTES, SE_LOCK_MEMORY_NAME,
        SE_PRIVILEGE_ENABLED, TOKEN_ADJUST_PRIVILEGES, TOKEN_PRIVILEGES, TOKEN_QUERY,
    };
    use windows::Win32::System::Diagnostics::Debug::{
        SetErrorMode, SetUnhandledExceptionFilter, EXCEPTION_POINTERS, SEM_FAILCRITICALERRORS,
        SEM_NOGPFAULTERRORBOX, SEM_NOOPENFILEERRORBOX,
    };
    use windows::Win32::System::Threading::{
        GetCurrentProcess, OpenProcessToken, SetProcessWorkingSetSize, TerminateProcess,
    };

    /// Необработанное исключение → мгновенное завершение процесса.
    /// Windows Error Reporting не успевает снять дамп памяти процесса.
    unsafe extern "system" fn crash_filter(_info: *const EXCEPTION_POINTERS) -> i32 {
        unsafe {
            let _ = TerminateProcess(GetCurrentProcess(), 1);
        }
        // Недостижимо, но контракт фильтра требует значение
        0
    }

    /// Запрет дампов памяти процесса + квота на VirtualLock.
    /// Вызывать максимально рано при старте.
    pub fn init() {
        unsafe {
            // Без системных диалогов об ошибках — WER не вмешивается
            // и не инициирует сбор crash-дампа.
            let _ = SetErrorMode(
                SEM_FAILCRITICALERRORS | SEM_NOGPFAULTERRORBOX | SEM_NOOPENFILEERRORBOX,
            );
            SetUnhandledExceptionFilter(Some(crash_filter));
        }
        enable_lock_memory_privilege();
    }

    /// SeLockMemoryPrivilege: без неё VirtualLock ограничен ~128 КБ
    /// на процесс, чего мало для всех ключей сессии.
    fn enable_lock_memory_privilege() {
        unsafe {
            let mut token = HANDLE::default();
            if OpenProcessToken(
                GetCurrentProcess(),
                TOKEN_ADJUST_PRIVILEGES | TOKEN_QUERY,
                &mut token,
            )
            .is_err()
            {
                return;
            }

            let mut luid = LUID::default();
            if LookupPrivilegeValueW(None, SE_LOCK_MEMORY_NAME, &mut luid).is_ok() {
                let tp = TOKEN_PRIVILEGES {
                    PrivilegeCount: 1,
                    Privileges: [LUID_AND_ATTRIBUTES {
                        Luid: luid,
                        Attributes: SE_PRIVILEGE_ENABLED,
                    }],
                };
                let _ = AdjustTokenPrivileges(token, false, Some(&tp), 0, None, None);
            }
            let _ = CloseHandle(token);
        }
    }

    /// Вытеснить рабочий набор процесса из RAM.
    /// Вызывать ПОСЛЕ обнуления секретов: в файл подкачки уйдут уже
    /// затёртые страницы.
    pub fn trim_working_set() {
        unsafe {
            let _ = SetProcessWorkingSetSize(GetCurrentProcess(), usize::MAX, usize::MAX);
        }
    }
}

/// Инициализация защиты памяти (на не-Windows — no-op).
pub fn init() {
    #[cfg(target_os = "windows")]
    imp::init();
}

/// Вытеснение рабочего набора (на не-Windows — no-op).
pub fn trim_working_set() {
    #[cfg(target_os = "windows")]
    imp::trim_working_set();
}
