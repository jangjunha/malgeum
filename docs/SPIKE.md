# Milestone 0 — Windows validation spike

Goal: prove the riskiest assumptions of the WebView2 media decision on real
hardware **before** deep feature work. Run on at least one gaming PC
(Windows 11, discrete GPU) and ideally one second machine as the viewer.

Run the client (`npm run tauri dev`), open the built-in **Diagnostics** panel
(call view → stats overlay), and walk this checklist:

## 1. Monitor capture

- [ ] `getDisplayMedia` picker appears, full monitor selectable.
- [ ] Capture of a full-screen game runs at the requested FPS (test 30 and
      60) — *not* the ~5 FPS known to affect window capture
      (WebView2Feedback #4176).
- [ ] Exclusive-fullscreen games capture correctly; if black frames occur,
      test borderless-windowed and note it as a user-facing recommendation.
- [ ] Picker dialog is not clipped (window kept ≥600 px; #5173).

## 2. System / game audio

- [ ] The picker offers "also share system audio" when a monitor is selected,
      and the resulting stream has an audio track carrying game audio.
- [ ] If **not**: flip on the Rust-side WASAPI loopback fallback
      (`client/src-tauri/src/audio_loopback.rs`) and verify game audio reaches
      the viewer through the Web Audio bridge instead.
- [ ] Mic vs. system-audio toggle behaves (mute one, hear the other).

## 3. Hardware encoding

- [ ] With H.264 selected, `chrome://webrtc-internals`-equivalent stats (the
      app surfaces `getStats()`) show `encoderImplementation` containing
      `MediaFoundation`/`D3D12` — i.e., **not** `libvpx`/`OpenH264` software.
- [ ] HEVC and AV1 availability recorded for each GPU vendor present.
- [ ] Game FPS impact while broadcasting 1080p60 @ 8 Mbps is acceptable
      (measure with the game's FPS counter, before/after).

## 4. Latency & quality telemetry

- [ ] Glass-to-glass latency measured (point a phone camera at both screens
      with a running millisecond timer on the sender). Target: comparable to
      Discord (~200–400 ms); record the number.
- [ ] `getStats()` shows sane `currentRoundTripTime`, `jitterBufferDelay`,
      `framesPerSecond`, `qualityLimitationReason`.
- [ ] Throttle the sender's uplink (e.g., NetLimiter) and confirm congestion
      control degrades bitrate gracefully rather than freezing.

## 5. Sender controls

- [ ] Codec switch (H.264 ↔ VP9 ↔ HEVC/AV1 where available) takes effect
      (verify via stats).
- [ ] Max-bitrate cap is honored (set 4 Mbps, observe outgoing bitrate).
- [ ] Resolution/FPS constraints take effect.
- [ ] Fan-out: 3–4 viewers simultaneously; sender upload ≈ per-viewer bitrate
      × N; UI shows the total.

## Exit criteria

All of §1–§3 pass (with the WASAPI fallback engaged if §2's picker path
fails), and §4 latency is within ~1.5× of Discord on the same network.
If monitor capture FPS or HW encode fail fundamentally, stop and revisit
docs/DECISIONS.md §3 (native libwebrtc escape hatch) before building further.

Record results in this file under a dated heading.
