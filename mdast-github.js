(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.mdastGitHub = f()}})(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
(function (global){
'use strict';

/*
 * Cached method.
 */

var splice = Array.prototype.splice;
var has = Object.prototype.hasOwnProperty;

/*
 * Hide process use from browserify.
 */
var proc = typeof global !== 'undefined' && global.process;

/**
 * Return a URL to GitHub, relative to an optional
 * `repo` object, or `user` and `project`.
 *
 * @param {Object|string?} repo
 * @param {string?} project
 * @return {string}
 */
function gh(repo, project) {
    var base = 'https://github.com/';

    if (project) {
        repo = {
            'user': repo,
            'project': project
        };
    }

    if (repo) {
        base += repo.user + '/' + repo.project + '/';
    }

    return base;
}

/*
 * Username may only contain alphanumeric characters or
 * single hyphens, and cannot begin or end with a hyphen.
 *
 * `PERSON` is either a user or a team, but also matches a team:
 * https://github.com/blog/1121-introducing-team-mentions
 */

var NAME = '(?:[a-z0-9]{1,2}|[a-z0-9][a-z0-9-]{1,37}[a-z0-9])';
var USER = '(' + NAME + ')';
var PERSON = '(' + NAME + '(?:\\/' + NAME + ')?)';
var SHA = '([a-f0-9]{7,40})';
var NUMBER = '([0-9]+)';
var PROJECT = '((?:[a-z0-9-]|\\.git[a-z0-9-]|\\.(?!git))+)';
var ISSUE = '(?:GH-|#)' + NUMBER;
var REPO = USER + '\\/' + PROJECT;

var EXPRESSION_SHA = new RegExp(
    '^' + SHA + '\\b', 'gi'
);

var EXPRESSION_USER_SHA = new RegExp(
    '^' + USER + '@' + SHA + '\\b', 'gi'
);

var EXPRESSION_REPO_SHA = new RegExp(
    '^' + REPO + '@' + SHA + '\\b', 'gi'
);

var EXPRESSION_ISSUE = new RegExp(
    '^' + ISSUE + '\\b', 'gi'
);

var EXPRESSION_USER_ISSUE = new RegExp(
    '^' + USER + '#' + NUMBER + '\\b', 'gi'
);

var EXPRESSION_REPO_ISSUE = new RegExp(
    '^' + REPO + '#' + NUMBER + '\\b', 'gi'
);

var EXPRESSION_MENTION = new RegExp(
    '^@' + PERSON + '\\b(?!-)', 'gi'
);

var EXPRESSIONS_REPO = new RegExp(
    '(?:^|/(?:repos/)?)' + REPO + '(?=\\.git|[\\/#@]|$)', 'i'
);

var EXPRESSIONS_WHITE_SPACE = new RegExp('\\s');

/*
 * Expressions to use.
 */

var expressions = {
    'sha': EXPRESSION_SHA,
    'userSHA': EXPRESSION_USER_SHA,
    'repoSHA': EXPRESSION_REPO_SHA,
    'issue': EXPRESSION_ISSUE,
    'userIssue': EXPRESSION_USER_ISSUE,
    'repoIssue': EXPRESSION_REPO_ISSUE,
    'mention': EXPRESSION_MENTION
};

var order = [
    'repoSHA',
    'userSHA',
    'sha',
    'repoIssue',
    'userIssue',
    'issue',
    'mention'
];

/*
 * Blacklist of SHAs which are also valid words.
 *
 * GitHub allows abbreviating SHAs up to 7 characters.
 *
 * Generated by:
 *
 *     egrep -i "^[a-f0-9]{7,}$" /usr/share/dict/words
 */

var BLACKLIST = [
    'deedeed',
    'fabaceae'
];

/**
 * Check if a value is a SHA.
 *
 * @param {string} sha
 * @return {boolean}
 */
function isSHA(sha) {
    return BLACKLIST.indexOf(sha.toLowerCase()) === -1;
}

/**
 * Abbreviate a SHA.
 *
 * @param {string} sha
 * @return {string}
 */
function abbr(sha) {
    return sha.slice(0, 7);
}

/**
 * Check if a node is a text node.
 *
 * @param {Node} node
 * @return {boolean}
 */
function isText(node) {
    return node && node.type === 'text';
}

/**
 * Render a link node.
 *
 * @param {Object} position
 * @param {string} href
 * @param {Array.<Node>} children
 * @return {Node}
 */
function link(position, href, children) {
    return {
        'type': 'link',
        'href': href,
        'title': null,
        'children': children,
        'position': position
    };
}

/**
 * Render a text node.
 *
 * @param {Object} position
 * @param {string} value
 * @return {Node}
 */
function text(position, value) {
    return {
        'type': 'text',
        'value': value,
        'position': position
    };
}

/**
 * Find references in a text node, and return a list
 * of replacement nodes.
 *
 * @param {Node} parent
 * @param {Object} repo
 * @return {Array.<Node>}
 */
function augment(parent, repo) {
    var value = parent.value;
    var valueLength = value.length;
    var nodes = [];
    var length = order.length;
    var index = -1;
    var offset = -1;
    var node;
    var name;
    var match;
    var subposition;
    var start = 0;
    var end = 0;
    var position = parent.position ? parent.position.start : {};
    var line = position.line || 1;
    var column = position.column || 1;

    /**
     * Get the current position.
     *
     * @return {Object}
     */
    function now() {
        return {
            'line': line,
            'column': column
        };
    }

    /**
     * Location getter.
     *
     * @return {function(): Object}
     */
    function location() {
        var before = now();

        /**
         * Return a `position`.
         *
         * @return {Object}
         */
        return function () {
            return {
                'start': before,
                'end': now()
            };
        };
    }

    position = location();

    while (++offset < valueLength) {
        index = -1;

        if (
            offset === 0 ||
            EXPRESSIONS_WHITE_SPACE.test(value.charAt(offset - 1))
        ) {
            while (++index < length) {
                name = order[index];

                match = expressions[name].exec(value.slice(offset));

                expressions[name].lastIndex = 0;

                if (match) {
                    subposition = location();

                    end = offset;

                    offset += match[0].length;

                    node = augment[name].apply(
                        null, [subposition(), repo].concat(match)
                    );

                    if (node) {
                        if (end !== start) {
                            nodes.push(text(
                                position(), value.slice(start, end)
                            ));

                            position = location();
                        }

                        start = offset;
                        nodes.push(node);
                    }
                }
            }
        }

        if (value.charAt(index) === '\n') {
            line++;
            column = 0;
        }

        column++;
    }

    if (start < valueLength) {
        nodes.push(text(position(), value.slice(start, offset)));
    }

    return nodes;
}

/**
 * Render a SHA relative to a repo.
 *
 * @param {Object} position
 * @param {Object} repo
 * @param {string} $0 - Whole content.
 * @param {Object} $1 - Username.
 * @param {Object} $2 - Project.
 * @param {Object} $3 - SHA.
 * @return {Node?}
 */
augment.repoSHA = function (position, repo, $0, $1, $2, $3) {
    var href;
    var value;

    if (isSHA($3)) {
        href = gh($1, $2) + 'commit/' + $3;
        value = $1 + '/' + $2 + '@' + abbr($3);

        return link(position, href, [text(position, value)]);
    }
};

/**
 * Render a SHA relative to a user.
 *
 * @param {Object} position
 * @param {Object} repo
 * @param {string} $0 - Whole content.
 * @param {Object} $1 - Username.
 * @param {Object} $2 - SHA.
 * @return {Node?}
 */
augment.userSHA = function (position, repo, $0, $1, $2) {
    var href;
    var value;

    if (isSHA($2)) {
        href = gh($1, repo.project) + 'commit/' + $2;
        value = $1 + '@' + abbr($2);

        return link(position, href, [text(position, value)]);
    }
};

/**
 * Render a SHA.
 *
 * @param {Object} position
 * @param {Object} repo
 * @param {string} $0 - Whole content.
 * @param {Object} $1 - SHA.
 * @return {Node?}
 */
augment.sha = function (position, repo, $0, $1) {
    var href;

    if (isSHA($1)) {
        href = gh(repo) + 'commit/' + $1;

        return link(position, href, [text(position, abbr($0))]);
    }
};

/**
 * Render an issue relative to a repo.
 *
 * @param {Object} position
 * @param {Object} repo
 * @param {string} $0 - Whole content.
 * @param {Object} $1 - Username.
 * @param {Object} $2 - Project.
 * @param {Object} $3 - Issue number.
 * @return {Node}
 */
augment.repoIssue = function (position, repo, $0, $1, $2, $3) {
    var href = gh($1, $2) + 'issues/' + $3;

    return link(position, href, [text(position, $0)]);
};

/**
 * Render an issue relative to a user.
 *
 * @param {Object} position
 * @param {Object} repo
 * @param {string} $0 - Whole content.
 * @param {Object} $1 - Username.
 * @param {Object} $2 - Issue number.
 * @return {Node}
 */
augment.userIssue = function (position, repo, $0, $1, $2) {
    var href = gh($1, repo.project) + 'issues/' + $2;

    return link(position, href, [text(position, $0)]);
};

/**
 * Render an issue.
 *
 * @param {Object} position
 * @param {Object} repo
 * @param {string} $0 - Whole content.
 * @param {Object} $1 - Issue number.
 * @return {Node}
 */
augment.issue = function (position, repo, $0, $1) {
    var href = gh(repo) + 'issues/' + $1;

    return link(position, href, [text(position, $0)]);
};

var OVERWRITES = {};

OVERWRITES.mentions = OVERWRITES.mention = 'blog/821';

/**
 * Render a mention.
 *
 * @param {Object} position
 * @param {Object} repo
 * @param {string} $0 - Whole content.
 * @param {Object} $1 - Username.
 * @return {Node}
 */
augment.mention = function (position, repo, $0, $1) {
    var href = gh() + (has.call(OVERWRITES, $1) ? OVERWRITES[$1] : $1);

    return link(position, href, [text(position, $0)]);
};

/**
 * Construct a transformer
 *
 * @param {Object} repo
 * @return {function(node)}
 */
function transformerFactory(repo) {
    /**
     * Adds an example section based on a valid example
     * JavaScript document to a `Usage` section.
     *
     * @param {Node} node
     */
    return function (node) {
        /**
         * Replace a text node with results from `augment`.
         *
         * @param {Node} child
         * @param {number} position
         * @param {Array.<Node>} children
         */
        function replace(child, position, children) {
            splice.apply(children, [position, 1].concat(
                augment(child, repo)
            ));
        }

        var visit;
        var visitAll;

        /**
         * Visit `node`.  Returns zero or more text blocks.
         *
         * @param {Node} child
         */
        visit = function (child, position, children) {
            if (isText(child)) {
                replace(child, position, children);
            } else if ('children' in child && child.type !== 'link') {
                visitAll(child.children);
            }
        };

        /**
         * Visit all `children`.  Returns a single nested
         * array.
         *
         * @param {Array.<Node>} children
         */
        visitAll = function (children) {
            children.map(visit);
        };

        visit(node);
    };
}

/**
 * Attacher.
 *
 * @param {MDAST} _
 * @param {Object?} options
 * @return {function(node)}
 */
function attacher(_, options) {
    var repo = (options || {}).repository;
    var pack;

    if (!repo) {
        try {
            pack = require(require('path').resolve(
                proc.cwd(), 'package.json'
            ));
        } catch (exception) {
            pack = {};
        }

        repo = pack.repository ? pack.repository.url || pack.repository : '';
    }

    repo = EXPRESSIONS_REPO.exec(repo);

    EXPRESSIONS_REPO.lastIndex = 0;

    if (!repo) {
        throw new Error('Missing `repository` field in `options`');
    }

    return transformerFactory({
        'user': repo[1],
        'project': repo[2]
    });
}

/*
 * Expose.
 */

module.exports = attacher;

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"path":undefined}]},{},[1])(1)
});