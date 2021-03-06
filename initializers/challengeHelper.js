/*
 * Copyright (C) 2013 - 2014 TopCoder Inc., All Rights Reserved.
 *
 * @version 1.0
 * @author ecnu_haozi
 * Refactor common code out from challenge.js.
 */
"use strict";

require('datejs');
var async = require('async');
var _ = require('underscore');
var BadRequestError = require('../errors/BadRequestError');
var UnauthorizedError = require('../errors/UnauthorizedError');
var NotFoundError = require('../errors/NotFoundError');
var ForbiddenError = require('../errors/ForbiddenError');

/**
 * This copilot posting project type id
 */
var COPILOT_POSTING_PROJECT_TYPE = 29;

/**
 * Expose the "idGenerator" utility.
 *
 * @param {Object} api The api object that is used to access the infrastructure
 * @param {Function} next The callback function to be called when everyting is done
 */
exports.challengeHelper = function (api, next) {
    api.challengeHelper = {

        /**
         * Gets the challenge terms for the current user given the challenge id and an optional role.
         * 
         * @param {Object} connection The connection object for the current request
         * @param {Number} challengeId The challenge id.
         * @param {String} role The user's role name, this is optional.
         * @param {Object} dbConnectionMap The database connection map for the current request
         * @param {Function<err, terms_array>} next The callback to be called after this function is done
         */
        getChallengeTerms : function (connection, challengeId, role, dbConnectionMap, next) {

            //Check if the user is logged-in
            if (_.isUndefined(connection.caller) || _.isNull(connection.caller) ||
                    _.isEmpty(connection.caller) || !_.contains(_.keys(connection.caller), 'userId')) {
                next(new UnauthorizedError("Authentication details missing or incorrect."));
                return;
            }

            var helper = api.helper,
                sqlParams = {},
                result = {},
                userId = connection.caller.userId;

            async.waterfall([
                function (cb) {

                    //Simple validations of the incoming parameters
                    var error = helper.checkPositiveInteger(challengeId, 'challengeId') ||
                        helper.checkMaxInt(challengeId, 'challengeId');

                    if (error) {
                        cb(error);
                        return;
                    }

                    //Check if the user passes validations for joining the challenge
                    sqlParams.userId = userId;
                    sqlParams.challengeId = challengeId;

                    api.dataAccess.executeQuery("challenge_registration_validations", sqlParams, dbConnectionMap, cb);
                }, function (rows, cb) {
                    if (rows.length === 0) {
                        cb(new NotFoundError('No such challenge exists.'));
                        return;
                    }

                    if (!rows[0].no_elgibility_req && !rows[0].user_in_eligible_group) {
                        cb(new ForbiddenError('You are not part of the groups eligible for this challenge.'));
                        return;
                    }

                    if (!rows[0].reg_open) {
                        cb(new ForbiddenError('Registration Phase of this challenge is not open.'));
                        return;
                    }

                    if (rows[0].user_registered) {
                        cb(new ForbiddenError('You are already registered for this challenge.'));
                        return;
                    }

                    if (rows[0].user_suspended) {
                        cb(new ForbiddenError('You cannot participate in this challenge due to suspension.'));
                        return;
                    }

                    if (rows[0].user_country_banned) {
                        cb(new ForbiddenError('You cannot participate in this challenge as your country is banned.'));
                        return;
                    }

                    if (rows[0].project_category_id === COPILOT_POSTING_PROJECT_TYPE) {
                        if (!rows[0].user_is_copilot && rows[0].copilot_type.indexOf("Marathon Match") < 0) {
                            cb(new ForbiddenError('You cannot participate in this challenge because you are not an active member of the copilot pool.'));
                            return;
                        }
                    }

                    // We are here. So all validations have passed.
                    // Next we get all roles
                    api.dataAccess.executeQuery("all_resource_roles", {}, dbConnectionMap, cb);
                }, function (rows, cb) {
                    // Prepare a comma separated string of resource role names that must match
                    var commaSepRoleIds = "",
                        compiled = _.template("<%= resource_role_id %>,"),
                        ctr = 0,
                        resourceRoleFound;
                    if (_.isUndefined(role)) {
                        rows.forEach(function (row) {
                            commaSepRoleIds += compiled({resource_role_id: row.resource_role_id});
                            ctr += 1;
                            if (ctr === rows.length) {
                                commaSepRoleIds = commaSepRoleIds.slice(0, -1);
                            }
                        });
                    } else {
                        resourceRoleFound = _.find(rows, function (row) {
                            return (row.name === role);
                        });
                        if (_.isUndefined(resourceRoleFound)) {
                            //The role passed in is not recognized
                            cb(new BadRequestError("The role: " + role + " was not found."));
                            return;
                        }
                        commaSepRoleIds = resourceRoleFound.resource_role_id;
                    }

                    // Get the terms
                    sqlParams.resourceRoleIds = commaSepRoleIds;
                    api.dataAccess.executeQuery("challenge_terms_of_use", sqlParams, dbConnectionMap, cb);
                }, function (rows, cb) {
                    //We could just have down result.data = rows; but we need to change keys to camel case as per requirements
                    var camelCaseMap = {
                        'agreeability_type': 'agreeabilityType',
                        'terms_of_use_id': 'termsOfUseId'
                    };
                    result.terms = [];
                    _.each(rows, function (row) {
                        var item = {};
                        _.each(row, function (value, key) {
                            key = camelCaseMap[key] || key;
                            item[key] = value;
                        });
                        result.terms.push(item);
                    });
                    cb();
                }
            ], function (err) {
                if (err) {
                    next(err);
                    return;
                }
                next(null, result.terms);
            });
        }
    };

    next();
};
