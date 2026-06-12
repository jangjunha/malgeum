<script lang="ts">
  import { store } from '../lib/store.svelte';

  let mode = $state<'create' | 'import'>('create');
  let serverUrl = $state(store.serverUrl);
  let name = $state('');
  let userId = $state('');
  let identityJson = $state('');
  let busy = $state(false);

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    store.error = null;
    try {
      if (mode === 'create') {
        await store.registerAndLogin(serverUrl, name);
      } else {
        await store.importIdentity(serverUrl, userId, identityJson);
      }
    } catch (err) {
      store.error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }
</script>

<div class="wrap">
  <form class="card" onsubmit={submit}>
    <h1>voicechats</h1>
    <p class="sub">Your identity key is generated on this device. The server never sees your messages or media.</p>

    <div class="tabs">
      <button type="button" class={mode === 'create' ? 'primary' : ''} onclick={() => (mode = 'create')}>
        New identity
      </button>
      <button type="button" class={mode === 'import' ? 'primary' : ''} onclick={() => (mode = 'import')}>
        Import backup
      </button>
    </div>

    <label>
      Server
      <input bind:value={serverUrl} placeholder="https://chat.example.com" required />
    </label>

    {#if mode === 'create'}
      <label>
        Display name
        <input bind:value={name} placeholder="e.g. junha" maxlength="64" required />
      </label>
    {:else}
      <label>
        User ID
        <input bind:value={userId} required />
      </label>
      <label>
        Identity backup (JSON)
        <input bind:value={identityJson} placeholder={'{"v":1,"sign_priv":…}'} required />
      </label>
    {/if}

    <button class="primary" disabled={busy}>{busy ? '…' : mode === 'create' ? 'Create & connect' : 'Import & connect'}</button>
  </form>
</div>

<style>
  .wrap { height: 100%; display: grid; place-items: center; }
  .card {
    background: var(--bg-1);
    padding: 28px;
    border-radius: 12px;
    width: 340px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  h1 { margin: 0; font-size: 22px; }
  .sub { margin: 0; color: var(--fg-1); font-size: 12.5px; }
  .tabs { display: flex; gap: 8px; }
  .tabs button { flex: 1; }
  label { display: flex; flex-direction: column; gap: 4px; color: var(--fg-1); font-size: 12.5px; }
</style>
