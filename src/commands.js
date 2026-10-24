const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require("discord.js");
const music = require("./music");
const store = require("./storage");

function buildProfileCommand(name) {
  return new SlashCommandBuilder().setName(name).setDescription("Atur profil bot khusus server ini")
    .addSubcommand(s => s.setName("name").setDescription("Ganti nama tampilan bot di server").addStringOption(o => o.setName("value").setDescription("Nama baru (1–32 karakter)").setMinLength(1).setMaxLength(32).setRequired(true)))
    .addSubcommand(s => s.setName("avatar").setDescription("Atur avatar bot khusus server").addAttachmentOption(o => o.setName("image").setDescription("Gambar PNG/JPG/WEBP").setRequired(true)))
    .addSubcommand(s => s.setName("reset").setDescription("Reset nama dan avatar khusus server"));
}

function playlistScopeOption(option) {
  return option.setName("scope").setDescription("Jenis playlist")
    .addChoices({ name: "Pribadi", value: "personal" }, { name: "Server", value: "server" });
}

function isPrivatePlaylistInteraction(interaction) {
  return interaction.commandName === "playlist" && (interaction.options.getString("scope") || "personal") === "personal";
}

const commands = [
  new SlashCommandBuilder().setName("help").setDescription("Tampilkan daftar command Symphony Melody"),
  new SlashCommandBuilder().setName("play").setDescription("Putar lagu dari judul atau URL").addStringOption(o => o.setName("query").setDescription("Judul lagu atau URL audio/video").setMaxLength(200).setRequired(true)),
  new SlashCommandBuilder().setName("pause").setDescription("Jeda lagu"),
  new SlashCommandBuilder().setName("resume").setDescription("Lanjutkan lagu"),
  new SlashCommandBuilder().setName("skip").setDescription("Lewati lagu saat ini"),
  new SlashCommandBuilder().setName("stop").setDescription("Hentikan lagu dan kosongkan antrean"),
  new SlashCommandBuilder().setName("queue").setDescription("Lihat antrean lagu"),
  new SlashCommandBuilder().setName("nowplaying").setDescription("Lihat lagu yang sedang diputar"),
  new SlashCommandBuilder().setName("volume").setDescription("Atur volume").addIntegerOption(o => o.setName("percent").setDescription("1 sampai 100").setMinValue(1).setMaxValue(100).setRequired(true)),
  new SlashCommandBuilder().setName("leave").setDescription("Keluarkan bot dari voice channel"),
  new SlashCommandBuilder().setName("lyrics").setDescription("Buka pencarian lirik lagu").addStringOption(o => o.setName("song").setDescription("Judul lagu").setMaxLength(200).setRequired(true)).addStringOption(o => o.setName("artist").setDescription("Nama penyanyi").setMaxLength(100).setRequired(false)),
  new SlashCommandBuilder().setName("playlist").setDescription("Kelola playlist")
    .addSubcommand(s => s.setName("create").setDescription("Buat playlist").addStringOption(o => o.setName("name").setDescription("Nama playlist").setRequired(true)).addStringOption(playlistScopeOption))
    .addSubcommand(s => s.setName("rename").setDescription("Ganti nama playlist").addStringOption(o => o.setName("name").setDescription("Nama lama").setRequired(true)).addStringOption(o => o.setName("new_name").setDescription("Nama baru").setRequired(true)).addStringOption(playlistScopeOption))
    .addSubcommand(s => s.setName("list").setDescription("Lihat playlist pribadi atau server").addStringOption(playlistScopeOption))
    .addSubcommand(s => s.setName("add").setDescription("Simpan URL lagu ke playlist").addStringOption(o => o.setName("name").setDescription("Nama playlist").setRequired(true)).addStringOption(o => o.setName("url").setDescription("URL lagu").setRequired(true)).addStringOption(o => o.setName("title").setDescription("Judul lagu (opsional)").setRequired(false)).addStringOption(playlistScopeOption))
    .addSubcommand(s => s.setName("remove").setDescription("Hapus lagu dari playlist").addStringOption(o => o.setName("name").setDescription("Nama playlist").setRequired(true)).addIntegerOption(o => o.setName("number").setDescription("Nomor lagu").setMinValue(1).setRequired(true)).addStringOption(playlistScopeOption))
    .addSubcommand(s => s.setName("play").setDescription("Putar lagu-lagu dari playlist").addStringOption(o => o.setName("name").setDescription("Nama playlist").setRequired(true)).addStringOption(playlistScopeOption)),
  buildProfileCommand("botprofile"),
  buildProfileCommand("serverprofile") // Legacy alias for existing installations
].map(c => c.toJSON());

async function reply(interaction, content, ephemeral = false) {
  const payload = {
    content,
    flags: ephemeral ? MessageFlags.Ephemeral : undefined
  };
  if (interaction.deferred || interaction.replied) return interaction.editReply({ content });
  return interaction.reply(payload);
}
function needGuild(interaction) {
  if (!interaction.inGuild()) throw new Error("Command ini hanya bisa digunakan di server Discord.");
}
function lyricsSearch(song, artist) {
  const cleanSong = typeof song === "string" ? song.trim() : "";
  const cleanArtist = typeof artist === "string" ? artist.trim() : "";
  if (!cleanSong) throw new Error("Judul lagu wajib diisi.");
  if (cleanSong.length > 200 || cleanArtist.length > 100) throw new Error("Judul maksimal 200 karakter dan nama penyanyi maksimal 100 karakter.");
  const q = encodeURIComponent([cleanSong, cleanArtist].filter(Boolean).join(" "));
  return `Cari lirik untuk **${cleanSong}${cleanArtist ? ` - ${cleanArtist}` : ""}**: https://www.google.com/search?q=${q}+lyrics\nAku membuka hasil pencarian, bukan menyalin lirik berhak cipta secara penuh ke Discord.`;
}
async function handleCommand(interaction, client, dependencies = {}) {
  const musicService = dependencies.music || music;
  const playlistStore = dependencies.store || store;
  const fetchImage = dependencies.fetch || fetch;
  let acknowledgementAttempted = false;
  let mainResponseAttempted = false;
  let ephemeralResponse = false;
  const respond = async (content) => {
    mainResponseAttempted = true;
    return reply(interaction, content, ephemeralResponse);
  };
  try {
    ephemeralResponse = isPrivatePlaylistInteraction(interaction);
    if (!interaction.deferred && !interaction.replied) {
      acknowledgementAttempted = true;
      await interaction.deferReply({ flags: ephemeralResponse ? MessageFlags.Ephemeral : undefined });
    }
    const name = interaction.commandName;
    if (name === "help") {
      return await respond([
        "**Symphony Melody V4**",
        "`/play query` · `/pause` · `/resume` · `/skip` · `/stop`",
        "`/queue` · `/nowplaying` · `/volume percent` · `/leave`",
        "`/playlist create|rename|list|add|remove|play`",
        "`/lyrics song [artist]`",
        "`/botprofile name|avatar|reset`"
      ].join("\n"));
    }
    if (name === "play") {
      needGuild(interaction);
      const result = await musicService.play(interaction, interaction.options.getString("query", true));
      return await respond(result.queued ? `Ditambahkan ke antrean: **${result.track.title}**` : `Sedang memuat: **${result.track.title}**`);
    }
    if (name === "pause") {
      needGuild(interaction); musicService.getSession(interaction.guildId).player.pause();
      return await respond("Pemutaran dijeda.");
    }
    if (name === "resume") {
      needGuild(interaction); musicService.getSession(interaction.guildId).player.unpause();
      return await respond("Pemutaran dilanjutkan.");
    }
    if (name === "skip") {
      needGuild(interaction); musicService.skip(interaction.guildId);
      return await respond("Lagu dilewati.");
    }
    if (name === "stop") {
      needGuild(interaction); musicService.stop(interaction.guildId);
      return await respond("Pemutaran dihentikan dan antrean dikosongkan.");
    }
    if (name === "leave") {
      needGuild(interaction); musicService.leave(interaction.guildId);
      return await respond("Bot keluar dari voice channel.");
    }
    if (name === "queue") {
      needGuild(interaction);
      const s = musicService.getSession(interaction.guildId);
      const lines = s.queue.slice(0, 15).map((t, i) => `${i + 1}. ${t.title}`);
      return await respond(`**Sedang diputar:** ${s.current?.title || "Tidak ada"}\n**Antrean:**\n${lines.join("\n") || "Kosong"}`);
    }
    if (name === "nowplaying") {
      needGuild(interaction);
      const s = musicService.getSession(interaction.guildId);
      return await respond(s.current ? `🎵 **${s.current.title}**` : "Belum ada lagu yang diputar.");
    }
    if (name === "volume") {
      needGuild(interaction);
      const v = musicService.setVolume(interaction.guildId, interaction.options.getInteger("percent", true));
      return await respond(`Volume diatur ke ${v}%.`);
    }
    if (name === "lyrics") {
      const song = interaction.options.getString("song", true);
      const artist = interaction.options.getString("artist");
      return await respond(lyricsSearch(song, artist));
    }
    if (name === "playlist") {
      needGuild(interaction);
      const sub = interaction.options.getSubcommand();
      const guildId = interaction.guildId;
      const ownerId = interaction.user.id;
      const scope = interaction.options.getString("scope") || "personal";
      const playlistOwnerId = scope === "server" ? null : ownerId;
      if (sub === "create") {
        const p = playlistStore.createPlaylist({ guildId, ownerId: playlistOwnerId, name: interaction.options.getString("name", true) });
        return await respond(`Playlist **${p.name}** (${scope === "server" ? "server" : "pribadi"}) dibuat. Data tersimpan di perangkat bot.`);
      }
      if (sub === "rename") {
        const p = playlistStore.renamePlaylist({ guildId, ownerId: playlistOwnerId, oldName: interaction.options.getString("name", true), newName: interaction.options.getString("new_name", true) });
        return await respond(`Nama playlist berhasil diganti menjadi **${p.name}**.`);
      }
      if (sub === "list") {
        const ps = playlistStore.listPlaylists(guildId, playlistOwnerId);
        return await respond(ps.length ? ps.map(p => `• **${p.name}** · ${p.tracks.length} lagu`).join("\n") : "Kamu belum punya playlist di server ini.");
      }
      if (sub === "add") {
        const trackUrl = interaction.options.getString("url", true).trim();
        let parsedUrl;
        try { parsedUrl = new URL(trackUrl); } catch { throw new Error("URL lagu tidak valid."); }
        if (!["http:", "https:"].includes(parsedUrl.protocol)) throw new Error("URL lagu harus menggunakan HTTP atau HTTPS.");
        const p = playlistStore.addTrack({ guildId, ownerId: playlistOwnerId, name: interaction.options.getString("name", true), track: { title: interaction.options.getString("title")?.trim() || trackUrl, url: trackUrl } });
        return await respond(`Lagu ditambahkan ke **${p.name}**.`);
      }
      if (sub === "remove") {
        const result = playlistStore.removeTrack({ guildId, ownerId: playlistOwnerId, name: interaction.options.getString("name", true), index: interaction.options.getInteger("number", true) });
        return await respond(`**${result.removed.title}** dihapus dari **${result.playlist.name}**.`);
      }
      if (sub === "play") {
        const found = playlistStore.findPlaylist(guildId, playlistOwnerId, interaction.options.getString("name", true));
        if (!found.playlist.tracks.length) throw new Error("Playlist ini masih kosong.");
        let added = 0;
        for (const track of found.playlist.tracks) {
          const result = await musicService.play(interaction, track.url);
          if (result.queued || result.track) added++;
        }
        return await respond(`${added} lagu dari **${found.playlist.name}** diproses. Jika sumber menolak ekstraksi, bot akan melaporkan error.`);
      }
    }
    if (name === "botprofile" || name === "serverprofile") {
      needGuild(interaction);
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) && interaction.guild.ownerId !== interaction.user.id) {
        throw new Error("Hanya pemilik server atau admin dengan izin Manage Server yang dapat mengubah profil bot.");
      }
      const sub = interaction.options.getSubcommand();
      if (sub === "name") {
        const value = interaction.options.getString("value", true).trim();
        if (!value || value.length > 32) throw new Error("Nama tampilan harus 1–32 karakter setelah spasi dihapus.");
        await interaction.guild.members.editMe({ nick: value, reason: "Symphony Melody server-specific profile customization" });
        return await respond(`Nama tampilan bot di server ini diubah menjadi **${value}**. Nama global tidak diubah.`);
      }
      if (sub === "avatar") {
        const image = interaction.options.getAttachment("image", true);
        if (!/^image\/(png|jpeg|webp)$/i.test(image.contentType || "")) throw new Error("Gunakan gambar PNG, JPG, atau WEBP.");
        if (image.size > 2 * 1024 * 1024) throw new Error("Ukuran gambar maksimal 2 MB.");
        const res = await fetchImage(image.url);
        if (!res.ok) throw new Error("Gambar tidak dapat diunduh dari Discord.");
        const buffer = Buffer.from(await res.arrayBuffer());
        if (buffer.length === 0 || buffer.length > 2 * 1024 * 1024) throw new Error("Gambar kosong atau melebihi batas 2 MB.");
        await interaction.guild.members.editMe({ avatar: buffer, reason: "Symphony Melody server-specific avatar customization" });
        return await respond("Avatar khusus server berhasil diperbarui jika fitur ini tersedia untuk botmu. Avatar global tidak diubah.");
      }
      if (sub === "reset") {
        await interaction.guild.members.editMe({ nick: null, avatar: null, reason: "Reset Symphony Melody server-specific profile" });
        return await respond("Profil khusus server direset. Jika Discord menolak reset avatar, jalankan reset nickname dan avatar melalui pengaturan server.");
      }
    }
  } catch (error) {
    const message = error?.message || "Terjadi kesalahan yang tidak diketahui.";
    const content = `Gagal: ${message}`;
    if (mainResponseAttempted || (acknowledgementAttempted && !interaction.deferred && !interaction.replied)) return;
    mainResponseAttempted = true;
    if (interaction.deferred || interaction.replied) {
      return interaction.editReply({ content }).catch(() => {});
    }
    if (!acknowledgementAttempted) {
      return interaction.reply({ content, ...(ephemeralResponse ? { flags: MessageFlags.Ephemeral } : {}) }).catch(() => {});
    }
  }
}
module.exports = { commands, handleCommand, lyricsSearch };
