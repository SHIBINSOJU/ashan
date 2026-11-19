const { InviteStats } = require('../models/InviteStats');
const { MemberInvite } = require('../models/MemberInvite');
const { isDatabaseReady, isUsingLocalStorage } = require('../connection');
const { getStore } = require('../localStorage');
const logger = require('../../core/logger');

const EMPTY_STATS = { regular: 0, left: 0, fake: 0, bonus: 0, rejoins: 0, joins: 0 };

function getStatsStore() {
    return getStore('invite_stats');
}

function getMemberStore() {
    return getStore('member_invites');
}

// In-memory fallbacks when neither MongoDB nor LocalStorage is functioning
const memoryStats = new Map(); // key: `${guildId}:${userId}` -> counters
const memoryMembers = new Map(); // key: `${guildId}:${memberId}` -> { inviterId, code, isFake, hasLeft, joinedAt }

function statsKey(guildId, userId) {
    return `${guildId}:${userId}`;
}

function memberKey(guildId, memberId) {
    return `${guildId}:${memberId}`;
}

function computeTotal(stat) {
    if (!stat) return 0;
    return Math.max(0, (stat.regular || 0) + (stat.bonus || 0) - (stat.left || 0));
}

function formatResult(doc) {
    if (!doc) {
        return { ...EMPTY_STATS, total: 0 };
    }
    const regular = doc.regular || 0;
    const left = Math.max(0, doc.left || 0);
    const fake = doc.fake || 0;
    const bonus = doc.bonus || 0;
    const rejoins = doc.rejoins || 0;
    // Older documents have no `joins` counter — rebuild it from what we know.
    const joins = doc.joins !== undefined ? doc.joins : regular + fake + rejoins;
    return {
        regular,
        left,
        fake,
        bonus,
        rejoins,
        joins,
        total: Math.max(0, regular + bonus - left)
    };
}

/** Counter bucket after applying an increment, never below zero. */
function applyInc(bucket, inc) {
    const next = { ...EMPTY_STATS, ...bucket };
    for (const [field, amount] of Object.entries(inc || {})) {
        next[field] = Math.max(0, (Number(next[field]) || 0) + Number(amount));
    }
    return next;
}

async function readMemberDoc(guildId, memberId) {
    if (isUsingLocalStorage()) {
        try {
            return await getMemberStore().findOne({ guildId, memberId }).lean();
        } catch (err) {
            logger.error(`inviteRepository.readMemberDoc local failed: ${err.message}`);
            return null;
        }
    }

    if (isDatabaseReady()) {
        try {
            const doc = await MemberInvite.findOne({ guildId, memberId }).lean();
            if (doc) return doc;
        } catch (err) {
            logger.error(`inviteRepository.readMemberDoc DB failed: ${err.message}`);
        }
    }

    return memoryMembers.get(memberKey(guildId, memberId)) || null;
}

async function writeMemberDoc(guildId, memberId, fields) {
    const now = new Date();

    if (isUsingLocalStorage()) {
        try {
            return await getMemberStore().findOneAndUpdate(
                { guildId, memberId },
                { $set: { ...fields, updatedAt: now.toISOString() } },
                { upsert: true, returnDocument: 'after' }
            );
        } catch (err) {
            logger.error(`inviteRepository.writeMemberDoc local failed: ${err.message}`);
        }
    }

    const current = memoryMembers.get(memberKey(guildId, memberId)) || {};
    memoryMembers.set(memberKey(guildId, memberId), { ...current, ...fields, updatedAt: now });

    if (isDatabaseReady() && !isUsingLocalStorage()) {
        try {
            return await MemberInvite.findOneAndUpdate(
                { guildId, memberId },
                { $set: fields, $setOnInsert: { joinedAt: fields.joinedAt || now } },
                { upsert: true, returnDocument: 'after' }
            );
        } catch (err) {
            logger.error(`inviteRepository.writeMemberDoc DB failed: ${err.message}`);
        }
    }

    return null;
}

async function readStatsDoc(guildId, userId) {
    if (isUsingLocalStorage()) {
        try {
            return await getStatsStore().findOne({ guildId, userId }).lean();
        } catch (err) {
            logger.error(`inviteRepository.readStatsDoc local failed: ${err.message}`);
            return null;
        }
    }

    if (isDatabaseReady()) {
        try {
            const doc = await InviteStats.findOne({ guildId, userId }).lean();
            if (doc) return doc;
        } catch (err) {
            logger.error(`inviteRepository.readStatsDoc DB failed: ${err.message}`);
        }
    }

    return memoryStats.get(statsKey(guildId, userId)) || null;
}

/** Increment counters for an inviter and return the formatted stats. */
async function bumpStats(guildId, userId, inc) {
    if (isUsingLocalStorage()) {
        try {
            const doc = await getStatsStore().findOneAndUpdate(
                { guildId, userId },
                { $inc: inc },
                { upsert: true, returnDocument: 'after' }
            );
            return formatResult(doc);
        } catch (err) {
            logger.error(`inviteRepository.bumpStats local failed: ${err.message}`);
        }
    }

    const key = statsKey(guildId, userId);
    const next = applyInc(memoryStats.get(key), inc);
    memoryStats.set(key, next);
    let result = formatResult(next);

    if (isDatabaseReady() && !isUsingLocalStorage()) {
        try {
            const doc = await InviteStats.findOneAndUpdate(
                { guildId, userId },
                { $inc: inc },
                { upsert: true, returnDocument: 'after' }
            );
            result = formatResult(doc);
        } catch (err) {
            logger.error(`inviteRepository.bumpStats DB failed: ${err.message}`);
        }
    }

    return result;
}

/** Undo one counted leave (used when a member returns). Never goes below 0. */
async function releaseLeave(guildId, userId) {
    const raw = await readStatsDoc(guildId, userId);
    if (!raw || (Number(raw.left) || 0) <= 0) return null;
    return bumpStats(guildId, userId, { left: -1 });
}

async function getStats(guildId, userId) {
    return formatResult(await readStatsDoc(guildId, userId));
}

/** Read-only: who invited this member (null when unknown). */
async function getJoinRecord(guildId, memberId) {
    const doc = await readMemberDoc(guildId, memberId);
    if (!doc) return null;
    return {
        inviterId: doc.inviterId || null,
        code: doc.code || null,
        isFake: !!doc.isFake
    };
}

/**
 * Records a join. Returns:
 *   { stats, isRejoin, previousInviterId, inviterId }
 * — `stats` is null when the join could not be credited to an inviter.
 */
async function recordJoin(guildId, memberId, inviterId, code, isFake = false) {
    const previous = await readMemberDoc(guildId, memberId);
    const isRejoin = Boolean(previous);
    const previousInviterId = previous?.inviterId || null;
    // A rejoin through an unknown/vanity link keeps the original credit.
    const creditedInviterId = inviterId || (isRejoin ? previousInviterId : null);

    await writeMemberDoc(guildId, memberId, {
        inviterId: creditedInviterId || null,
        code: code || null,
        isFake: !!isFake,
        hasLeft: false,
        leftAt: null,
        joinedAt: new Date()
    });

    let stats = null;

    if (creditedInviterId) {
        if (isRejoin) {
            // The member came back — give the leave point back to whoever
            // was originally credited, then credit the rejoin.
            if (previousInviterId && previousInviterId !== creditedInviterId) {
                await releaseLeave(guildId, previousInviterId);
            } else {
                await releaseLeave(guildId, creditedInviterId);
            }
            stats = await bumpStats(guildId, creditedInviterId, { rejoins: 1, joins: 1 });
        } else {
            stats = await bumpStats(
                guildId,
                creditedInviterId,
                isFake ? { fake: 1, joins: 1 } : { regular: 1, joins: 1 }
            );
        }
    }

    return { stats, isRejoin, previousInviterId, inviterId: creditedInviterId || null };
}

/**
 * Records a leave against the inviter. Returns:
 *   { inviterId, stats, isFake, alreadyCounted }
 * `alreadyCounted` is true when the member had already been counted as left.
 */
async function recordLeave(guildId, memberId) {
    const memberDoc = await readMemberDoc(guildId, memberId);
    if (!memberDoc || !memberDoc.inviterId) {
        return { inviterId: null, stats: null, isFake: false, alreadyCounted: false };
    }

    if (memberDoc.hasLeft) {
        return { inviterId: memberDoc.inviterId, stats: null, isFake: !!memberDoc.isFake, alreadyCounted: true };
    }

    await writeMemberDoc(guildId, memberId, { hasLeft: true, leftAt: new Date() });
    const stats = await bumpStats(guildId, memberDoc.inviterId, { left: 1 });

    return {
        inviterId: memberDoc.inviterId,
        stats,
        isFake: !!memberDoc.isFake,
        alreadyCounted: false
    };
}

async function addBonus(guildId, userId, amount) {
    return bumpStats(guildId, userId, { bonus: amount });
}

async function removeBonus(guildId, userId, amount) {
    return bumpStats(guildId, userId, { bonus: -amount });
}

async function resetStats(guildId, userId) {
    const zero = { ...EMPTY_STATS, total: 0 };

    if (isUsingLocalStorage()) {
        try {
            await getStatsStore().findOneAndUpdate(
                { guildId, userId },
                { $set: { ...EMPTY_STATS } },
                { upsert: true }
            );
            return zero;
        } catch (err) {
            logger.error(`inviteRepository.resetStats local failed: ${err.message}`);
            return zero;
        }
    }

    memoryStats.set(statsKey(guildId, userId), { ...EMPTY_STATS });

    if (isDatabaseReady() && !isUsingLocalStorage()) {
        try {
            await InviteStats.findOneAndUpdate(
                { guildId, userId },
                { $set: { ...EMPTY_STATS } },
                { upsert: true }
            );
        } catch (err) {
            logger.error(`inviteRepository.resetStats DB failed: ${err.message}`);
        }
    }

    return zero;
}

function mapRow(row) {
    return {
        userId: row.userId,
        regular: row.regular || 0,
        left: Math.max(0, row.left || 0),
        fake: row.fake || 0,
        bonus: row.bonus || 0,
        rejoins: row.rejoins || 0,
        joins: row.joins !== undefined ? row.joins : (row.regular || 0) + (row.fake || 0) + (row.rejoins || 0),
        total: computeTotal(row)
    };
}

async function getLeaderboard(guildId, limit = 10, skip = 0) {
    if (isUsingLocalStorage()) {
        try {
            const allDocs = await getStatsStore().find({ guildId });
            const list = allDocs.map(mapRow);
            list.sort((a, b) => b.total - a.total || b.regular - a.regular);
            return list.slice(skip, skip + limit);
        } catch (err) {
            logger.error(`inviteRepository.getLeaderboard local failed: ${err.message}`);
            return [];
        }
    }

    if (isDatabaseReady()) {
        try {
            const results = await InviteStats.aggregate([
                { $match: { guildId } },
                {
                    $addFields: {
                        total: {
                            $max: [
                                0,
                                {
                                    $subtract: [
                                        { $add: [{ $ifNull: ['$regular', 0] }, { $ifNull: ['$bonus', 0] }] },
                                        { $ifNull: ['$left', 0] }
                                    ]
                                }
                            ]
                        }
                    }
                },
                { $sort: { total: -1, regular: -1 } },
                { $skip: skip },
                { $limit: limit }
            ]);

            return results.map(mapRow);
        } catch (err) {
            logger.error(`inviteRepository.getLeaderboard DB failed: ${err.message}`);
        }
    }

    // Memory fallback
    const list = [];
    for (const [key, val] of memoryStats.entries()) {
        if (key.startsWith(`${guildId}:`)) {
            list.push(mapRow({ userId: key.split(':')[1], ...val }));
        }
    }

    list.sort((a, b) => b.total - a.total || b.regular - a.regular);
    return list.slice(skip, skip + limit);
}

module.exports = {
    getStats,
    getJoinRecord,
    recordJoin,
    recordLeave,
    addBonus,
    removeBonus,
    resetStats,
    getLeaderboard
};
