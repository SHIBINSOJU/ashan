const { initInviteCache } = require('./services/inviteCache');
const guildMemberAdd = require('./events/guildMemberAdd');
const guildMemberRemove = require('./events/guildMemberRemove');
const inviteCreate = require('./events/inviteCreate');
const inviteDelete = require('./events/inviteDelete');
const guildCreate = require('./events/guildCreate');
const invitesCommand = require('./commands/invites');

module.exports = {
    name: 'invites',
    commands: [
        invitesCommand
    ],
    events: [
        guildMemberAdd,
        guildMemberRemove,
        inviteCreate,
        inviteDelete,
        guildCreate
    ],
    components: [],
    async initialize({ client }) {
        // Runs once: the invite cache must exist before the first join arrives.
        let cached = false;
        const warmCache = async () => {
            if (cached) return;
            cached = true;
            await initInviteCache(client);
        };

        if (client.isReady()) {
            await warmCache();
        } else {
            // discord.js >= 14.16 emits `clientReady` (the old `ready` name is
            // deprecated and disappears in v15).
            client.once('clientReady', warmCache);
            client.once('ready', warmCache);
        }
    }
};
