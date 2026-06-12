//! WASAPI loopback fallback for system/game audio capture.
//!
//! Primary path for system audio is Chromium's own `getDisplayMedia` audio
//! loopback inside WebView2 (docs/DECISIONS.md §3). This module is the
//! fallback if the Windows spike (docs/SPIKE.md §2) finds that the WebView2
//! share picker cannot deliver system audio.
//!
//! Planned shape (deliberately not built until the spike demands it):
//! 1. A dedicated thread opens the default render device in WASAPI loopback
//!    mode (`AUDCLNT_STREAMFLAGS_LOOPBACK`) via the `wasapi` or `cpal` crate.
//! 2. PCM chunks are pushed to the page through a Tauri channel
//!    (`tauri::ipc::Channel<Vec<f32>>`).
//! 3. The page feeds them into an `AudioWorklet` →
//!    `MediaStreamAudioDestinationNode`, whose track is added to every peer
//!    connection exactly like a picker-provided audio track.

#[allow(dead_code)]
pub fn start_loopback_capture() -> Result<(), String> {
    Err("WASAPI loopback fallback not implemented; see docs/SPIKE.md §2".into())
}
