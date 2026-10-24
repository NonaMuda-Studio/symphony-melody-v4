const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const {
  joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus,
  VoiceConnectionStatus, entersState, StreamType, NoSubscriberBehavior
} = require("@discordjs/voice");
const log = require("./logger");

const ytdlpPath = process.env.YTDLP_PATH || "yt-dlp";
const ffmpegPath = process.env.FFMPEG_PATH || "ffmpeg";
const sessions = new Map();

function ffmpegSpawnOptions() {
  const options = { stdio: ["pipe", "pipe", "pipe"] };
  const termuxLib = process.env.PREFIX && path.join(process.env.PREFIX, "lib");
  if (process.platform === "android" && termuxLib && fs.existsSync(path.join(termuxLib, "libc++_shared.so"))) {
    options.env = { ...process.env, LD_LIBRARY_PATH: termuxLib };
  }
  return options;
}

function sessionFor(guildId) {
  if (!sessions.has(guildId)) {
    const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
    const session = { player, connection: null, queue: [], current: null, volume: 80, loop: false, busy: false, processes: [] };
    player.on(AudioPlayerStatus.Idle, () => {
      if (session.current && session.loop) {
        startTrack(guildId, session.current).catch((e) => {
          log.error("Loop playback failed", e);
          playNext(guildId).catch((nextError) => log.error("Next track failed", nextError));
        });
      } else {
        session.current = null;
        playNext(guildId).catch((e) => log.error("Next track failed", e));
      }
    });
    player.on("error", (error) => {
      log.error(`Audio player error in ${guildId}`, error);
      session.current = null;
      playNext(guildId).catch((e) => log.error("Queue advance failed", e));
    });
    sessions.set(guildId, session);
  }
  return sessions.get(guildId);
}
function parseJsonOutput(stdout) {
  try { return JSON.parse(stdout); } catch { throw new Error("yt-dlp tidak menghasilkan metadata yang valid."); }
}
function runYtDlpMetadata(query, spawnChild = spawn) {
  const cleanQuery = typeof query === "string" ? query.trim() : "";
  if (!cleanQuery) return Promise.reject(new Error("Masukkan judul lagu atau URL."));
  if (cleanQuery.length > 200) return Promise.reject(new Error("Judul atau URL terlalu panjang (maksimal 200 karakter)."));
  return new Promise((resolve, reject) => {
    query = cleanQuery;
    const target = /^(https?:\/\/)/i.test(query) ? query : `ytsearch1:${query}`;
    const proc = spawnChild(ytdlpPath, ["--no-playlist", "--dump-single-json", "--skip-download", "--no-warnings", target], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    proc.stdout.setEncoding("utf8"); proc.stderr.setEncoding("utf8");
    proc.stdout.on("data", d => out += d);
    proc.stderr.on("data", d => err += d);
    proc.on("error", e => reject(new Error(e.code === "ENOENT"
      ? `yt-dlp tidak ditemukan (${ytdlpPath}). Pasang yt-dlp di Termux atau atur YTDLP_PATH.`
      : `Gagal menjalankan yt-dlp: ${e.message}`)));
    proc.on("close", code => {
      if (code !== 0 || !out.trim()) {
        const hint = /429|LOGIN_REQUIRED|not a bot|PO Token|Visitor Data/i.test(err)
          ? "YouTube menolak ekstraksi atau meminta verifikasi. Coba lagi nanti atau gunakan sumber audio lain yang diizinkan."
          : (err.trim() ? `yt-dlp gagal dijalankan: ${err.trim().slice(-700)}` : `yt-dlp keluar dengan kode ${code}.`);
        return reject(new Error(hint));
      }
      try {
        const json = parseJsonOutput(out);
        const entry = json.entries?.[0] || json;
        if (!entry.url && !entry.webpage_url && !entry.original_url) return reject(new Error("URL lagu tidak ditemukan."));
        resolve({ title: entry.title || query, url: entry.webpage_url || entry.original_url || entry.url });
      } catch (e) { reject(e); }
    });
  });
}
function killProcesses(session) {
  for (const p of session.processes) {
    try { p.kill("SIGKILL"); } catch {}
  }
  session.processes = [];
}
async function startTrack(guildId, track, spawnChild = spawn) {
  const session = sessionFor(guildId);
  killProcesses(session);
  session.current = track;
  session.busy = true;
  return new Promise((resolve, reject) => {
    let ytdlp;
    let ffmpeg;
    try {
      ytdlp = spawnChild(ytdlpPath, ["--no-playlist", "-f", "bestaudio/best", "-o", "-", track.url], { stdio: ["ignore", "pipe", "pipe"] });
      ffmpeg = spawnChild(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-f", "s16le", "-ar", "48000", "-ac", "2", "pipe:1"], ffmpegSpawnOptions());
    } catch (error) {
      try { ytdlp?.kill("SIGKILL"); } catch {}
      session.processes = [];
      session.busy = false;
      if (session.current === track) session.current = null;
      return reject(error);
    }
    session.processes = [ytdlp, ffmpeg];
    ytdlp.stdout.pipe(ffmpeg.stdin);
    let stderr = "";
    let started = false;
    let settled = false;
    ytdlp.stderr.on("data", d => { stderr += d.toString(); });
    ffmpeg.stderr.on("data", d => { stderr += d.toString(); });
    const fail = (err, executable) => {
      if (settled) return;
      settled = true;
      session.busy = false;
      if (session.current === track) session.current = null;
      killProcesses(session);
      const detail = err?.code === "ENOENT"
        ? `${executable} tidak ditemukan (${executable === "yt-dlp" ? ytdlpPath : ffmpegPath}). Pasang di Termux atau atur path yang sesuai.`
        : (/429|LOGIN_REQUIRED|not a bot|PO Token|Visitor Data/i.test(stderr)
          ? "YouTube sedang membatasi akses atau meminta verifikasi. Ini bukan kesalahan FFmpeg."
          : (stderr.trim() ? `${executable} gagal memulai audio: ${stderr.trim().slice(-700)}` : (err?.message || "Gagal memulai audio.")));
      reject(new Error(detail));
    };
    ytdlp.on("error", error => fail(error, "yt-dlp"));
    ffmpeg.on("error", error => fail(error, "ffmpeg"));
    ffmpeg.stdout.once("data", () => {
      if (settled) return;
      try {
        const resource = createAudioResource(ffmpeg.stdout, { inputType: StreamType.Raw, inlineVolume: true });
        resource.volume?.setVolume(session.volume / 100);
        session.player.play(resource);
        started = true;
        settled = true;
        session.busy = false;
        resolve();
      } catch (error) {
        fail(error, "ffmpeg");
      }
    });
    ffmpeg.on("close", code => {
      if (!started && !settled) fail(new Error(`FFmpeg berhenti sebelum audio dimulai (kode ${code}).`), "ffmpeg");
    });
    ytdlp.on("close", code => {
      if (!started && !settled) fail(new Error(`yt-dlp berhenti sebelum audio dimulai (kode ${code}).`), "yt-dlp");
    });
  });
}
async function playNext(guildId, spawnChild = spawn) {
  const session = sessionFor(guildId);
  while (!session.busy && !session.current && session.queue.length > 0) {
    const next = session.queue.shift();
    try {
      await startTrack(guildId, next, spawnChild);
      return;
    } catch (error) {
      log.error(`Gagal memulai lagu antrean di ${guildId}; mencoba lagu berikutnya`, error);
    }
  }
}
async function play(interaction, query) {
  const voice = interaction.member?.voice?.channel;
  if (!voice) throw new Error("Masuk ke voice channel terlebih dahulu.");
  const guildId = interaction.guildId;
  const session = sessionFor(guildId);
  if (!session.connection) {
    session.connection = joinVoiceChannel({
      channelId: voice.id, guildId, adapterCreator: interaction.guild.voiceAdapterCreator,
      selfDeaf: true
    });
    session.connection.subscribe(session.player);
    try { await entersState(session.connection, VoiceConnectionStatus.Ready, 20_000); }
    catch { session.connection.destroy(); session.connection = null; throw new Error("Bot gagal tersambung ke voice channel."); }
  } else if (session.connection.joinConfig.channelId !== voice.id) {
    throw new Error("Bot sedang berada di voice channel lain di server ini.");
  }
  const track = await runYtDlpMetadata(query);
  if (session.current || session.busy) {
    session.queue.push(track);
    return { queued: true, track, session };
  }
  try {
    await startTrack(guildId, track);
  } catch (error) {
    playNext(guildId).catch((nextError) => log.error("Queue recovery failed", nextError));
    throw error;
  }
  return { queued: false, track, session };
}
function getSession(guildId) { return sessionFor(guildId); }
function skip(guildId) { const s = sessionFor(guildId); s.current = null; killProcesses(s); s.player.stop(true); }
function stop(guildId) { const s = sessionFor(guildId); s.current = null; s.queue = []; killProcesses(s); s.player.stop(true); }
function leave(guildId) { const s = sessionFor(guildId); stop(guildId); s.connection?.destroy(); s.connection = null; }
function setVolume(guildId, volume) {
  const s = sessionFor(guildId);
  s.volume = Math.max(1, Math.min(100, volume));
  const resource = s.player.state.resource;
  resource?.volume?.setVolume(s.volume / 100);
  return s.volume;
}
module.exports = { play, getSession, skip, stop, leave, setVolume, __test: { startTrack, playNext, ffmpegSpawnOptions } };
