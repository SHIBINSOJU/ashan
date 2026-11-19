// Single home for "put the ticket panel in a channel". Both `/ticket panel` and
// the startup hook call this, so a restart can never stack a second panel next
// to the one already in the channel — the existing message is edited in place.

const logger = require('../../../core/logger');
const { buildPanel } = require('./panel');

// Panel messages are identified by the select menu they carry
// (ticket:select:<panelId>), so panels posted before a rebrand are still
// recognised and can be edited in place.
const PANEL_COMPONENT_PREFIX = 'ticket:select:';

function isPanelMessage(message, botId) {
    if (botId && message.author?.id !== botId) return false;
    if (!Array.isArray(message.components)) return false;
    return message.components.some((row) =>
        (row.components || []).some((component) =>
            String(component.customId || '').startsWith(PANEL_COMPONENT_PREFIX)
        )
    );
}

/** Panels the bot owns in this channel, newest first. Never throws. */
async function findExistingPanels(channel, client) {
    const botId = client?.user?.id;
    let messages;
    try {
        messages = await channel.messages.fetch({ limit: 50 });
    } catch (error) {
        logger.warn(`Ticket panel lookup failed in ${channel.id}: ${error.message}`);
        return [];
    }
    return [...messages.filter((message) => isPanelMessage(message, botId)).values()];
}

/**
 * Posts the ticket panel in `channel`, or refreshes the panel already there.
 * Stale duplicates are removed so the channel never shows two panels.
 * Returns { status: 'refreshed' | 'posted', messageId, channelId } and throws
 * only when nothing could be sent at all.
 */
async function publishPanel({ client, channel, config }) {
    const payload = buildPanel(config);
    const existing = await findExistingPanels(channel, client);

    let panel = existing[0] ?? null;
    if (panel) {
        try {
            panel = await panel.edit(payload);
        } catch (error) {
            // A panel from an older bot version may be uneditable; post a
            // fresh one below instead of leaving the channel without a panel.
            logger.warn(`Ticket panel refresh failed (${panel.id}): ${error.message}`);
            panel = null;
        }
    }

    if (panel) {
        for (const stale of existing.slice(1)) {
            await stale.delete().catch(() => null);
        }
        return { status: 'refreshed', messageId: panel.id, channelId: channel.id };
    }

    const sent = await channel.send(payload);
    for (const stale of existing) {
        await stale.delete().catch(() => null);
    }
    return { status: 'posted', messageId: sent.id, channelId: channel.id };
}

module.exports = { publishPanel, findExistingPanels, isPanelMessage };
