<script lang="ts">
  import { store } from '../lib/store.svelte';

  let showSettings = $state(false);

  const call = $derived(store.call);
  const s = $derived(store.broadcastSettings);

  /** Codecs actually negotiable in this webview (spike: verify HW variants). */
  const availableCodecs: string[] = (() => {
    const caps = typeof RTCRtpReceiver !== 'undefined' ? RTCRtpReceiver.getCapabilities('video') : null;
    const mimes = new Set((caps?.codecs ?? []).map((c) => c.mimeType.split('/')[1]?.toUpperCase()));
    return ['H264', 'VP9', 'AV1', 'H265'].filter((c) => mimes.has(c));
  })();

  function srcObject(node: HTMLMediaElement, stream: MediaStream) {
    node.srcObject = stream;
    return {
      update(next: MediaStream) {
        if (node.srcObject !== next) node.srcObject = next;
      },
    };
  }

  function hasVideo(stream: MediaStream): boolean {
    return stream.getVideoTracks().length > 0;
  }

  function name(userId: string): string {
    return call ? store.memberName(call.spaceId, userId) : userId;
  }

  function statLine(userId: string): string {
    const st = call?.stats[userId];
    if (!st) return '';
    const parts: string[] = [];
    if (st.rttMs != null) parts.push(`${st.rttMs.toFixed(0)}ms`);
    if (st.outKbps > 0) parts.push(`↑${(st.outKbps / 1000).toFixed(1)}Mb/s`);
    if (st.inKbps > 0) parts.push(`↓${(st.inKbps / 1000).toFixed(1)}Mb/s`);
    if (st.outFps != null) parts.push(`${st.outFps}fps`);
    else if (st.inFps != null) parts.push(`${st.inFps}fps`);
    if (st.jitterBufferMs != null) parts.push(`jb ${st.jitterBufferMs.toFixed(0)}ms`);
    if (st.encoder) parts.push(st.encoder.includes('libvpx') || st.encoder.includes('OpenH264') ? 'sw-enc' : 'hw-enc');
    if (st.qualityLimitation && st.qualityLimitation !== 'none') parts.push(`limited:${st.qualityLimitation}`);
    if (st.transport === 'relay') parts.push('via relay');
    return parts.join(' · ');
  }

  const uploadEstimate = $derived(
    call && call.broadcasting
      ? (s.maxBitrateKbps * Math.max(call.participants.length - 1, 1)) / 1000
      : 0,
  );
</script>

{#if call}
  <section class="panel">
    <div class="row controls">
      <div class="participants">
        {#each call.participants as p (p)}
          <span class="chip" class:me={p === store.userId}>{name(p)}</span>
        {/each}
      </div>
      <div class="buttons">
        <button onclick={() => store.toggleMic()}>{call.micMuted ? 'Unmute' : 'Mute'}</button>
        <button class={call.broadcasting ? 'danger' : 'primary'} onclick={() => store.toggleBroadcast()}>
          {call.broadcasting ? 'Stop sharing' : 'Share screen'}
        </button>
        <button onclick={() => (showSettings = !showSettings)} title="Broadcast settings">⚙</button>
        <button class="danger" onclick={() => store.leaveCall()}>Leave</button>
      </div>
    </div>

    {#if showSettings}
      <div class="row settings">
        <label>
          Codec
          <select bind:value={s.codec} onchange={() => store.applyBroadcastSettings()}>
            <option value="auto">auto</option>
            {#each availableCodecs as c (c)}
              <option value={c}>{c}</option>
            {/each}
          </select>
        </label>
        <label>
          Max bitrate
          <select bind:value={s.maxBitrateKbps} onchange={() => store.applyBroadcastSettings()}>
            <option value={2500}>2.5 Mb/s</option>
            <option value={5000}>5 Mb/s</option>
            <option value={8000}>8 Mb/s</option>
            <option value={12000}>12 Mb/s</option>
            <option value={20000}>20 Mb/s</option>
          </select>
        </label>
        <label>
          Resolution
          <select bind:value={s.height} onchange={() => store.applyBroadcastSettings()}>
            <option value={720}>720p</option>
            <option value={1080}>1080p</option>
            <option value={1440}>1440p</option>
            <option value={0}>native</option>
          </select>
        </label>
        <label>
          FPS
          <select bind:value={s.frameRate} onchange={() => store.applyBroadcastSettings()}>
            <option value={30}>30</option>
            <option value={60}>60</option>
          </select>
        </label>
        <label class="check">
          <input type="checkbox" bind:checked={s.systemAudio} />
          Game/system audio
        </label>
        {#if uploadEstimate > 0}
          <span class="estimate">≈{uploadEstimate.toFixed(0)} Mb/s upload ({call.participants.length - 1} viewer{call.participants.length === 2 ? '' : 's'})</span>
        {/if}
      </div>
    {/if}

    <div class="tiles">
      {#if call.broadcasting && call.manager.localScreen}
        <figure class="tile local">
          <!-- svelte-ignore a11y_media_has_caption -->
          <video autoplay playsinline muted use:srcObject={call.manager.localScreen}></video>
          <figcaption>You (preview) · {statLine(call.participants.find((p) => p !== store.userId) ?? '')}</figcaption>
        </figure>
      {/if}
      {#each Object.entries(call.remoteStreams) as [userId, streams] (userId)}
        {#each streams as stream (stream.id)}
          {#if hasVideo(stream)}
            <figure class="tile">
              <!-- svelte-ignore a11y_media_has_caption -->
              <video autoplay playsinline use:srcObject={stream}></video>
              <figcaption>{name(userId)} · {statLine(userId)}</figcaption>
            </figure>
          {:else}
            <audio autoplay use:srcObject={stream}></audio>
          {/if}
        {/each}
      {/each}
    </div>
  </section>
{/if}

<style>
  .panel {
    border-bottom: 1px solid var(--bg-3);
    background: var(--bg-1);
    padding: 10px 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .controls { justify-content: space-between; }
  .participants { display: flex; gap: 6px; flex-wrap: wrap; }
  .chip {
    background: var(--bg-3);
    border-radius: 999px;
    padding: 3px 10px;
    font-size: 12.5px;
  }
  .chip.me { outline: 1px solid var(--accent); }
  .buttons { display: flex; gap: 6px; }

  .settings label {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 11.5px;
    color: var(--fg-1);
  }
  .settings label.check { flex-direction: row; align-items: center; gap: 6px; font-size: 13px; }
  .estimate { color: var(--fg-1); font-size: 12px; margin-left: auto; }

  .tiles { display: flex; gap: 10px; flex-wrap: wrap; }
  .tile { margin: 0; max-width: 480px; flex: 1 1 320px; }
  .tile video {
    width: 100%;
    border-radius: var(--radius);
    background: #000;
    aspect-ratio: 16 / 9;
  }
  .tile.local video { opacity: 0.9; }
  figcaption { font-size: 11.5px; color: var(--fg-1); margin-top: 2px; }
</style>
