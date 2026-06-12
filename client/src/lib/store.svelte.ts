/**
 * Central app state (Svelte 5 runes) and orchestration: auth, spaces, key
 * management, message encrypt/decrypt, and call lifecycle.
 */
import { Api, type Member, type Space, type WireMessage } from './api';
import { CallManager, DEFAULT_BROADCAST, type BroadcastSettings, type PeerStats } from './call';
import {
  b64u,
  decryptMessage,
  deserializeIdentity,
  encryptMessage,
  generateIdentity,
  generateSpaceKey,
  loginSignature,
  openBox,
  sealBox,
  serializeIdentity,
  unb64u,
  type Identity,
} from './crypto';
import { EventSocket, type ServerEvent } from './ws';

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  body: string;
  createdAt: number;
  ok: boolean; // false = could not decrypt/verify
}

export interface ActiveCall {
  channelId: string;
  spaceId: string;
  manager: CallManager;
  participants: string[];
  remoteStreams: Record<string, MediaStream[]>;
  stats: Record<string, PeerStats>;
  micMuted: boolean;
  broadcasting: boolean;
}

const LS = {
  serverUrl: 'vc.serverUrl',
  identity: 'vc.identity',
  userId: 'vc.userId',
  token: 'vc.token',
};

class AppStore {
  identity: Identity | null = null;
  api: Api | null = null;
  socket: EventSocket | null = null;

  phase = $state<'loading' | 'onboarding' | 'main'>('loading');
  userId = $state<string | null>(null);
  userName = $state<string>('');
  serverUrl = $state<string>(localStorage.getItem(LS.serverUrl) ?? 'http://localhost:8787');
  error = $state<string | null>(null);

  spaces = $state<Space[]>([]);
  members = $state<Record<string, Member[]>>({});
  activeSpaceId = $state<string | null>(null);
  activeChannelId = $state<string | null>(null);
  messages = $state<Record<string, ChatMessage[]>>({});
  /** Channels whose space key we don't have yet. */
  lockedSpaces = $state<Record<string, boolean>>({});
  call = $state<ActiveCall | null>(null);
  broadcastSettings = $state<BroadcastSettings>({ ...DEFAULT_BROADCAST });

  /** epoch → key, per space. Sensitive: kept out of reactive state. */
  private spaceKeys = new Map<string, Map<number, Uint8Array>>();

  get activeSpace(): Space | null {
    return this.spaces.find((s) => s.id === this.activeSpaceId) ?? null;
  }

  // ---------- auth ----------

  async bootstrap() {
    const idJson = localStorage.getItem(LS.identity);
    const userId = localStorage.getItem(LS.userId);
    if (!idJson || !userId) {
      this.phase = 'onboarding';
      return;
    }
    try {
      this.identity = deserializeIdentity(idJson);
      this.userId = userId;
      this.api = new Api(this.serverUrl, localStorage.getItem(LS.token));
      await this.relogin();
      await this.enterMain();
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
      this.phase = 'onboarding';
    }
  }

  private async relogin() {
    if (!this.api || !this.identity || !this.userId) throw new Error('not initialized');
    const { nonce } = await this.api.challenge(this.userId);
    const { token, user } = await this.api.login(
      this.userId,
      nonce,
      loginSignature(this.identity, nonce),
    );
    this.api.token = token;
    this.userName = user.name;
    localStorage.setItem(LS.token, token);
  }

  async registerAndLogin(serverUrl: string, name: string) {
    this.serverUrl = serverUrl.replace(/\/+$/, '');
    localStorage.setItem(LS.serverUrl, this.serverUrl);
    this.identity = generateIdentity();
    this.api = new Api(this.serverUrl);
    const { user_id } = await this.api.register(
      name,
      b64u(this.identity.signPub),
      b64u(this.identity.kemPub),
    );
    this.userId = user_id;
    localStorage.setItem(LS.identity, serializeIdentity(this.identity));
    localStorage.setItem(LS.userId, user_id);
    await this.relogin();
    await this.enterMain();
  }

  async importIdentity(serverUrl: string, userId: string, identityJson: string) {
    this.serverUrl = serverUrl.replace(/\/+$/, '');
    localStorage.setItem(LS.serverUrl, this.serverUrl);
    this.identity = deserializeIdentity(identityJson);
    this.userId = userId.trim();
    this.api = new Api(this.serverUrl);
    await this.relogin();
    localStorage.setItem(LS.identity, identityJson);
    localStorage.setItem(LS.userId, this.userId);
    await this.enterMain();
  }

  /** Identity backup the user can save to move devices (docs/CRYPTO.md). */
  exportIdentity(): string {
    if (!this.identity || !this.userId) throw new Error('no identity');
    return JSON.stringify({
      user_id: this.userId,
      server: this.serverUrl,
      identity: JSON.parse(serializeIdentity(this.identity)),
    });
  }

  private async enterMain() {
    await this.refreshSpaces();
    this.connectSocket();
    this.phase = 'main';
    const first = this.spaces[0];
    if (first) await this.selectChannel(first.id, first.channels[0]?.id ?? null);
  }

  // ---------- realtime ----------

  private connectSocket() {
    if (!this.api?.token) return;
    this.socket = new EventSocket(this.serverUrl, this.api.token);
    this.socket.onEvent((ev) => void this.handleEvent(ev));
    this.socket.connect();
  }

  private async handleEvent(ev: ServerEvent) {
    switch (ev.type) {
      case 'message_new': {
        const msg = await this.decryptWire(ev.channel_id, ev.message);
        const list = this.messages[ev.channel_id];
        if (list && !list.some((m) => m.id === msg.id)) list.push(msg);
        break;
      }
      case 'channel_created': {
        const space = this.spaces.find((s) => s.id === ev.space_id);
        if (space && !space.channels.some((c) => c.id === ev.channel.id)) {
          space.channels.push(ev.channel);
        }
        break;
      }
      case 'member_joined':
        await this.refreshMembers(ev.space_id);
        break;
      case 'member_removed':
        if (ev.user_id === this.userId) {
          this.spaces = this.spaces.filter((s) => s.id !== ev.space_id);
          this.spaceKeys.delete(ev.space_id);
          if (this.activeSpaceId === ev.space_id) {
            this.activeSpaceId = null;
            this.activeChannelId = null;
          }
        } else {
          await this.refreshMembers(ev.space_id);
        }
        break;
      case 'key_request':
        await this.wrapKeysFor(ev.space_id, ev.user.user_id, ev.user.kem_pub);
        break;
      case 'keys_updated':
        await this.loadSpaceKeys(ev.space_id);
        break;
    }
  }

  // ---------- spaces & members ----------

  async refreshSpaces() {
    if (!this.api) return;
    this.spaces = (await this.api.listSpaces()).spaces;
    await Promise.all(this.spaces.map((s) => Promise.all([
      this.refreshMembers(s.id),
      this.loadSpaceKeys(s.id),
    ])));
  }

  async refreshMembers(spaceId: string) {
    if (!this.api) return;
    this.members[spaceId] = (await this.api.listMembers(spaceId)).members;
  }

  memberName(spaceId: string, userId: string): string {
    return this.members[spaceId]?.find((m) => m.user_id === userId)?.name ?? userId.slice(0, 8);
  }

  signPubOf(spaceId: string, userId: string): Uint8Array | undefined {
    const m = this.members[spaceId]?.find((m) => m.user_id === userId);
    return m ? unb64u(m.sign_pub) : undefined;
  }

  async createSpace(name: string) {
    if (!this.api || !this.identity || !this.userId) return;
    const space = await this.api.createSpace(name);
    // Generate epoch 1 and store our own wrap so other devices/members can follow.
    const key = generateSpaceKey();
    await this.api.uploadKeys(space.id, 1, [
      { user_id: this.userId, wrapped: sealBox(this.identity.kemPub, key) },
    ]);
    this.spaceKeys.set(space.id, new Map([[1, key]]));
    await this.refreshSpaces();
    await this.selectChannel(space.id, space.channels[0]?.id ?? null);
  }

  async acceptInvite(token: string) {
    if (!this.api) return;
    const space = await this.api.acceptInvite(token.trim());
    await this.refreshSpaces();
    await this.selectChannel(space.id, space.channels[0]?.id ?? null);
  }

  async removeMember(spaceId: string, userId: string) {
    if (!this.api || !this.identity) return;
    await this.api.removeMember(spaceId, userId);
    await this.refreshMembers(spaceId);
    // Rotate the space key so the removed member can't read new messages.
    const space = this.spaces.find((s) => s.id === spaceId);
    const remaining = this.members[spaceId] ?? [];
    if (!space) return;
    const newEpoch = space.current_epoch + 1;
    const key = generateSpaceKey();
    await this.api.uploadKeys(
      spaceId,
      newEpoch,
      remaining.map((m) => ({ user_id: m.user_id, wrapped: sealBox(unb64u(m.kem_pub), key) })),
    );
    space.current_epoch = newEpoch;
    this.spaceKeys.get(spaceId)?.set(newEpoch, key);
  }

  // ---------- keys ----------

  private async loadSpaceKeys(spaceId: string) {
    if (!this.api || !this.identity) return;
    const { current_epoch, wraps } = await this.api.fetchKeys(spaceId);
    const map = this.spaceKeys.get(spaceId) ?? new Map<number, Uint8Array>();
    for (const w of wraps) {
      if (map.has(w.epoch)) continue;
      try {
        map.set(w.epoch, openBox(this.identity, w.wrapped));
      } catch (e) {
        console.warn(`failed to unwrap key epoch ${w.epoch} for space ${spaceId}`, e);
      }
    }
    this.spaceKeys.set(spaceId, map);
    const space = this.spaces.find((s) => s.id === spaceId);
    if (space) space.current_epoch = current_epoch;
    this.lockedSpaces[spaceId] = !map.has(current_epoch);
  }

  private async wrapKeysFor(spaceId: string, userId: string, kemPubB64: string) {
    if (!this.api) return;
    const keys = this.spaceKeys.get(spaceId);
    if (!keys || keys.size === 0) return;
    const kemPub = unb64u(kemPubB64);
    for (const [epoch, key] of keys) {
      // First-wrap-wins on the server, so concurrent members racing is fine.
      await this.api.uploadKeys(spaceId, epoch, [
        { user_id: userId, wrapped: sealBox(kemPub, key) },
      ]).catch((e) => console.warn('key wrap upload failed', e));
    }
  }

  // ---------- messages ----------

  async selectChannel(spaceId: string, channelId: string | null) {
    this.activeSpaceId = spaceId;
    this.activeChannelId = channelId;
    if (channelId && !this.messages[channelId]) {
      await this.loadHistory(channelId);
    }
  }

  private spaceOfChannel(channelId: string): Space | null {
    return this.spaces.find((s) => s.channels.some((c) => c.id === channelId)) ?? null;
  }

  private async decryptWire(channelId: string, wire: WireMessage): Promise<ChatMessage> {
    const space = this.spaceOfChannel(channelId);
    const base = {
      id: wire.id,
      senderId: wire.sender_id,
      senderName: space ? this.memberName(space.id, wire.sender_id) : wire.sender_id,
      createdAt: wire.created_at,
    };
    if (!space) return { ...base, body: '[unknown space]', ok: false };
    const key = this.spaceKeys.get(space.id)?.get(wire.epoch);
    const pub = this.signPubOf(space.id, wire.sender_id);
    if (!key || !pub) return { ...base, body: '[no key for this message]', ok: false };
    try {
      const body = decryptMessage(pub, key, {
        spaceId: space.id,
        channelId,
        epoch: wire.epoch,
        senderId: wire.sender_id,
      }, wire) as { t: string; body: string };
      return { ...base, body: body.t === 'text' ? body.body : `[${body.t}]`, ok: true };
    } catch {
      return { ...base, body: '[failed to decrypt]', ok: false };
    }
  }

  async loadHistory(channelId: string) {
    if (!this.api) return;
    const { messages } = await this.api.fetchMessages(channelId);
    const decrypted = await Promise.all(messages.map((m) => this.decryptWire(channelId, m)));
    this.messages[channelId] = decrypted.reverse();
  }

  async sendMessage(channelId: string, text: string) {
    if (!this.api || !this.identity || !this.userId) return;
    const space = this.spaceOfChannel(channelId);
    if (!space) return;
    const key = this.spaceKeys.get(space.id)?.get(space.current_epoch);
    if (!key) {
      this.error = 'Waiting for another member to share the space key.';
      return;
    }
    const enc = encryptMessage(this.identity, key, {
      spaceId: space.id,
      channelId,
      epoch: space.current_epoch,
      senderId: this.userId,
    }, { t: 'text', body: text });
    await this.api.postMessage(channelId, { epoch: space.current_epoch, ...enc });
  }

  // ---------- calls ----------

  async joinCall(channelId: string) {
    if (!this.api || !this.identity || !this.userId || !this.socket) return;
    if (this.call) this.leaveCall();
    const space = this.spaceOfChannel(channelId);
    if (!space) return;

    const turn = await this.api.turnCredentials();
    const iceServers: RTCIceServer[] = turn.username
      ? [{ urls: turn.urls, username: turn.username, credential: turn.credential }]
      : [{ urls: turn.urls }];

    const manager = new CallManager(
      this.socket,
      this.identity,
      this.userId,
      space.id,
      channelId,
      (userId) => this.signPubOf(space.id, userId),
      iceServers,
      {
        onPeersChanged: (participants) => {
          if (this.call) this.call.participants = participants;
        },
        onRemoteStreams: (userId, streams) => {
          if (!this.call) return;
          if (streams.length === 0) delete this.call.remoteStreams[userId];
          else this.call.remoteStreams[userId] = streams;
        },
        onStats: (stats) => {
          if (this.call) this.call.stats = Object.fromEntries(stats);
        },
        onBroadcastChanged: (broadcasting) => {
          if (this.call) this.call.broadcasting = broadcasting;
        },
        onEnded: () => {
          this.call = null;
        },
      },
    );
    manager.settings = this.broadcastSettings;
    this.call = {
      channelId,
      spaceId: space.id,
      manager,
      participants: [this.userId],
      remoteStreams: {},
      stats: {},
      micMuted: false,
      broadcasting: false,
    };
    try {
      await manager.join();
    } catch (e) {
      this.call = null;
      this.error = `Could not join call: ${e instanceof Error ? e.message : e}`;
    }
  }

  leaveCall() {
    this.call?.manager.leave();
    this.call = null;
  }

  toggleMic() {
    if (!this.call) return;
    this.call.micMuted = !this.call.micMuted;
    this.call.manager.setMicMuted(this.call.micMuted);
  }

  async toggleBroadcast() {
    if (!this.call) return;
    if (this.call.broadcasting) {
      this.call.manager.stopBroadcast();
      this.call.broadcasting = false;
    } else {
      this.call.manager.settings = { ...this.broadcastSettings };
      await this.call.manager.startBroadcast();
      this.call.broadcasting = true;
    }
  }

  async applyBroadcastSettings() {
    if (!this.call) return;
    this.call.manager.settings = { ...this.broadcastSettings };
    await this.call.manager.applySenderSettings();
  }
}

export const store = new AppStore();
