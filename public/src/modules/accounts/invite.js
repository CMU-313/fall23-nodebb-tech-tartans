'use strict';
// const db = require('./../../../src/database');
// // const user = require('../../../../src/user');

// // const path = require('path');

// // // Define the path to the module you want to require
// // const dbPath = path.join(__dirname, '../src/database');

// // // Now, require the module using the calculated absolute path
// // const db = require(dbPath);

define('accounts/invite', ['api', 'benchpress', 'bootbox', 'alerts'], function (api, Benchpress, bootbox, alerts) {
    const Invite = {};

    function isACP() {
        return ajaxify.data.template.name.startsWith('admin/');
    }

    Invite.handle = function () {
        $('[component="user/invite"]').on('click', function (e) {
            e.preventDefault();
            console.log('This is a message to the console saying the invite button has been clicked');
            api.get(`/api/v3/users/${app.user.uid}/invites/groups`, {}).then((groups) => {
                Benchpress.parse('modals/invite', { groups: groups }, function (html) {
                    bootbox.dialog({
                        message: html,
                        title: `[[${isACP() ? 'admin/manage/users:invite' : 'users:invite'}]]`,
                        onEscape: true,
                        buttons: {
                            cancel: {
                                label: `[[${isACP() ? 'admin/manage/users:alerts.button-cancel' : 'modules:bootbox.cancel'}]]`,
                                className: 'btn-default',
                            },
                            invite: {
                                label: `[[${isACP() ? 'admin/manage/users:invite' : 'users:invite'}]]`,
                                className: 'btn-primary',
                                callback: Invite.send,
                            },
                        },
                    });
                });
            }).catch(alerts.error);
        });
    };

    Invite.send = function () {
        const $emails = $('#invite-modal-emails');
        const $groups = $('#invite-modal-groups');

        const data = {
            emails: $emails.val()
                .split(',')
                .map(m => m.trim())
                .filter(Boolean)
                .filter((m, i, arr) => i === arr.indexOf(m))
                .join(','),
            groupsToJoin: $groups.val(),
        };

        if (!data.emails) {
            return;
        }

        api.post(`/users/${app.user.uid}/invites`, data).then(() => {
            alerts.success(`[[${isACP() ? 'admin/manage/users:alerts.email-sent-to' : 'users:invitation-email-sent'}, ${data.emails.replace(/,/g, '&#44; ')}]]`);
        }).catch(alerts.error);
    };

    return Invite;
});

define('accounts/addfriends', ['api', 'benchpress', 'bootbox', 'alerts'], function (api, Benchpress, bootbox, alerts) {
    const AddFriends = {};
    const friends_data = [];

    AddFriends.handle = function () {
        $('[component="user/addfriends"]').on('click', function (e) {
            e.preventDefault();
            console.log('This is a message that confirms that the add friends button was clicked');
            api.get(`/api/users/`, {}).then((users_response) => {
                // console.log('Here is the users_response');
                // console.log(users_response);

                for (let i = 0; i < users_response['users'].length; i++) {
                    // console.log("Here is each username")
                    // console.log(users_response['users'][i]['username'])
                    // usernames.push(users_response['users'][i]['username']);
                    friends_data.push([users_response['users'][i]['uid'], users_response['users'][i]['username']]);
                }

                

                // const db_output = db.getSetMembers('username:uid');
                // console.log("Here is the db output: ");
                // console.log(db_output);


                // console.log("Here are all usernames")
                // console.log(usernames)

                Benchpress.parse('modals/addfriends', { friends_data: friends_data }, function (html) {
                    bootbox.dialog({
                        message: html,
                        title: `Add Friends`,
                        onEscape: true,
                        buttons: {
                            cancel: {
                                label: `Cancel`,
                                className: 'btn-default',
                            },
                            invite: {
                                label: `Add Friend`,
                                className: 'btn-primary',
                                callback: AddFriends.send,
                            },
                        },
                    });
                });
                
            }).catch(alerts.error);
            friends_data.splice(0,friends_data.length);
            
        });
    };

    AddFriends.send = function () {
        const $friends_data = $('#added-friends-data');

        console.log("Here are the (user_id, username) pairs of friends added");
        console.log($friends_data.val());

        const data = {
            friends_data: $friends_data.val(),
        };

        api.post(`/users/${app.user.uid}/addfriends`, data).then(() => {
            alerts.success(`Friends have been added`);
        }).catch(alerts.error);

    };

    return AddFriends;
});
