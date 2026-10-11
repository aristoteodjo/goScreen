//! In development, macOS asks the app that launched goScreen (Portly, a
//! terminal) for the microphone, camera and screen, and an app that never
//! declared them gets silence instead of a prompt. goScreen relaunches itself
//! once, disclaimed, so macOS asks about goScreen, as it does for the bundle.

use std::ffi::CString;
use std::sync::atomic::{AtomicI32, Ordering};

const MARK: &str = "GOSCREEN_DISCLAIMED";

extern "C" {
    // libSystem: the spawned process is responsible for itself.
    fn responsibility_spawnattrs_setdisclaim(attrs: *mut libc::posix_spawnattr_t, disclaim: libc::c_int) -> libc::c_int;
}

static CHILD: AtomicI32 = AtomicI32::new(0);

extern "C" fn forward(signal: libc::c_int) {
    let pid = CHILD.load(Ordering::SeqCst);
    if pid > 0 {
        unsafe { libc::kill(pid, signal) };
    }
}

/// Returns in the disclaimed process; the launcher waits for it and exits
/// with its code. Any failure keeps the current process as it is.
pub fn relaunch() {
    if let Some(parent) = std::env::var_os(MARK) {
        watch_launcher(parent.to_string_lossy().parse().unwrap_or(0));
        return;
    }
    let Ok(exe) = std::env::current_exe() else { return };
    let Ok(path) = CString::new(exe.to_string_lossy().as_bytes()) else { return };
    let args: Vec<CString> = std::env::args().filter_map(|a| CString::new(a).ok()).collect();
    let mut env: Vec<CString> = std::env::vars()
        .filter_map(|(k, v)| CString::new(format!("{k}={v}")).ok())
        .collect();
    if let Ok(mark) = CString::new(format!("{MARK}={}", std::process::id())) {
        env.push(mark);
    }
    let mut argv: Vec<*mut libc::c_char> = args.iter().map(|a| a.as_ptr() as *mut _).collect();
    argv.push(std::ptr::null_mut());
    let mut envp: Vec<*mut libc::c_char> = env.iter().map(|e| e.as_ptr() as *mut _).collect();
    envp.push(std::ptr::null_mut());

    unsafe {
        let mut attrs: libc::posix_spawnattr_t = std::mem::zeroed();
        if libc::posix_spawnattr_init(&mut attrs) != 0 {
            return;
        }
        let mut pid: libc::pid_t = 0;
        let spawned = responsibility_spawnattrs_setdisclaim(&mut attrs, 1) == 0
            && libc::posix_spawn(&mut pid, path.as_ptr(), std::ptr::null(), &attrs, argv.as_ptr(), envp.as_ptr()) == 0;
        libc::posix_spawnattr_destroy(&mut attrs);
        if !spawned {
            return;
        }
        CHILD.store(pid, Ordering::SeqCst);
        for signal in [libc::SIGTERM, libc::SIGINT, libc::SIGHUP] {
            libc::signal(signal, forward as libc::sighandler_t);
        }
        let mut status = 0;
        while libc::waitpid(pid, &mut status, 0) == -1 && *libc::__error() == libc::EINTR {}
        let code = if libc::WIFEXITED(status) { libc::WEXITSTATUS(status) } else { 1 };
        std::process::exit(code);
    }
}

/// The dev server stops the launcher with SIGKILL on a rebuild, which cannot
/// be forwarded: the app quits when its launcher is gone.
fn watch_launcher(launcher: i32) {
    if launcher <= 1 {
        return;
    }
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_millis(400));
        if unsafe { libc::kill(launcher, 0) } != 0 {
            std::process::exit(0);
        }
    });
}
