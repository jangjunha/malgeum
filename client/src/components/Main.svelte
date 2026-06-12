<script lang="ts">
  import ChannelView from './ChannelView.svelte';
  import { store } from '../lib/store.svelte';

  let newChannelName = $state('');
  let addingChannel = $state(false);

  const space = $derived(store.activeSpace);
  const isOwner = $derived(space !== null && space.owner_id === store.userId);

  async function createSpace() {
    const name = prompt('Space name');
    if (name?.trim()) await store.createSpace(name.trim());
  }

  async function joinSpace() {
    const token = prompt('Invite token');
    if (token?.trim()) {
      try {
        await store.acceptInvite(token);
      } catch (e) {
        store.error = e instanceof Error ? e.message : String(e);
      }
    }
  }

  async function invite() {
    if (!space || !store.api) return;
    const { token } = await store.api.createInvite(space.id);
    await navigator.clipboard.writeText(token);
    alert(`Invite token copied to clipboard (valid 7 days):\n\n${token}`);
  }

  async function addChannel(e: SubmitEvent) {
    e.preventDefault();
    if (!space || !newChannelName.trim()) return;
    await store.api?.createChannel(space.id, newChannelName.trim());
    newChannelName = '';
    addingChannel = false;
    await store.refreshSpaces();
  }

  async function backupIdentity() {
    await navigator.clipboard.writeText(store.exportIdentity());
    alert('Identity backup copied to clipboard. Store it somewhere safe — it is the only way to move this account to another device.');
  }

  async function kick(userId: string, name: string) {
    if (!space) return;
    if (confirm(`Remove ${name} from this space? The space key will be rotated.`)) {
      await store.removeMember(space.id, userId);
    }
  }
</script>

<div class="layout">
  <nav class="rail">
    {#each store.spaces as s (s.id)}
      <button
        class="space-btn"
        class:active={s.id === store.activeSpaceId}
        title={s.name}
        onclick={() => store.selectChannel(s.id, s.channels[0]?.id ?? null)}
      >
        {s.name.slice(0, 2).toUpperCase()}
      </button>
    {/each}
    <button class="space-btn dim" title="Create space" onclick={createSpace}>+</button>
    <button class="space-btn dim" title="Join with invite" onclick={joinSpace}>⤓</button>
    <div class="spacer"></div>
    <button class="space-btn dim" title="Back up identity" onclick={backupIdentity}>🔑</button>
  </nav>

  <aside class="sidebar">
    {#if space}
      <header>{space.name}</header>
      <div class="channels">
        {#each space.channels as c (c.id)}
          <button
            class="channel"
            class:active={c.id === store.activeChannelId}
            onclick={() => store.selectChannel(space.id, c.id)}
          >
            # {c.name}
          </button>
        {/each}
        {#if isOwner}
          {#if addingChannel}
            <form onsubmit={addChannel}>
              <input bind:value={newChannelName} placeholder="channel name" maxlength="64" />
            </form>
          {:else}
            <button class="channel dim" onclick={() => (addingChannel = true)}>+ channel</button>
          {/if}
        {/if}
      </div>

      <div class="members">
        <h3>Members</h3>
        {#each store.members[space.id] ?? [] as m (m.user_id)}
          <div class="member">
            <span class:me={m.user_id === store.userId}>{m.name}</span>
            {#if m.role === 'owner'}<span class="badge">owner</span>{/if}
            {#if isOwner && m.user_id !== store.userId}
              <button class="kick" title="Remove member" onclick={() => kick(m.user_id, m.name)}>✕</button>
            {/if}
          </div>
        {/each}
        {#if isOwner}
          <button class="invite" onclick={invite}>Create invite</button>
        {/if}
      </div>
    {:else}
      <header>voicechats</header>
      <p class="hint">Create a space or join one with an invite token.</p>
    {/if}
  </aside>

  <main>
    {#if store.activeChannelId && space}
      <ChannelView channelId={store.activeChannelId} {space} />
    {:else}
      <div class="empty">No channel selected</div>
    {/if}
  </main>
</div>

<style>
  .layout {
    display: grid;
    grid-template-columns: 56px 200px 1fr;
    height: 100%;
  }
  .rail {
    background: var(--bg-0);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 8px 0;
  }
  .space-btn {
    width: 40px;
    height: 40px;
    border-radius: 12px;
    background: var(--bg-2);
    font-weight: 600;
  }
  .space-btn.active { outline: 2px solid var(--accent); }
  .space-btn.dim { color: var(--fg-1); }
  .spacer { flex: 1; }

  .sidebar {
    background: var(--bg-1);
    display: flex;
    flex-direction: column;
    overflow-y: auto;
  }
  .sidebar header {
    padding: 12px;
    font-weight: 600;
    border-bottom: 1px solid var(--bg-3);
  }
  .channels { padding: 8px; display: flex; flex-direction: column; gap: 2px; }
  .channel {
    background: transparent;
    text-align: left;
    color: var(--fg-1);
    padding: 5px 8px;
  }
  .channel.active { background: var(--bg-3); color: var(--fg-0); }
  .channel.dim { font-size: 12.5px; }
  .channels input { width: 100%; }

  .members { padding: 8px 12px; margin-top: auto; border-top: 1px solid var(--bg-3); }
  .members h3 { font-size: 11px; text-transform: uppercase; color: var(--fg-1); margin: 4px 0; }
  .member { display: flex; align-items: center; gap: 6px; padding: 3px 0; color: var(--fg-1); }
  .member .me { color: var(--fg-0); font-weight: 600; }
  .badge {
    font-size: 10px;
    background: var(--bg-3);
    border-radius: 4px;
    padding: 1px 5px;
    color: var(--fg-1);
  }
  .kick { margin-left: auto; background: transparent; color: var(--fg-1); padding: 0 4px; }
  .invite { margin-top: 8px; width: 100%; font-size: 12.5px; }

  main { background: var(--bg-2); min-width: 0; }
  .empty, .hint { color: var(--fg-1); padding: 16px; }
  .empty { display: grid; place-items: center; height: 100%; }
</style>
