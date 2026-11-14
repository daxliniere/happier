//! Remembers the main window's size, position and maximized state between launches on
//! Windows and Linux (macOS has its own frame autosave in `macos_window_frame.rs`).
//!
//! Values are physical pixels. A saved frame is only applied when it still overlaps a connected
//! monitor, so unplugging a screen never strands the window off-screen.

use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::PathBuf,
    sync::{
        mpsc::{self, Sender},
        Arc, Mutex,
    },
    time::Duration,
};
use tauri::{PhysicalPosition, PhysicalSize, WebviewWindow, WindowEvent};

/// Writes are debounced so dragging or resizing does not hit the disk on every event.
const SAVE_DEBOUNCE: Duration = Duration::from_millis(400);
/// Part of the window (in pixels) that must lie on a monitor for the saved position to be used.
const MIN_VISIBLE_PX: i64 = 64;
const MIN_SIZE_PX: u32 = 200;
/// Height of the top strip (title bar and window controls) that must stay on a monitor, so the
/// user can always grab and close the window.
const TITLE_BAR_PX: i64 = 40;
const MIN_TITLE_BAR_VISIBLE_PX: i64 = 24;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub(crate) struct SavedFrame {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub maximized: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct MonitorArea {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

pub(crate) fn load(path: &PathBuf) -> Option<SavedFrame> {
    let bytes = fs::read(path).ok()?;
    match serde_json::from_slice::<SavedFrame>(&bytes) {
        Ok(frame) => Some(frame),
        Err(error) => {
            log::warn!("could not read saved main-window frame: {error}");
            None
        }
    }
}

fn save(path: &PathBuf, frame: &SavedFrame) {
    let result = (|| -> Result<(), String> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let bytes = serde_json::to_vec(frame).map_err(|error| error.to_string())?;
        fs::write(path, bytes).map_err(|error| error.to_string())
    })();
    if let Err(error) = result {
        log::warn!("could not save main-window frame: {error}");
    }
}

fn overlap(a_start: i64, a_len: i64, b_start: i64, b_len: i64) -> i64 {
    (a_start + a_len).min(b_start + b_len) - a_start.max(b_start)
}

/// Returns the frame to apply, or `None` when it is unusable (too small, or off every monitor).
pub(crate) fn usable_frame(saved: SavedFrame, monitors: &[MonitorArea]) -> Option<SavedFrame> {
    if saved.width < MIN_SIZE_PX || saved.height < MIN_SIZE_PX {
        return None;
    }
    let visible = monitors.iter().any(|monitor| {
        overlap(
            saved.x as i64,
            saved.width as i64,
            monitor.x as i64,
            monitor.width as i64,
        ) >= MIN_VISIBLE_PX
            && overlap(
                saved.y as i64,
                TITLE_BAR_PX,
                monitor.y as i64,
                monitor.height as i64,
            ) >= MIN_TITLE_BAR_VISIBLE_PX
    });
    visible.then_some(saved)
}

/// Applies the saved frame to a window that has not been shown yet. Returns the frame that was
/// applied, or `None` when there was nothing usable to restore.
pub(crate) fn restore(window: &WebviewWindow, path: &PathBuf) -> Option<SavedFrame> {
    let saved = load(path)?;
    let monitors: Vec<MonitorArea> = window
        .available_monitors()
        .unwrap_or_default()
        .iter()
        .map(|monitor| MonitorArea {
            x: monitor.position().x,
            y: monitor.position().y,
            width: monitor.size().width,
            height: monitor.size().height,
        })
        .collect();
    let frame = usable_frame(saved, &monitors)?;
    if let Err(error) = window.set_size(PhysicalSize::new(frame.width, frame.height)) {
        log::warn!("failed to restore main-window size: {error}");
    }
    if let Err(error) = window.set_position(PhysicalPosition::new(frame.x, frame.y)) {
        log::warn!("failed to restore main-window position: {error}");
    }
    if frame.maximized {
        if let Err(error) = window.maximize() {
            log::warn!("failed to restore maximized main window: {error}");
        }
    }
    Some(frame)
}

struct Shared {
    path: PathBuf,
    /// The latest frame and whether it still has to be written.
    state: Mutex<(SavedFrame, bool)>,
}

impl Shared {
    fn flush(&self) {
        let Ok(mut state) = self.state.lock() else {
            return;
        };
        if state.1 {
            save(&self.path, &state.0);
            state.1 = false;
        }
    }
}

/// Keeps the saved frame current; managed as app state so the exit path can flush it.
pub(crate) struct FrameTracker {
    shared: Arc<Shared>,
}

impl FrameTracker {
    /// Writes a pending frame now. Called when the app exits, which can happen inside the
    /// debounce window.
    pub(crate) fn flush(&self) {
        self.shared.flush();
    }
}

/// Starts tracking the window. `restored` is what `restore` applied; without it the window's
/// current (default, not yet maximized) geometry is the known normal frame. While maximized,
/// minimized or fullscreen the last normal size and position are kept, so un-maximizing after a
/// restart returns to the previous frame.
pub(crate) fn track(
    window: &WebviewWindow,
    path: PathBuf,
    restored: Option<SavedFrame>,
) -> FrameTracker {
    let initial = restored.unwrap_or_else(|| {
        match (window.outer_position(), window.inner_size()) {
            (Ok(position), Ok(size)) => SavedFrame {
                x: position.x,
                y: position.y,
                width: size.width,
                height: size.height,
                maximized: false,
            },
            _ => SavedFrame::default(),
        }
    });
    let shared = Arc::new(Shared {
        path,
        state: Mutex::new((initial, false)),
    });
    // One worker debounces every burst of move/resize events into a single write.
    let (wake, events) = mpsc::channel::<()>();
    let worker = Arc::clone(&shared);
    std::thread::spawn(move || {
        while events.recv().is_ok() {
            while events.recv_timeout(SAVE_DEBOUNCE).is_ok() {}
            worker.flush();
        }
    });

    let tracker = FrameTracker {
        shared: Arc::clone(&shared),
    };
    let window_for_events = window.clone();
    window.on_window_event(move |event| {
        if !matches!(event, WindowEvent::Moved(_) | WindowEvent::Resized(_)) {
            return;
        }
        let window = &window_for_events;
        if window.is_minimized().unwrap_or(false) {
            return;
        }
        let maximized = window.is_maximized().unwrap_or(false);
        let fullscreen = window.is_fullscreen().unwrap_or(false);
        {
            let Ok(mut state) = shared.state.lock() else {
                return;
            };
            let frame = &mut state.0;
            // Record `maximized` only on top of a known normal frame; otherwise the file would
            // hold zero geometry and be rejected on the next launch.
            if maximized && (frame.width < MIN_SIZE_PX || frame.height < MIN_SIZE_PX) {
                return;
            }
            frame.maximized = maximized;
            if !maximized && !fullscreen {
                if let (Ok(position), Ok(size)) = (window.outer_position(), window.inner_size()) {
                    frame.x = position.x;
                    frame.y = position.y;
                    frame.width = size.width;
                    frame.height = size.height;
                }
            }
            state.1 = true;
        }
        let _ = wake.send(());
    });
    tracker
}

#[cfg(test)]
mod tests {
    use super::*;

    const SCREEN: MonitorArea = MonitorArea {
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
    };

    fn frame(x: i32, y: i32, width: u32, height: u32) -> SavedFrame {
        SavedFrame {
            x,
            y,
            width,
            height,
            maximized: false,
        }
    }

    #[test]
    fn frame_on_a_connected_monitor_is_kept() {
        let saved = frame(100, 80, 1200, 800);
        assert_eq!(usable_frame(saved, &[SCREEN]), Some(saved));
    }

    #[test]
    fn frame_on_a_secondary_monitor_with_negative_origin_is_kept() {
        let left = MonitorArea {
            x: -1920,
            ..SCREEN
        };
        let saved = frame(-1800, 50, 1000, 700);
        assert_eq!(usable_frame(saved, &[left, SCREEN]), Some(saved));
    }

    #[test]
    fn frame_left_on_a_disconnected_monitor_is_dropped() {
        assert_eq!(usable_frame(frame(-1800, 50, 1000, 700), &[SCREEN]), None);
        assert_eq!(usable_frame(frame(5000, 0, 800, 600), &[SCREEN]), None);
    }

    #[test]
    fn frame_whose_title_bar_is_off_screen_is_dropped() {
        // Bottom edge still overlaps the monitor, but the controls are unreachable.
        assert_eq!(usable_frame(frame(100, -700, 1000, 800), &[SCREEN]), None);
        assert_eq!(usable_frame(frame(100, 1070, 1000, 800), &[SCREEN]), None);
    }

    #[test]
    fn minimized_sentinel_position_and_tiny_sizes_are_dropped() {
        assert_eq!(usable_frame(frame(-32000, -32000, 800, 600), &[SCREEN]), None);
        assert_eq!(usable_frame(frame(0, 0, 10, 10), &[SCREEN]), None);
        assert_eq!(usable_frame(SavedFrame::default(), &[SCREEN]), None);
    }

    #[test]
    fn frame_round_trips_through_disk_and_bad_files_are_ignored() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("window-state/main-window-frame.json");
        assert_eq!(load(&path), None);
        let saved = SavedFrame {
            maximized: true,
            ..frame(10, 20, 900, 700)
        };
        save(&path, &saved);
        assert_eq!(load(&path), Some(saved));
        fs::write(&path, b"not json").unwrap();
        assert_eq!(load(&path), None);
    }
}
