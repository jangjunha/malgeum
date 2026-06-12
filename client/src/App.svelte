<script lang="ts">
  import { onMount } from 'svelte';
  import Main from './components/Main.svelte';
  import Onboarding from './components/Onboarding.svelte';
  import { store } from './lib/store.svelte';

  onMount(() => {
    void store.bootstrap();
  });
</script>

{#if store.phase === 'loading'}
  <div class="center">connecting…</div>
{:else if store.phase === 'onboarding'}
  <Onboarding />
{:else}
  <Main />
{/if}

{#if store.error}
  <div class="toast" role="alert">
    {store.error}
    <button onclick={() => (store.error = null)}>✕</button>
  </div>
{/if}

<style>
  .center {
    height: 100%;
    display: grid;
    place-items: center;
    color: var(--fg-1);
  }
  .toast {
    position: fixed;
    bottom: 16px;
    left: 50%;
    transform: translateX(-50%);
    background: var(--danger);
    color: #0d1117;
    padding: 8px 12px;
    border-radius: var(--radius);
    display: flex;
    gap: 8px;
    align-items: center;
    max-width: 80vw;
  }
  .toast button { background: transparent; color: inherit; padding: 0 4px; }
</style>
