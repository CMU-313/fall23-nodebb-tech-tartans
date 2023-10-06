'use strict';

const nconf = require('nconf');
const querystring = require('querystring');

const meta = require('../meta');
const pagination = require('../pagination');
const user = require('../user');
const topics = require('../topics');
const helpers = require('./helpers');

const unresolvedController = module.exports;
const relative_path = nconf.get('relative_path');

unresolvedController.get = async function (req, res) {
    const { cid } = req.query;
    const filter = req.query.filter || '';

    const [categoryData, userSettings, isPrivileged] = await Promise.all([
        helpers.getSelectedCategory(cid),
        user.getSettings(req.uid),
        user.isPrivileged(req.uid),
    ]);

    const page = parseInt(req.query.page, 10) || 1;
    const start = Math.max(0, (page - 1) * userSettings.topicsPerPage);
    const stop = start + userSettings.topicsPerPage - 1;
    const data = await topics.getUnreadTopics({
        cid: cid,
        uid: req.uid,
        start: start,
        stop: stop,
        filter: filter,
        query: req.query,
    });

    const isDisplayedAsHome = !(req.originalUrl.startsWith(`${relative_path}/api/unresolved`) || req.originalUrl.startsWith(`${relative_path}/unresolved`));
    const baseUrl = isDisplayedAsHome ? '' : 'unresolved';

    if (isDisplayedAsHome) {
        data.title = meta.config.homePageTitle || '[[pages:home]]';
    } else {
        data.title = '[[pages:unresolved]]';
        data.breadcrumbs = helpers.buildBreadcrumbs([{ text: '[[unresolved:title]]' }]);
    }

    data.pageCount = Math.max(1, Math.ceil(data.topicCount / userSettings.topicsPerPage));
    data.pagination = pagination.create(page, data.pageCount, req.query);
    helpers.addLinkTags({ url: 'unresolved', res: req.res, tags: data.pagination.rel });

    if (userSettings.usePagination && (page < 1 || page > data.pageCount)) {
        req.query.page = Math.max(1, Math.min(data.pageCount, page));
        return helpers.redirect(res, `/unresolved?${querystring.stringify(req.query)}`);
    }
    data.showSelect = true;
    data.showTopicTools = isPrivileged;
    data.allCategoriesUrl = `${baseUrl}${helpers.buildQueryString(req.query, 'cid', '')}`;
    data.selectedCategory = categoryData.selectedCategory;
    data.selectedCids = categoryData.selectedCids;
    data.selectCategoryLabel = '[[unresolved:mark_as_resolved]]';
    data.selectCategoryIcon = 'fa-inbox';
    data.showCategorySelectLabel = true;
    data.filters = helpers.buildFilters(baseUrl, filter, req.query);
    data.selectedFilter = data.filters.find(filter => filter && filter.selected);

    res.render('unresolved', data);
};

unresolvedController.unreTotal = async function (req, res, next) {
    const filter = req.query.filter || '';
    try {
        const unresolvedCount = await topics.getTotalUnresolved(req.uid, filter);
        res.json(unresolvedCount);
    } catch (err) {
        next(err);
    }
};
