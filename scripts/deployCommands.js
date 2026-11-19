// Registers the bot's slash commands without booting the whole bot.
// Useful right after cloning, renaming commands, or when the "/" menu looks empty.
//
// Usage: node scripts/deployCommands.js
// Deploys to GUILD_ID when the bot is in that server, otherwise to every server
// the bot has joined (guild commands only exist where the bot actually is).

require('dotenv').config();
const { REST, Routes } = require('discord.js');

async function main() {
    const clientId = (process.env.CLIENT_ID || '').trim();
    const token = (process.env.DISCORD_TOKEN || '').trim();
    if (!clientId || !token) {
        throw new Error('CLIENT_ID and DISCORD_TOKEN must be set in .env');
    }

    const ModuleManager = require('../src/core/moduleManager');
    const configService = require('../src/core/configService');
    const createCoreModule = require('../src/core/coreModule');

    // Modules probe client.isReady()/once() during initialize; commands are
    // simply registered here and never executed, so a stub client is enough.
    const manager = new ModuleManager({ on() {}, once() {}, isReady: () => false }, configService);
    await manager.loadModules(createCoreModule({ client: null, moduleManager: manager, config: configService }));
    const commandData = [...manager.commands.values()].map((cmd) => cmd.data.toJSON());

    const rest = new REST({ version: '10' }).setToken(token);
    const joined = (await rest.get(Routes.userGuilds())).map((guild) => guild.id);
    const configured = (process.env.GUILD_ID || '').split(',').map((id) => id.trim()).filter(Boolean);
    const targets = configured.filter((id) => joined.includes(id));
    if (targets.length === 0) {
        if (joined.length === 0) throw new Error('The bot has not joined any server yet — invite it first.');
        console.log(`GUILD_ID ${configured.join(', ') || '(unset)'} is not a server this bot is in; using ${joined.join(', ')} instead.`);
        targets.push(...joined);
    }

    for (const guildId of targets) {
        await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commandData });
        console.log(`Registered ${commandData.length} commands in ${guildId}.`);
    }
}

main().catch((error) => {
    console.error(`Deploy failed: ${error.message}`);
    process.exit(1);
});
