require("dotenv").config();
const { Client, GatewayIntentBits, Events } = require("discord.js");
const { handleCommand } = require("./commands");
const log = require("./logger");

const token = process.env.DISCORD_TOKEN;
if (!token) {
  log.error("DISCORD_TOKEN belum diisi di .env");
  process.exit(1);
}
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });

client.once(Events.ClientReady, ready => {
  log.info(`Bot online sebagai ${ready.user.tag}`);
  log.info(`Terhubung ke ${ready.guilds.cache.size} server.`);
});
client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;
  await handleCommand(interaction, client);
});
client.on(Events.Error, e => log.error("Discord client error", e));
process.on("unhandledRejection", e => log.error("Unhandled rejection", e));
process.on("uncaughtException", e => {
  log.error("Uncaught exception", e);
});
client.login(token).catch(e => {
  log.error("Login Discord gagal. Periksa token dan koneksi.", e);
  process.exit(1);
});
