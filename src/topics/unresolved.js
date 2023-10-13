
'use strict';

const async = require('async');
const _ = require('lodash');

const db = require('../database');
const user = require('../user');
const posts = require('../posts');
const categories = require('../categories');
const privileges = require('../privileges');
const plugins = require('../plugins');

module.exports = function (Topics) {
    Topics.getTotalUnresolved = async function (uid, filter) {
        filter = filter || '';
        const counts = await Topics.getUnresolvedTids({ cid: 0, uid: uid, count: true });
        return counts && counts[filter];
    };

    Topics.getUnresolvedTopics = async function (params) {
        const unresolvedTopics = {
            showSelect: true,
            nextStart: 0,
            topics: [],
        };
        let tids = await Topics.getUnresolvedTids(params);
        unresolvedTopics.topicCount = tids.length;

        if (!tids.length) {
            return unresolvedTopics;
        }

        tids = tids.slice(params.start, params.stop !== -1 ? params.stop + 1 : undefined);

        const topicData = await Topics.getTopicsByTids(tids, params.uid);
        if (!topicData.length) {
            return unresolvedTopics;
        }
        Topics.calculateTopicIndices(topicData, params.start);
        unresolvedTopics.topics = topicData;
        unresolvedTopics.nextStart = params.stop + 1;
        return unresolvedTopics;
    };

    Topics.getUnresolvedTids = async function (params) {
        const results = await Topics.getUnresolvedData(params);
        return params.count ? results.counts : results.tids;
    };

    Topics.getUnresolvedData = async function (params) {
        const uid = parseInt(params.uid, 10);

        params.filter = params.filter || '';

        if (params.cid && !Array.isArray(params.cid)) {
            params.cid = [params.cid];
        }

        const data = await getTids(params);
        if (uid <= 0 || !data.tids || !data.tids.length) {
            return data;
        }

        const result = await plugins.hooks.fire('filter:topics.getUnresolvedTids', {
            uid: uid,
            tids: data.tids,
            counts: data.counts,
            tidsByFilter: data.tidsByFilter,
            cid: params.cid,
            filter: params.filter,
            query: params.query || {},
        });
        return result;
    };

    async function getTids(params) {
        const counts = { '': 0, new: 0, watched: 0, unreplied: 0, unread: 0 };
        const tidsByFilter = { '': [], new: [], watched: [], unreplied: [], unread: [] };

        if (params.uid <= 0) {
            return { counts: counts, tids: [], tidsByFilter: tidsByFilter };
        }

        params.cutoff = await Topics.unreadCutoff(params.uid);

        const [followedTids, ignoredTids, categoryTids, userScores, tids_unread, tids_unresolved] = await Promise.all([
            getFollowedTids(params),
            user.getIgnoredTids(params.uid, 0, -1),
            getCategoryTids(params),
            db.getSortedSetRevRangeByScoreWithScores(`uid:${params.uid}:tids_read`, 0, -1, '+inf', params.cutoff),
            db.getSortedSetRevRangeWithScores(`uid:${params.uid}:tids_unread`, 0, -1),
            db.getSortedSetRevRangeWithScores(`topics:unresolved`, 0, -1),
        ]);

        const userReadTimes = _.mapValues(_.keyBy(userScores, 'value'), 'score');
        const isTopicsFollowed = {};
        followedTids.forEach((t) => {
            isTopicsFollowed[t.value] = true;
        });
        const isUnresolved = {};
        tids_unresolved.forEach((t) => {
            isUnresolved[t.value] = true;
        });
        const unreadFollowed = await db.isSortedSetMembers(
            `uid:${params.uid}:followed_tids`, tids_unread.map(t => t.value)
        );

        tids_unread.forEach((t, i) => {
            isTopicsFollowed[t.value] = unreadFollowed[i];
        });

        const unreadTopics = _.unionWith(categoryTids, followedTids, (a, b) => a.value === b.value)
            .filter(t => !ignoredTids.includes(t.value) &&
                    (!userReadTimes[t.value] || t.score > userReadTimes[t.value]))
            .concat(tids_unread.filter(t => !ignoredTids.includes(t.value)))
            .sort((a, b) => b.score - a.score);
        const isUnread = {};
        unreadTopics.forEach((t) => {
            isUnread[t.value] = true;
        });

        const unresolvedTopics = tids_unresolved
            .filter(t => !ignoredTids.includes(t.value))
            .sort((a, b) => b.score - a.score);

        let tids = _.uniq(unresolvedTopics.map(topic => topic.value)).slice(0, 200);

        if (!tids.length) {
            return { counts: counts, tids: tids, tidsByFilter: tidsByFilter };
        }

        const blockedUids = await user.blocks.list(params.uid);

        tids = await filterTidsThatHaveBlockedPosts({
            uid: params.uid,
            tids: tids,
            blockedUids: blockedUids,
            recentTids: categoryTids,
        });

        tids = await privileges.topics.filterTids('topics:read', tids, params.uid);
        const topicData = (await Topics.getTopicsFields(tids, ['tid', 'cid', 'uid', 'postcount', 'deleted', 'scheduled', 'unresolved']))
            .filter(t => t.scheduled || !t.deleted);
        const topicCids = _.uniq(topicData.map(topic => topic.cid)).filter(Boolean);

        const categoryWatchState = await categories.getWatchState(topicCids, params.uid);
        const userCidState = _.zipObject(topicCids, categoryWatchState);

        const filterCids = params.cid && params.cid.map(cid => parseInt(cid, 10));

        topicData.forEach((topic) => {
            if (topic && topic.cid && (!filterCids || filterCids.includes(topic.cid)) &&
                !blockedUids.includes(topic.uid)) {
                if (isTopicsFollowed[topic.tid] || userCidState[topic.cid] === categories.watchStates.watching) {
                    tidsByFilter[''].push(topic.tid);
                }

                if (isTopicsFollowed[topic.tid]) {
                    tidsByFilter.watched.push(topic.tid);
                }

                if (topic.postcount <= 1) {
                    tidsByFilter.unreplied.push(topic.tid);
                }

                if (!userReadTimes[topic.tid]) {
                    tidsByFilter.new.push(topic.tid);
                }

                if (isUnread[topic.tid]) {
                    tidsByFilter.unread.push(topic.tid);
                }
            }
        });

        counts[''] = tidsByFilter[''].length;
        counts.watched = tidsByFilter.watched.length;
        counts.unreplied = tidsByFilter.unreplied.length;
        counts.new = tidsByFilter.new.length;
        counts.unread = tidsByFilter.unread.length;

        return {
            counts: counts,
            tids: tidsByFilter[params.filter],
            tidsByFilter: tidsByFilter,
        };
    }

    async function getCategoryTids(params) {
        if (plugins.hooks.hasListeners('filter:topics.unresolved.getCategoryTids')) {
            const result = await plugins.hooks.fire('filter:topics.unresolved.getCategoryTids', { params: params, tids: [] });
            return result.tids;
        }
        if (params.filter === 'watched') {
            return [];
        }
        const cids = params.cid || await user.getWatchedCategories(params.uid);
        const keys = cids.map(cid => `cid:${cid}:tids`);
        return await db.getSortedSetRevRangeByScoreWithScores(keys, 0, -1, '+inf', params.cutoff);
    }

    async function getFollowedTids(params) {
        let tids = await db.getSortedSetMembers(`uid:${params.uid}:followed_tids`);
        const filterCids = params.cid && params.cid.map(cid => parseInt(cid, 10));
        if (filterCids) {
            const topicData = await Topics.getTopicsFields(tids, ['tid', 'cid']);
            tids = topicData.filter(t => filterCids.includes(t.cid)).map(t => t.tid);
        }
        const scores = await db.sortedSetScores('topics:recent', tids);
        const data = tids.map((tid, index) => ({ value: String(tid), score: scores[index] }));
        return data.filter(item => item.score > params.cutoff);
    }

    async function filterTidsThatHaveBlockedPosts(params) {
        if (!params.blockedUids.length) {
            return params.tids;
        }
        const topicScores = _.mapValues(_.keyBy(params.recentTids, 'value'), 'score');

        const results = await db.sortedSetScores(`uid:${params.uid}:tids_read`, params.tids);

        const userScores = _.zipObject(params.tids, results);

        return await async.filter(params.tids, async tid => await doesTidHaveUnblockedUnreadPosts(tid, {
            blockedUids: params.blockedUids,
            topicTimestamp: topicScores[tid],
            userLastReadTimestamp: userScores[tid],
        }));
    }

    async function doesTidHaveUnblockedUnreadPosts(tid, params) {
        const { userLastReadTimestamp } = params;
        if (!userLastReadTimestamp) {
            return true;
        }
        let start = 0;
        const count = 3;
        let done = false;
        let hasUnblockedUnread = params.topicTimestamp > userLastReadTimestamp;
        if (!params.blockedUids.length) {
            return hasUnblockedUnread;
        }
        while (!done) {
            /* eslint-disable no-await-in-loop */
            const pidsSinceLastVisit = await db.getSortedSetRangeByScore(`tid:${tid}:posts`, start, count, userLastReadTimestamp, '+inf');
            if (!pidsSinceLastVisit.length) {
                return hasUnblockedUnread;
            }
            let postData = await posts.getPostsFields(pidsSinceLastVisit, ['pid', 'uid']);
            postData = postData.filter(post => !params.blockedUids.includes(parseInt(post.uid, 10)));

            done = postData.length > 0;
            hasUnblockedUnread = postData.length > 0;
            start += count;
        }
        return hasUnblockedUnread;
    }

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
