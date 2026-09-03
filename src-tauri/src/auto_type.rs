use std::thread;
use std::time::Duration;
use windows::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYEVENTF_UNICODE,
    KEYEVENTF_KEYUP, VIRTUAL_KEY, VK_CONTROL, VK_LCONTROL, VK_RCONTROL, VK_LSHIFT, VK_MENU, VK_RMENU,
    VK_SHIFT, VK_TAB,
};

const MODIFIER_KEYS: [VIRTUAL_KEY; 7] = [
    VK_CONTROL,
    VK_LCONTROL,
    VK_RCONTROL,
    VK_SHIFT,
    VK_LSHIFT,
    VK_MENU,
    VK_RMENU,
];

pub fn type_text(text: &str) -> Result<(), String> {
    let mut inputs: Vec<INPUT> = Vec::new();

    for ch in text.chars() {
        // Key down
        let mut input_down = INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0::default(),
        };
        input_down.Anonymous.ki.wScan = ch as u16;
        input_down.Anonymous.ki.dwFlags = KEYEVENTF_UNICODE;
        inputs.push(input_down);

        // Key up
        let mut input_up = INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0::default(),
        };
        input_up.Anonymous.ki.wScan = ch as u16;
        input_up.Anonymous.ki.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP;
        inputs.push(input_up);
    }

    let result = unsafe {
        SendInput(
            &inputs,
            std::mem::size_of::<INPUT>() as i32,
        )
    };

    if result == 0 {
        return Err("SendInput failed".to_string());
    }

    Ok(())
}

/// Ждём, пока пользователь отпустит Ctrl/Shift/Alt. Без этого SendInput может
/// отправить символы, пока модификаторы горячей клавиши ещё зажаты.
pub(crate) fn wait_for_modifiers_released() {
    let mut any_pressed = true;
    let mut attempts = 0;
    while any_pressed && attempts < 50 {
        any_pressed = false;
        for vk in MODIFIER_KEYS {
            unsafe {
                let state = GetAsyncKeyState(vk.0 as i32);
                // Старший бит = 1, если клавиша сейчас нажата
                if (state as u16) & 0x8000 != 0 {
                    any_pressed = true;
                    break;
                }
            }
        }
        if any_pressed {
            thread::sleep(Duration::from_millis(10));
            attempts += 1;
        }
    }
}

pub fn type_username_password(username: &str, password: &str, _tab_between: bool) -> Result<(), String> {
    type_text(username)?;
    
    press_key(VK_TAB)?;
    
    thread::sleep(Duration::from_millis(50));
    type_text(password)?;
    
    Ok(())
}

fn press_key(vk: VIRTUAL_KEY) -> Result<(), String> {
    let mut inputs = Vec::new();

    // Key down
    let mut input_down = INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0::default(),
    };
    input_down.Anonymous.ki.wVk = vk;
    inputs.push(input_down);

    // Key up
    let mut input_up = INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0::default(),
    };
    input_up.Anonymous.ki.wVk = vk;
    input_up.Anonymous.ki.dwFlags = KEYEVENTF_KEYUP;
    inputs.push(input_up);

    let result = unsafe {
        SendInput(
            &inputs,
            std::mem::size_of::<INPUT>() as i32,
        )
    };

    if result == 0 {
        return Err("SendInput failed".to_string());
    }

    Ok(())
}

#[tauri::command]
pub fn auto_type_credentials(username: String, password: String) -> Result<(), String> {
    wait_for_modifiers_released();
    thread::sleep(Duration::from_millis(500));
    type_username_password(&username, &password, true)?;
    Ok(())
}

#[tauri::command]
pub fn auto_type_text(text: String) -> Result<(), String> {
    wait_for_modifiers_released();
    thread::sleep(Duration::from_millis(500));
    type_text(&text)
}

use serde::Serialize;
use windows::Win32::Foundation::HWND;
use windows::Win32::UI::WindowsAndMessaging::{
    GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId,
};

#[derive(Serialize)]
pub struct ForegroundInfo {
    pub title: String,
    /// true — активное окно принадлежит нашему процессу
    /// (хоткей нажат внутри самого Mynx)
    pub is_self: bool,
}

/// Заголовок активного окна — для сопоставления записи хранилища
/// при глобальном авто-вводе (KeePass-style).
#[tauri::command]
pub fn get_foreground_window() -> ForegroundInfo {
    unsafe {
        let hwnd: HWND = GetForegroundWindow();
        if hwnd == HWND::default() {
            return ForegroundInfo { title: String::new(), is_self: false };
        }

        let mut buf = [0u16; 512];
        let len = GetWindowTextW(hwnd, &mut buf);
        let title = if len > 0 {
            String::from_utf16_lossy(&buf[..len as usize])
        } else {
            String::new()
        };

        let mut pid: u32 = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));

        ForegroundInfo {
            title,
            is_self: pid == std::process::id(),
        }
    }
}
