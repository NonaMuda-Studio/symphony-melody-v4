const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { MessageFlags } = require('discord.js');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'symphony-melody-tests-'));
process.env.DATA_FILE = path.join(tempDir, 'playlists.json');

const store = require('../src/storage');
const { commands, handleCommand, lyricsSearch } = require('../src/commands');
const music = require('../src/music');

function makeInteraction({
  commandName,
  guildId = 'guild-1',
  userId = 'user-1',
  inGuild = true,
  isOwner = false,
  manageGuild = false,
  subcommand,
  strings = {},
  integers = {},
  attachments = {},
  rejectDefer = false,
  rejectEdit = false
}) {
  const calls = { deferred: [], replies: [], edits: [], followUps: [], memberEdits: [], acknowledgements: 0 };
  const interaction = {
    commandName,
    guildId: inGuild ? guildId : null,
    user: { id: userId },
    deferred: false,
    replied: false,
    inGuild: () => inGuild,
    memberPermissions: { has: () => manageGuild },
    guild: {
      ownerId: isOwner ? userId : 'another-owner',
      members: {
        editMe: async (changes) => { calls.memberEdits.push(changes); return {}; }
      }
    },
    options: {
      getSubcommand: () => subcommand,
      getString: (key, required) => {
        const value = strings[key];
        if (required && value === undefined) throw new Error(`Missing option ${key}`);
        return value;
      },
      getInteger: (key, required) => {
        const value = integers[key];
        if (required && value === undefined) throw new Error(`Missing option ${key}`);
        return value;
      },
      getAttachment: (key, required) => {
        const value = attachments[key];
        if (required && value === undefined) throw new Error(`Missing attachment ${key}`);
        return value;
      }
    },
    deferReply: async (payload) => {
      calls.deferred.push(payload || {});
      if (rejectDefer || interaction.deferred || interaction.replied) throw new Error('The reply to this interaction has already been sent or deferred.');
      calls.acknowledgements++;
      interaction.deferred = true;
    },
    editReply: async (payload) => {
      calls.edits.push(payload);
      if (rejectEdit) throw new Error('edit failed');
      interaction.deferred = false;
      interaction.replied = true;
      return payload;
    },
    reply: async (payload) => {
      calls.replies.push(payload);
      if (interaction.deferred || interaction.replied) throw new Error('The reply to this interaction has already been sent or deferred.');
      calls.acknowledgements++;
      interaction.replied = true;
      return payload;
    },
    followUp: async (payload) => { calls.followUps.push(payload); return payload; }
  };
  return { interaction, calls };
}

class FakeChild extends EventEmitter {
  constructor() {
    super();
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.stdin = new PassThrough();
    this.killed = false;
  }
  kill() { this.killed = true; return true; }
}

function makeSpawner(plans) {
  const spawned = [];
  const spawnFake = (command, args, options) => {
    const child = new FakeChild();
    spawned.push({ command, args, options, child });
    if (command === 'ffmpeg') {
      const plan = plans.shift() || { type: 'audio' };
      setImmediate(() => {
        if (plan.type === 'fail') {
          if (plan.stderr) child.stderr.write(plan.stderr);
          child.emit('close', plan.code ?? 1);
        } else {
          child.stdout.write(Buffer.from([0, 0, 0, 0]));
        }
      });
    }
    return child;
  };
  spawnFake.spawned = spawned;
  return spawnFake;
}

test('playlist pribadi dan server tersimpan, terisolasi, dapat di-rename, ditambah dan dihapus', () => {
  const personal = store.createPlaylist({ guildId: 'guild-1', ownerId: 'user-1', name: 'Favorites' });
  const privateForOtherUser = store.createPlaylist({ guildId: 'guild-1', ownerId: 'user-2', name: 'Favorites' });
  store.createPlaylist({ guildId: 'guild-1', ownerId: null, name: 'Community' });

  store.addTrack({ guildId: 'guild-1', ownerId: 'user-1', name: 'Favorites', track: { title: 'Song A', url: 'https://example.test/a' } });
  store.addTrack({ guildId: 'guild-1', ownerId: null, name: 'Community', track: { title: 'Song B', url: 'https://example.test/b' } });
  store.renamePlaylist({ guildId: 'guild-1', ownerId: 'user-1', oldName: 'Favorites', newName: 'Renamed' });

  assert.equal(store.listPlaylists('guild-1', 'user-1')[0].name, 'Renamed');
  assert.equal(store.listPlaylists('guild-1', 'user-2')[0].key, privateForOtherUser.key);
  assert.equal(store.listPlaylists('guild-1', null)[0].tracks[0].title, 'Song B');
  assert.throws(() => store.findPlaylist('guild-2', null, 'Community'), /tidak ditemukan/);
  store.createPlaylist({ guildId: 'guild-1', ownerId: 'user-1', name: 'Taken' });
  assert.throws(() => store.renamePlaylist({ guildId: 'guild-1', ownerId: 'user-1', oldName: 'Renamed', newName: 'Taken' }), /nama baru/i);

  const removed = store.removeTrack({ guildId: 'guild-1', ownerId: 'user-1', name: 'Renamed', index: 1 });
  assert.equal(removed.removed.title, 'Song A');
  assert.equal(store.findPlaylist('guild-1', 'user-1', 'Renamed').playlist.tracks.length, 0);
  const renamedKey = store.findPlaylist('guild-1', 'user-1', 'Renamed').key;
  assert.equal(JSON.parse(fs.readFileSync(process.env.DATA_FILE, 'utf8')).playlists[renamedKey].name, 'Renamed');
});

test('Termux memberi FFmpeg LD_LIBRARY_PATH khusus tanpa mengubah lingkungan bot', async (t) => {
  if (process.platform !== 'android' || !process.env.PREFIX) return t.skip('Khusus Termux Android');
  const inheritedLibraryPath = process.env.LD_LIBRARY_PATH;
  const guildId = 'termux-ffmpeg-env-test';
  const spawnFake = makeSpawner([{ type: 'audio' }]);
  await music.__test.startTrack(guildId, { title: 'Env check', url: 'https://example.test/audio' }, spawnFake);
  const ffmpegCall = spawnFake.spawned.find(({ command }) => command === 'ffmpeg');
  assert.equal(ffmpegCall.options.env.LD_LIBRARY_PATH, path.join(process.env.PREFIX, 'lib'));
  assert.equal(process.env.LD_LIBRARY_PATH, inheritedLibraryPath);
  music.stop(guildId);
});

test('startTrack membersihkan sesi ketika FFmpeg berhenti sebelum menghasilkan audio', async () => {
  const guildId = 'start-fail-test';
  const spawnFake = makeSpawner([{ type: 'fail', stderr: 'decoder failed' }]);
  await assert.rejects(music.__test.startTrack(guildId, { title: 'Broken', url: 'https://example.test/broken' }, spawnFake), /ffmpeg gagal memulai audio/i);
  const session = music.getSession(guildId);
  assert.equal(session.current, null);
  assert.equal(session.busy, false);
  assert.deepEqual(session.processes, []);
  assert(spawnFake.spawned.every(({ child }) => child.killed));
});

test('queue melewati kegagalan startTrack dan memulai track berikutnya', async () => {
  const guildId = 'queue-recovery-test';
  const session = music.getSession(guildId);
  session.queue.push(
    { title: 'Broken', url: 'https://example.test/broken' },
    { title: 'Next', url: 'https://example.test/next' }
  );
  const spawnFake = makeSpawner([{ type: 'fail' }, { type: 'audio' }]);
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;
  console.log = () => {};
  console.error = () => {};
  try { await music.__test.playNext(guildId, spawnFake); }
  finally { console.log = originalConsoleLog; console.error = originalConsoleError; }
  assert.equal(session.current.title, 'Next');
  assert.equal(session.busy, false);
  assert.equal(session.queue.length, 0);
  music.stop(guildId);
});

test('lyrics meng-encode query, menggunakan baris baru, dan menolak judul kosong', () => {
  const response = lyricsSearch('Blue Sky', 'A & B');
  assert.match(response, /Blue%20Sky%20A%20%26%20B/);
  assert(response.includes('\n'));
  assert.throws(() => lyricsSearch('   '), /wajib diisi/i);
});

test('command lyrics mengirim respons publik dan mengembalikan error input melalui editReply', async () => {
  const good = makeInteraction({ commandName: 'lyrics', strings: { song: 'Blue Sky', artist: 'A & B' } });
  await handleCommand(good.interaction);
  assert.equal(good.calls.edits.length, 1);
  assert.equal(good.calls.deferred[0].flags, undefined);
  assert(good.calls.edits[0].content.includes('\n'));

  const invalid = makeInteraction({ commandName: 'lyrics', strings: { song: '   ' } });
  await handleCommand(invalid.interaction);
  assert.match(invalid.calls.edits[0].content, /Gagal: Judul lagu wajib diisi/);
});

test('playlist add menolak URL dengan protokol yang tidak diizinkan', async () => {
  let addCalled = false;
  const fakeStore = { addTrack: () => { addCalled = true; } };
  const { interaction, calls } = makeInteraction({
    commandName: 'playlist', subcommand: 'add', strings: { scope: 'personal', name: 'Mix', url: 'javascript:alert(1)' }
  });
  await handleCommand(interaction, null, { store: fakeStore });
  assert.equal(addCalled, false);
  assert.match(calls.edits[0].content, /HTTP atau HTTPS/);
});


test('play mengembalikan error pemutaran melalui satu respons interaction', async () => {
  const { interaction, calls } = makeInteraction({ commandName: 'play', strings: { query: 'Track' } });
  const fakeMusic = { play: async () => { throw new Error('yt-dlp unavailable'); } };
  await handleCommand(interaction, null, { music: fakeMusic });
  assert.equal(calls.deferred.length, 1);
  assert.equal(calls.edits.length, 1);
  assert.match(calls.edits[0].content, /Gagal: yt-dlp unavailable/);
});

test('command musik yang ditujukan ke channel memulai deferReply publik', async () => {
  const cases = [
    { commandName: 'help' },
    { commandName: 'pause' },
    { commandName: 'resume' },
    { commandName: 'skip' },
    { commandName: 'stop' },
    { commandName: 'queue' },
    { commandName: 'nowplaying' },
    { commandName: 'volume', integers: { percent: 60 } },
    { commandName: 'leave' },
    { commandName: 'lyrics', strings: { song: 'Test song' } },
    { commandName: 'playlist', subcommand: 'list', strings: { scope: 'server' } }
  ];
  const fakeMusic = {
    getSession: () => ({ player: { pause() {}, unpause() {} }, current: null, queue: [] }),
    skip() {}, stop() {}, leave() {}, setVolume: () => 60
  };
  const fakeStore = { listPlaylists: () => [] };
  for (const options of cases) {
    const { interaction, calls } = makeInteraction(options);
    await handleCommand(interaction, null, { music: fakeMusic, store: fakeStore });
    assert.equal(calls.acknowledgements, 1, `${options.commandName} should acknowledge exactly once`);
    assert.equal(calls.deferred[0].flags, undefined, `${options.commandName} should be public`);
    assert.equal(calls.edits.length, 1, `${options.commandName} should edit its deferred reply`);
    assert.equal(calls.replies.length, 0);
    assert.equal(calls.followUps.length, 0);
  }
});

test('/play memakai deferReply satu kali lalu editReply untuk respons utama', async () => {
  const { interaction, calls } = makeInteraction({ commandName: 'play', strings: { query: 'Track' } });
  const fakeMusic = { play: async () => ({ queued: true, track: { title: 'Track' } }) };
  await handleCommand(interaction, null, { music: fakeMusic });
  assert.equal(calls.acknowledgements, 1);
  assert.equal(calls.deferred.length, 1);
  assert.equal(calls.deferred[0].flags, undefined);
  assert.equal(calls.edits.length, 1);
  assert.equal(calls.replies.length, 0);
  assert.equal(calls.followUps.length, 0);
});

test('/playlist play tidak melakukan defer kedua untuk interaction yang sama', async () => {
  const { interaction, calls } = makeInteraction({ commandName: 'playlist', subcommand: 'play', strings: { scope: 'personal', name: 'Mix' } });
  const fakeStore = { findPlaylist: () => ({ playlist: { name: 'Mix', tracks: [{ url: 'https://example.test/1' }, { url: 'https://example.test/2' }] } }) };
  const fakeMusic = { play: async (_interaction, url) => ({ queued: true, track: { title: url } }) };
  await handleCommand(interaction, null, { store: fakeStore, music: fakeMusic });
  assert.equal(calls.acknowledgements, 1);
  assert.equal(calls.deferred.length, 1);
  assert.equal(calls.deferred[0].flags, MessageFlags.Ephemeral);
  assert.equal(calls.edits.length, 1);
  assert.equal(calls.replies.length, 0);
  assert.equal(calls.followUps.length, 0);
});

test('playlist server menggunakan respons publik', async () => {
  const { interaction, calls } = makeInteraction({ commandName: 'playlist', subcommand: 'list', strings: { scope: 'server' } });
  const fakeStore = { listPlaylists: () => [{ name: 'Shared mix', tracks: [] }] };
  await handleCommand(interaction, null, { store: fakeStore });
  assert.equal(calls.acknowledgements, 1);
  assert.equal(calls.deferred[0].flags, undefined);
  assert.equal(calls.edits.length, 1);
  assert.match(calls.edits[0].content, /Shared mix/);
});

test('catch tidak mencoba respons kedua jika editReply utama gagal', async () => {
  const { interaction, calls } = makeInteraction({ commandName: 'help', rejectEdit: true });
  await handleCommand(interaction);
  assert.equal(calls.acknowledgements, 1);
  assert.equal(calls.edits.length, 1);
  assert.equal(calls.replies.length, 0);
  assert.equal(calls.followUps.length, 0);
});

test('gagal defer tidak memicu reply kedua dari catch', async () => {
  const { interaction, calls } = makeInteraction({ commandName: 'help', rejectDefer: true });
  await handleCommand(interaction);
  assert.equal(calls.deferred.length, 1);
  assert.equal(calls.acknowledgements, 0);
  assert.equal(calls.replies.length, 0);
  assert.equal(calls.edits.length, 0);
  assert.equal(calls.followUps.length, 0);
});

test('botprofile hanya mengizinkan owner atau Manage Server dan memakai editMe server-scoped', async () => {
  let globalProfileCalls = 0;
  const client = { user: { setAvatar: () => { globalProfileCalls++; }, setUsername: () => { globalProfileCalls++; } } };
  const denied = makeInteraction({ commandName: 'botprofile', subcommand: 'name', strings: { value: 'Local Name' } });
  await handleCommand(denied.interaction, client);
  assert.equal(denied.calls.memberEdits.length, 0);
  assert.match(denied.calls.edits[0].content, /Hanya pemilik server/);

  const allowed = makeInteraction({ commandName: 'botprofile', subcommand: 'name', manageGuild: true, strings: { value: 'Local Name' } });
  await handleCommand(allowed.interaction, client);
  assert.deepEqual(allowed.calls.memberEdits, [{ nick: 'Local Name', reason: 'Symphony Melody server-specific profile customization' }]);
  assert.equal(globalProfileCalls, 0);
});

test('botprofile avatar memvalidasi gambar dan hanya mengubah profil server', async () => {
  let globalProfileCalls = 0;
  const client = { user: { setAvatar: () => { globalProfileCalls++; } } };
  const { interaction, calls } = makeInteraction({
    commandName: 'botprofile', subcommand: 'avatar', isOwner: true,
    attachments: { image: { contentType: 'image/png', size: 4, url: 'https://cdn.discord.test/image.png' } }
  });
  await handleCommand(interaction, client, { fetch: async () => ({ ok: true, arrayBuffer: async () => Buffer.from([1, 2, 3, 4]) }) });
  assert(Buffer.isBuffer(calls.memberEdits[0].avatar));
  assert.match(calls.edits[0].content, /Avatar khusus server berhasil/);
  assert.equal(globalProfileCalls, 0);

  const invalid = makeInteraction({
    commandName: 'botprofile', subcommand: 'avatar', manageGuild: true,
    attachments: { image: { contentType: 'text/plain', size: 4, url: 'https://cdn.discord.test/not-image' } }
  });
  await handleCommand(invalid.interaction, client);
  assert.equal(invalid.calls.memberEdits.length, 0);
  assert.match(invalid.calls.edits[0].content, /PNG, JPG, atau WEBP/);
});

test.after(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});
