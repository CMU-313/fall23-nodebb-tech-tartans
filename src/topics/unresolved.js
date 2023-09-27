
'use strict';

const db = require('../database');
const plugins = require('../plugins');

module.exports = function (Topics) {
    Topics.getUnresolvedTopics = async function (cid, uid, filter) {
        return await Topics.getSortedTopics({
            cids: cid,
            uid: uid,
            filter: filter,
        });
    };

    Topics.markUnresolved = async function (tid) {
        let data = { tid: tid };
        data = await plugins.hooks.fire('filter:topics.markUnresolved', { tid: tid });
        if (data && data.tid) {
            await db.sortedSetAdd('topics:unresolved', data.tid);
            const resolved = await db.isSortedSetMember('topics:resolved', tid);
            if (resolved) {
                await db.sortedSetRemove('topics:resolved', data.tid);
            }
        }
    };

    Topics.markResolved = async function (tid) {
        let data = { tid: tid };
        data = await plugins.hooks.fire('filter:topics.markResolved', { tid: tid });
        if (data && data.tid) {
            await db.sortedSetAdd('topics:resolved', data.tid);
            const unresolved = await db.isSortedSetMember('topics:unresolved', tid);
            if (unresolved) {
                await db.sortedSetRemove('topics:unresolved', data.tid);
            }
        }
    };
};
