'use strict';

define('accounts/addfriends', ['api', 'benchpress', 'bootbox', 'alerts'], function (api, Benchpress, bootbox, alerts) {
    const AddFriends = {};
    console.log('This is a message to the console.');

    AddFriends.handle = function () {
        $('[component="user/addfriends"]').on('click', function (e) {
            e.preventDefault();
            console.log('This is a message that confirms that the add friends button was clicked');
        });
    };

    AddFriends.send = function () {
        
    };

    return AddFriends;
});
