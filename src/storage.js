const fs = require("node:fs");
const path = require("node:path");

const filePath = path.resolve(process.env.DATA_FILE || "./data/symphony-data.json");

function ensureFile() {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify({ playlists: {} }, null, 2));
  }
}
function readData() {
  ensureFile();
  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!data.playlists || typeof data.playlists !== "object") data.playlists = {};
    return data;
  } catch {
    throw new Error(`Data file is not valid JSON: ${filePath}. Back it up before repairing it.`);
  }
}
function writeData(data) {
  ensureFile();
  const temp = `${filePath}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(data, null, 2));
  fs.renameSync(temp, filePath);
}
function getPlaylistKey(guildId, ownerId, name) {
  return `${guildId || "dm"}:${ownerId}:${name.trim().toLowerCase()}`;
}
function listPlaylists(guildId, ownerId) {
  const data = readData();
  return Object.entries(data.playlists)
    .filter(([, p]) => p.guildId === (guildId || null) && p.ownerId === ownerId)
    .map(([key, p]) => ({ key, ...p }));
}
function createPlaylist({ guildId, ownerId, name }) {
  const data = readData();
  const clean = name.trim();
  if (!clean || clean.length > 60) throw new Error("Nama playlist harus 1–60 karakter.");
  const key = getPlaylistKey(guildId, ownerId, clean);
  if (data.playlists[key]) throw new Error("Playlist dengan nama itu sudah ada.");
  data.playlists[key] = { guildId: guildId || null, ownerId, name: clean, tracks: [], createdAt: new Date().toISOString() };
  writeData(data);
  return { key, ...data.playlists[key] };
}
function findPlaylist(guildId, ownerId, name) {
  const data = readData();
  const key = getPlaylistKey(guildId, ownerId, name);
  const playlist = data.playlists[key];
  if (!playlist) throw new Error("Playlist tidak ditemukan. Periksa nama dan pemiliknya.");
  return { data, key, playlist };
}
function renamePlaylist({ guildId, ownerId, oldName, newName }) {
  const { data, key, playlist } = findPlaylist(guildId, ownerId, oldName);
  const clean = newName.trim();
  if (!clean || clean.length > 60) throw new Error("Nama baru harus 1–60 karakter.");
  const newKey = getPlaylistKey(guildId, ownerId, clean);
  if (newKey !== key && data.playlists[newKey]) throw new Error("Sudah ada playlist dengan nama baru itu.");
  delete data.playlists[key];
  playlist.name = clean;
  data.playlists[newKey] = playlist;
  writeData(data);
  return playlist;
}
function addTrack({ guildId, ownerId, name, track }) {
  const { data, key, playlist } = findPlaylist(guildId, ownerId, name);
  if (playlist.tracks.length >= 500) throw new Error("Playlist mencapai batas 500 lagu.");
  playlist.tracks.push({ title: track.title, url: track.url, addedAt: new Date().toISOString() });
  data.playlists[key] = playlist;
  writeData(data);
  return playlist;
}
function removeTrack({ guildId, ownerId, name, index }) {
  const { data, key, playlist } = findPlaylist(guildId, ownerId, name);
  if (!Number.isInteger(index) || index < 1 || index > playlist.tracks.length) throw new Error("Nomor lagu tidak valid.");
  const [removed] = playlist.tracks.splice(index - 1, 1);
  data.playlists[key] = playlist;
  writeData(data);
  return { playlist, removed };
}
module.exports = { listPlaylists, createPlaylist, renamePlaylist, findPlaylist, addTrack, removeTrack };
