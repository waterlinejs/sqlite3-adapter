# Waterline SQLite3 Adapter

[![NPM version][npm-image]][npm-url]
[![Build status][ci-image]][ci-url]
[![Dependency Status][daviddm-image]][daviddm-url]
[![Code Climate][codeclimate-image]][codeclimate-url]

A [Waterline](https://github.com/waterlinejs) adapter for
[SQLite3](https://www.sqlite.org/).

## Features
- Fully compatible with SQLite3
- Supports Waterline Associations
- Uses [knex.js](http://knexjs.org/) for query building
- Written in ES6

## Compatibility
- [Waterline](http://waterline.js.org) v0.10 and newer
- [Trails](http://trailsjs.io) v1.0 and newer
- Node 4 or newer

## Install

```sh
$ npm install waterline-sqlite3 --save
```

## Configuration

#### `config/connections.js`

```js
module.exports.connections = {
  sqlitedb: {
    /**
     * Database instance type. Specify whether to store the database on disk
     * or in memory.
     */
    adapter: 'waterline-sqlite3', // or 'memory'

    /**
     * Location of file if type='disk'
     */
    filename: './tmp/db.sqlite',

    /**
     * Set to true to output SQL queries
     */
    debug: false
  }
}
```

## License
MIT

## Maintained By
[<img src='http://i.imgur.com/Y03Jgmf.png' height='64px'>](http://langa.io)


[npm-image]: https://img.shields.io/npm/v/waterline-sqlite3.svg?style=flat-square
[npm-url]: https://npmjs.org/package/waterline-sqlite3
[ci-image]: https://img.shields.io/travis/waterlinejs/sqlite3-adapter/master.svg?style=flat-square
[ci-url]: https://travis-ci.org/waterlinejs/sqlite3-adapter
[daviddm-image]: http://img.shields.io/david/waterlinejs/sqlite3-adapter.svg?style=flat-square
[daviddm-url]: https://david-dm.org/waterlinejs/sqlite3-adapter
[codeclimate-image]: https://img.shields.io/codeclimate/github/waterlinejs/sqlite3-adapter.svg?style=flat-square
[codeclimate-url]: https://codeclimate.com/github/waterlinejs/sqlite3-adapter
