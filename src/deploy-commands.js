require("dotenv").config();
const { REST, Routes } = require("discord.js");
const { commands } = require("./commands");
const log = require("./logger");

async function main() {
  const { DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID } = process.env;
  if (!DISCORD_TOKEN || !DISCORD_CLIENT_ID) throw new Error("Isi DISCORD_TOKEN dan DISCORD_CLIENT_ID di file .env.");
  const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
  const route = DISCORD_GUILD_ID
    ? Routes.applicationGuildCommands(DISCORD_CLIENT_ID, DISCORD_GUILD_ID)
    : Routes.applicationCommands(DISCORD_CLIENT_ID);
  await rest.put(route, { body: commands });
  log.info(`Registered ${commands.length} slash commands ${DISCORD_GUILD_ID ? `for guild ${DISCORD_GUILD_ID}` : "globally"}.`);
}
main().catch(e => { log.error("Command deployment failed", e); process.exitCode = 1; });
