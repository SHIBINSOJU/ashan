// Heuristic alt-account detection for invite tracking.
// "Alt" is never a verdict — it only flags a join so staff can review it
// (flagged accounts are counted in the separate `fake` bucket, never `regular`).
const DEFAULT_ALT_CONFIG = {
    enabled: true,
    minAccountAgeDays: 7,
    avatarCloneCheck: true
};

const DAY_MS = 24 * 60 * 60 * 1000;

function accountAgeDays(user) {
    if (!user?.createdTimestamp) return Infinity;
    return (Date.now() - user.createdTimestamp) / DAY_MS;
}

function resolveAltConfig(inviteConfig) {
    const cfg = { ...DEFAULT_ALT_CONFIG, ...(inviteConfig?.altDetection || {}) };
    if (cfg.minAccountAgeDays === undefined || cfg.minAccountAgeDays === null) {
        cfg.minAccountAgeDays = inviteConfig?.minAccountAgeDays ?? DEFAULT_ALT_CONFIG.minAccountAgeDays;
    }
    return cfg;
}

function formatAge(days) {
    if (!Number.isFinite(days)) return 'unknown';
    if (days < 1) return `${Math.max(1, Math.round(days * 24))}h`;
    return `${days.toFixed(1)}d`;
}

/**
 * Returns { isAlt, reasons, ageDays }.
 * Checks (each independently configurable):
 *   1. account age below the alt threshold;
 *   2. same custom avatar as an existing human member (classic clone signal).
 */
function detectAlt(member, inviteConfig) {
    const cfg = resolveAltConfig(inviteConfig);
    const reasons = [];
    const ageDays = accountAgeDays(member?.user);

    if (!cfg.enabled) return { isAlt: false, reasons, ageDays };

    const threshold = Number(cfg.minAccountAgeDays);
    if (Number.isFinite(threshold) && threshold > 0 && ageDays < threshold) {
        reasons.push(`account is only ${formatAge(ageDays)} old`);
    }

    if (cfg.avatarCloneCheck !== false) {
        const avatarHash = member?.user?.avatar;
        if (avatarHash && member.guild?.members?.cache) {
            const clone = member.guild.members.cache.find(other =>
                other.id !== member.id &&
                !other.user?.bot &&
                other.user?.avatar === avatarHash
            );
            if (clone) reasons.push(`shares an avatar with ${clone.user.username}`);
        }
    }

    return { isAlt: reasons.length > 0, reasons, ageDays };
}

module.exports = {
    DEFAULT_ALT_CONFIG,
    detectAlt,
    accountAgeDays,
    resolveAltConfig,
    formatAge
};
