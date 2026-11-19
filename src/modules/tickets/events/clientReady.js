// Startup hook: the ticket panel survives restarts.
//
// On every boot the panel is posted in `tickets.panel.channelId` — or, when one
// is already there, refreshed in place (never duplicated). Disabled with
// `tickets.panel.autoPost: false`. Guilds that do not own the configured
// channel are skipped silently, so one bot can serve several servers.

const logger = require('../../../core/logger');
const configService = require('../../../core/configService');
const { resolveTicketsConfig } = require('../config');
const { publishPanel } = require('../services/panelPublisher');

module.exports = {
    name: 'clientReady',
    once: true,
    async execute(client) {
        // config.yml is read at boot already; re-read it so a channel or title
        // edited while the bot was offline is honoured by this very startup.
        configService.load();
        if (configService.get('tickets.panel.autoPost', true) === false) return;

        for (const guild of client.guilds.cache.values()) {
            try {
                const config = await resolveTicketsConfig(guild);
                if (!config.enabled) continue;

                const channelId = String(config.panel.channelId || '').trim();
                if (!channelId) continue;

                // Cache only: in a multi-server setup the configured panel
                // channel simply is not part of this guild, and that is fine.
                const channel = guild.channels.cache.get(channelId) || null;
                if (!channel) continue;

                if (!channel.isTextBased() || !channel.viewable) {
                    logger.warn(`Ticket panel auto-post skipped: channel ${channelId} in ${guild.name} is not a viewable text channel.`);
                    continue;
                }

                const result = await publishPanel({ client, channel, config });
                logger.info(`Ticket panel ${result.status} on startup in #${channel.name} (${guild.name}).`);
            } catch (error) {
                logger.warn(`Ticket panel auto-post failed in ${guild.name}: ${error.message}`);
            }
        }
    }
};
