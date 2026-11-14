// One-off helper: post (or refresh) the ticket panel in a channel without
// booting the whole bot. Usage: node scripts/postTicketPanel.js <channelId>
require('dotenv').config();
const { Client, GatewayIntentBits, Events } = require('discord.js');
const configService = require('../src/core/configService');
const { resolveTicketsConfig } = require('../src/modules/tickets/config');
const { buildPanel } = require('../src/modules/tickets/services/panel');

const channelId = process.argv[2] || configService.get('tickets.panel.channelId', '');
if (!/^\d{17,20}$/.test(channelId)) {
    console.error('Usage: node scripts/postTicketPanel.js <channelId>');
    process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, async (ready) => {
    try {
        const channel = await ready.channels.fetch(channelId);
        if (!channel?.isTextBased()) throw new Error('target channel is not text based');

        configService.load();
        const config = await resolveTicketsConfig(channel.guild);
        const payload = buildPanel(config);

        const messages = await channel.messages.fetch({ limit: 50 });
        const panels = [...messages.filter((message) => {
            if (message.author?.id !== ready.user.id) return false;
            if (!Array.isArray(message.components)) return false;
            return message.components.some((row) =>
                (row.components || []).some((component) =>
                    String(component.customId || '').startsWith('ticket:select:')
                )
            );
        }).values()];

        if (panels.length > 0) {
            const edited = await panels[0].edit(payload);
            for (const stale of panels.slice(1)) await stale.delete().catch(() => null);
            console.log(`REFRESHED panel message ${edited.id} in #${channel.name}`);
        } else {
            const sent = await channel.send(payload);
            console.log(`POSTED panel message ${sent.id} in #${channel.name}`);
        }
        console.log(`Title: ${config.panel.title}`);
        console.log(`Categories: ${Object.keys(config.categories || {}).join(', ')}`);
    } catch (error) {
        console.error(`FAILED: ${error.message}`);
        process.exitCode = 1;
    } finally {
        client.destroy();
    }
});

client.login(process.env.DISCORD_TOKEN).catch((error) => {
    console.error(`LOGIN FAILED: ${error.message}`);
    process.exit(1);
});
