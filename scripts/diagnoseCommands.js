// Slash-command diagnostics. Checks the things that stop "/ commands" from
// showing up, in the order they usually break:
//   1. environment (CLIENT_ID / GUILD_ID present and well formed)
//   2. every command payload against Discord's limits (one bad command aborts
//      the whole registration batch in clientReady)
//   3. duplicate command names (registration is rejected for the batch)
//   4. live: which application the token belongs to, which guilds the bot is
//      actually in, and what Discord currently has registered
//
// Usage:
//   node scripts/diagnoseCommands.js          # offline checks only
//   node scripts/diagnoseCommands.js --live   # also logs in (read-only queries)
//
// The token is never printed.

require('dotenv').config();
const { REST, Routes } = require('discord.js');

const CLIENT_ID = (process.env.CLIENT_ID || '').trim();
const GUILD_ID = (process.env.GUILD_ID || '').trim();
const TOKEN = (process.env.DISCORD_TOKEN || '').trim();
const LIVE = process.argv.includes('--live');

const SNOWFLAKE = /^\d{17,20}$/;
const NAME = /^[-_\p{L}\p{N}\p{sc=Deva}\p{sc=Thai}]{1,32}$/u;
const problems = [];
const notes = [];

function fail(message) {
    problems.push(message);
}

function note(message) {
    notes.push(message);
}

function checkEnvironment() {
    console.log('\n── Environment ──');
    console.log(`CLIENT_ID : ${CLIENT_ID || '(missing)'}`);
    console.log(`GUILD_ID  : ${GUILD_ID || '(missing)'}`);
    console.log(`TOKEN     : ${TOKEN ? `set (${TOKEN.length} chars)` : '(missing)'}`);

    if (!TOKEN) fail('DISCORD_TOKEN is empty — the bot cannot log in, so nothing ever registers.');
    if (!CLIENT_ID) fail('CLIENT_ID is empty — DM me the Application ID from the Developer Portal → General Information.');
    else if (!SNOWFLAKE.test(CLIENT_ID)) fail(`CLIENT_ID "${CLIENT_ID}" is not a Discord snowflake (17-20 digits).`);
    if (!GUILD_ID) note('GUILD_ID is empty — commands will be deployed to every server the bot has joined.');
    else if (!SNOWFLAKE.test(GUILD_ID)) fail(`GUILD_ID "${GUILD_ID}" is not a Discord snowflake (17-20 digits).`);
}

function collectCommands() {
    const ModuleManager = require('../src/core/moduleManager');
    const configService = require('../src/core/configService');
    const createCoreModule = require('../src/core/coreModule');

    const manager = new ModuleManager({ on() {}, once() {}, isReady: () => false }, configService);
    // Loading only registers commands; events/handlers are attached to the
    // stub client above and never fire.
    return manager.loadModules(createCoreModule({ client: null, moduleManager: manager, config: configService }))
        .then(() => [...manager.commands.values()].map((cmd) => {
            const json = cmd.data.toJSON();
            return { json, moduleName: manager.commandModules.get(json.name) };
        }));
}

function validateCommands(commands) {
    console.log(`\n── Command payloads (${commands.length}) ──`);

    const seen = new Map();
    for (const { json } of commands) {
        const label = `/${json.name}`;
        if (seen.has(json.name)) fail(`${label} is registered twice (${seen.get(json.name)} and its module) — Discord rejects the whole batch.`);
        seen.set(json.name, 'duplicate');

        if (!NAME.test(json.name)) fail(`${label}: name breaks Discord's rules (1-32 chars, lowercase a-z, 0-9, - and _).`);
        if (!json.description || json.description.length < 1) fail(`${label}: empty description.`);
        if (json.description && json.description.length > 100) fail(`${label}: description is ${json.description.length}/100 chars.`);

        const options = json.options || [];
        if (options.length > 25) fail(`${label}: ${options.length} options (max 25).`);
        for (const option of options) {
            const where = `${label} ${option.name}`;
            if (!option.description || option.description.length > 100) fail(`${where}: description must be 1-100 chars.`);
            if ((option.choices || []).length > 25) fail(`${where}: ${option.choices.length} choices (max 25).`);
            for (const choice of option.choices || []) {
                if (String(choice.name).length > 100) fail(`${where}: choice "${choice.name}" name > 100 chars.`);
                if (String(choice.value).length > 100) fail(`${where}: choice "${choice.name}" value > 100 chars.`);
            }
            for (const sub of option.options || []) {
                if (!sub.description || sub.description.length > 100) fail(`${where} ${sub.name}: description must be 1-100 chars.`);
            }
        }
    }

    const names = commands.map((c) => c.json.name).sort();
    console.log(names.join(', '));
    if (problems.length === 0) console.log('✓ all payloads look valid');
}

async function liveChecks() {
    console.log('\n── Live checks (Discord API) ──');
    if (!TOKEN) {
        fail('Live checks skipped: no DISCORD_TOKEN.');
        return;
    }

    const { Client, GatewayIntentBits } = require('discord.js');
    const client = new Client({ intents: [GatewayIntentBits.Guilds] });

    try {
        await client.login(TOKEN);
    } catch (error) {
        fail(`Login failed: ${error.message} — the token is wrong, revoked, or for a deleted application.`);
        return;
    }

    const appId = client.application?.id || client.user?.id;
    console.log(`Logged in as : ${client.user.tag} (${client.user.id})`);
    console.log(`Application  : ${appId}`);
    if (CLIENT_ID && appId !== CLIENT_ID) {
        fail(`CLIENT_ID (${CLIENT_ID}) is NOT this application (${appId}). Commands were being registered to the wrong app.`);
    }

    const guilds = [...client.guilds.cache.values()];
    console.log(`Guilds       : ${guilds.length}`);
    for (const guild of guilds) console.log(`  • ${guild.name || '(name unavailable)'} (${guild.id})${guild.id === GUILD_ID ? '  ← GUILD_ID' : ''}`);

    if (guilds.length === 0) {
        fail('The bot is not in any server. Invite it with the applications.commands scope first.');
    } else if (GUILD_ID && !client.guilds.cache.has(GUILD_ID)) {
        fail(`GUILD_ID (${GUILD_ID}) is not one of the servers above — commands go to a server the bot is not in.`);
    }

    const rest = new REST({ version: '10' }).setToken(TOKEN);
    const targetGuild = GUILD_ID || guilds[0]?.id;
    if (targetGuild) {
        try {
            const guildCommands = await rest.get(Routes.applicationGuildCommands(appId, targetGuild));
            console.log(`Registered guild commands in ${targetGuild}: ${guildCommands.length}`);
            if (guildCommands.length === 0) {
                fail(`Discord has ZERO commands registered for guild ${targetGuild}.`);
            }
        } catch (error) {
            fail(`Cannot read guild commands for ${targetGuild}: ${error.message} (bot missing "applications.commands" in that server?)`);
        }
    }

    try {
        const globalCommands = await rest.get(Routes.applicationCommands(appId));
        console.log(`Registered global commands: ${globalCommands.length}`);
        if (globalCommands.length === 0) note('No global commands — expected: this bot registers per guild from GUILD_ID.');
    } catch (error) {
        fail(`Cannot read global commands: ${error.message}`);
    }

    await client.destroy();
}

(async () => {
    checkEnvironment();

    let commands = [];
    try {
        console.log('\n── Loading commands ──');
        commands = await collectCommands();
        validateCommands(commands);
    } catch (error) {
        fail(`Could not load the command list: ${error.message}`);
    }

    if (LIVE) await liveChecks();

    console.log('\n── Result ──');
    for (const noteText of notes) console.log(`ℹ ${noteText}`);
    if (problems.length === 0) {
        console.log('✓ No blocking problem found.');
    } else {
        for (const problem of problems) console.log(`✗ ${problem}`);
        process.exitCode = 1;
    }
})();
