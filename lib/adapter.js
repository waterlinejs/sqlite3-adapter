import fs from 'fs'
import sqlite3 from 'sqlite3'
import Knex from 'knex'
import _ from 'lodash'
import WaterlineSequel from 'waterline-sequel'
import WaterlineError from 'waterline-errors'
import WaterlineCursor from 'waterline-cursor'

import Util from './util'
import AdapterError from './error'

const Adapter = {

  identity: 'waterline-sqlite3',

  wlSqlOptions: {
    parameterized: true,
    caseSensitive: false,
    escapeCharacter: '"',
    wlNext: false,
    casting: true,
    canReturnValues: false,
    escapeInserts: true,
    declareDeleteAlias: false
  },

  /**
   * Local connections store
   */
  connections: new Map(),

  pkFormat: 'integer',
  syncable: true,

  /**
   * Adapter default configuration
   */
  defaults: {
    schema: true,
    debug: false,
    type: 'disk',
    filename: '.tmp/db.sqlite',
  },

  /**
   * This method runs when a connection is initially registered
   * at server-start-time. This is the only required method.
   *
   * @param  {[type]}   connection
   * @param  {[type]}   collection
   * @param  {Function} cb
   * @return {[type]}
   */
  registerConnection (connection, collections, cb) {
    if (!connection.identity) {
      return cb(WaterlineError.adapter.IdentityMissing)
    }
    if (this.connections.get(connection.identity)) {
      return cb(WaterlineError.adapter.IdentityDuplicate)
    }

    _.defaults(connection, this.defaults)

    let filename = connection.filename
    if (connection.type == 'memory') {
      if (!_.isEmpty(filename) && filename != ':memory:' && filename != this.defaults.filename) {
        console.error(`
          WARNING:
          The connection config for the sqlite3 connection ${connection.identity}
          specifies the filename "${filename}" but specifies type="memory". The
          file will not be used, and the data will not be persistent.
        `)
      }
      filename = ':memory:'
    }

    fs.mkdir('.tmp', () => {
      this.connections.set(connection.identity, {
        identity: connection.identity,
        schema: this.buildSchema(connection, collections),
        collections: collections,
        knex: Knex({
          client: 'sqlite3',
          connection: {
            filename: '.tmp/' + connection.identity + '.sqlite'
          },
          debug: process.env.WATERLINE_DEBUG_SQL || connection.debug
        })
      })
      cb()
    })
  },

  /**
   * Construct the waterline schema for the given connection.
   *
   * @param connection
   * @param collections[]
   */
  buildSchema (connection, collections) {
    return _.chain(collections)
      .map((model, modelName) => {
        let definition = _.get(model, [ 'waterline', 'schema', model.identity ])
        return _.defaults(definition, {
          attributes: { },
          tableName: modelName
        })
      })
      .indexBy('tableName')
      .value()
  },

  /**
   * Describe a table. List all columns and their properties.
   *
   * @see http://www.sqlite.org/pragma.html#pragma_table_info
   * @see http://www.sqlite.org/faq.html#q7
   * @see https://github.com/AndrewJo/sails-sqlite3/blob/master/lib/adapter.js#L156
   *
   * @param connectionName
   * @param tableName
   */
  describe (connectionName, tableName, cb) {
    let cxn = this.connections.get(connectionName)

    return Promise.all([
        cxn.knex.raw(`pragma table_info("${tableName}")`),
        cxn.knex.raw(`pragma index_list("${tableName}")`)
      ])
      .then(([ tableInfo = [ ], indexList = [ ] ]) => {
        return Promise.all(indexList.map(index => {
            return cxn.knex.raw(`pragma index_info("${index.name}")`)
              .then(([ indexInfo = { } ]) => {
                let indexResult = _.extend(indexInfo, index)
                return indexResult
              })
          }))
          .then(indexes => {
            return Util.transformTableInfo(tableInfo, _.flatten(indexes))
          })
      })
      .then(result => {
        if (_.isEmpty(result)) return cb()

        _.isFunction(cb) && cb(null, result)
        return result
      })
      .catch(AdapterError.wrap(cb))
  },

  /**
   * Drop a table
   */
  drop (connectionName, tableName, relations = [ ], cb = relations) {
    let cxn = Adapter.connections.get(connectionName)

    return cxn.knex.schema.dropTableIfExists(tableName)
      .then(result => {
        _.isFunction(cb) && cb()
      })
      .catch(AdapterError.wrap(cb))
  },

  /**
   * Create a new table
   *
   * @param connectionName
   * @param tableName
   * @param definition - the waterline schema definition for this model
   * @param cb
   */
  define (connectionName, tableName, definition, cb) {
    let cxn = this.connections.get(connectionName)

    return cxn.knex.schema
      .createTable(tableName, table => {
        _.each(definition, (definition, attributeName) => {
          let newColumn = Util.toKnexColumn(table, attributeName, definition)
          Util.applyColumnConstraints(newColumn, definition)
        })
        Util.applyTableConstraints(table, definition)
      })
      .then(result => {
        _.isFunction(cb) && cb()
      })
      .catch(AdapterError.wrap(cb))
  },

  /**
   * Add a column to a table
   */
  addAttribute (connectionName, tableName, attributeName, definition, cb) {
    let cxn = this.connections.get(connectionName)

    return cxn.knex.schema
      .table(tableName, table => {
        let newColumn = Util.toKnexColumn(table, attributeName, definition)
        return Util.applyColumnConstraints(newColumn, definition)
      })
      .then(() => {
        _.isFunction(cb) && cb()
      })
      .catch(AdapterError.wrap(cb))
  },

  /**
   * Remove a column from a table
   */
  removeAttribute (connectionName, tableName, attributeName, cb) {
    let cxn = this.connections.get(connectionName)

    return cxn.knex.schema
      .table(tableName, table => {
        table.dropColumn(attributeName)
      })
      .then(result => {
        _.isFunction(cb) && cb(null, result)
        return result
      })
      .catch(AdapterError.wrap(cb))
  },

  /**
   * Perform a direct SQL query on the database
   *
   * @param connectionName
   * @param tableName
   * @param queryString
   * @param data
   */
  query (connectionName, tableName, queryString, args = [ ], cb = args) {
    let cxn = this.connections.get(connectionName)
    let query = cxn.knex.raw(Util.toKnexRawQuery(queryString), Util.castValues(args))

    return query
      .then(rows => {
        let result = _.map(rows, row => {
          return Util.castSqlValues(row, cxn.collections[tableName])
        })
        _.isFunction(cb) && cb(null, result)
        return result
      })
  },

  /**
   * Create a new record
   *
   * @param connectionName {String}
   * @param tableName {String}
   * @param record {Object}
   * @param cb {Function}
   */
  create (connectionName, tableName, record, cb) {
    let cxn = this.connections.get(connectionName)
    let pk = this.getPrimaryKey(cxn, tableName)

    return cxn.knex.transaction(txn => {
      return txn.insert(Util.castRecord(record))
        .into(tableName)
        .then(([ rowid ]) => {
          return txn.select().from(tableName).where('rowid', rowid)
        })
        .then(([ created ]) => {
          let record = Util.castSqlValues(created, cxn.collections[tableName])
          _.isFunction(cb) && cb(null, record)
          return record
        })
        .catch(AdapterError.wrap(cb))
    })
  },

  /**
   * Find records
   *
   * @param connectionName {String}
   * @param tableName {String}
   * @param options {Object}
   * @param cb {Function}
   */
  find (connectionName, tableName, options, cb) {
    let cxn = this.connections.get(connectionName)
    let wlsql = new WaterlineSequel(cxn.schema, this.wlSqlOptions)

    if (options.select && !options.select.length) {
      delete options.select
    }

    return new Promise((resolve, reject) => {
        resolve(wlsql.find(tableName, options))
      })
      .then(({ query: [query], values: [values] }) => {
        return this.query(connectionName, tableName, query, values)
      })
      .then((rows = [ ]) => {
        _.isFunction(cb) && cb(null, rows)
        return rows
      })
      .catch(AdapterError.wrap(cb))
  },

  /**
   * Update a record
   *
   * @param connectionName {String}
   * @param tableName {String}
   * @param options {Object}
   * @param data {Object}
   * @param cb {Function}
   */
  update (connectionName, tableName, options, data, cb) {
    let cxn = this.connections.get(connectionName)
    let wlsql = new WaterlineSequel(cxn.schema, this.wlSqlOptions)
    let pk = this.getPrimaryKey(cxn, tableName)
    let updateRows

    return cxn.knex.transaction(txn => {
      return new Promise((resolve, reject) => {
          let wlsql = new WaterlineSequel(cxn.schema, this.wlSqlOptions)
          resolve(wlsql.simpleWhere(tableName, _.pick(options, 'where')))
        })
        .then(({ query: where, values }) => {
          let [ $, whereClause ] = where.split('WHERE')

          return txn
            .select('rowid')
            .from(tableName)
            .whereRaw(txn.raw(Util.toKnexRawQuery(whereClause), values))
        })
        .then(rows => {
          updateRows = _.compact(_.pluck(rows, pk))
          // TODO cleanup updateRows
          if (updateRows.length === 0) {
            updateRows = _.compact(_.pluck(rows, 'rowid'))
          }
          let wlsql = new WaterlineSequel(cxn.schema, this.wlSqlOptions)
          return wlsql.update(tableName, options, data)
        })
        .then(({ query: _query, values }) => {
          let [ $, setClause ] = _query.split('SET')
          let query = `UPDATE "${tableName}" SET ` + setClause

          return txn.raw(Util.toKnexRawQuery(query), Util.castValues(values))
        })
        .then(() => {
          return txn
            .select()
            .from(tableName)
            .whereIn('rowid', updateRows)
        })
      })
      .then(rows => {
        let result = _.map(rows, row => {
          return Util.castSqlValues(row, cxn.collections[tableName])
        })
        _.isFunction(cb) && cb(null, result)
      })
      .catch(AdapterError.wrap(cb))
  },

  /**
   * Destroy a record
   *
   * @param connectionName {String}
   * @param tableName {String}
   * @param options {Object}
   * @param cb {Function}
   */
  destroy (connectionName, tableName, options, cb) {
    let cxn = this.connections.get(connectionName)
    let wlsql = new WaterlineSequel(cxn.schema, this.wlSqlOptions)
    let found

    return this.find(connectionName, tableName, options)
      .then(_found => {
        found = _found
        return wlsql.simpleWhere(tableName, _.pick(options, 'where'))
      })
      .then(({ query: where, values }) => {
        let query = `DELETE FROM "${tableName}" ` + where
        return this.query(connectionName, tableName, query, values)
      })
      .then(rows => {
        _.isFunction(cb) && cb(null, found)
        return found
      })
      .catch(AdapterError.wrap(cb))
  },

  /**
   * Count the number of records
   *
   * @param connectionName {String}
   * @param tableName {String}
   * @param options {Object}
   * @param cb {Function}
   */
  count (connectionName, tableName, options, cb) {
    let cxn = this.connections.get(connectionName)
    let wlsql = new WaterlineSequel(cxn.schema, this.wlSqlOptions)

    return new Promise((resolve, reject) => {
        resolve(wlsql.count(tableName, options))
      })
      .then(({ query: [_query], values: [values] }) => {
        let [ query, asClause ] = _query.split('AS')
        return this.query(connectionName, tableName, query.trim(), values)
      })
      .then(([ row ]) => {
        let count = Number(row.count)
        _.isFunction(cb) && cb(null, count)
        return count
      })
      .catch(AdapterError.wrap(cb))
  },

  /**
   * Populate record associations
   *
   * @param connectionName {String}
   * @param tableName {String}
   * @param options {Object}
   * @param cb {Function}
   */
  join (connectionName, tableName, options, cb) {
    let cxn = this.connections.get(connectionName)

    WaterlineCursor({
      instructions: options,
      parentCollection: tableName,

      $find (tableName, criteria, next) {
        return Adapter.find(connectionName, tableName, criteria, next)
      },

      $getPK (tableName) {
        if (!tableName) return
        return Adapter.getPrimaryKey(cxn, tableName)
      }

    }, cb)
  },

  /**
   * Get the primary key column of a table
   *
   * @param cxn
   * @param tableName
   */
  getPrimaryKey ({ collections }, tableName) {
    let definition = collections[tableName].definition

    if (!definition._pk) {
      let pk = _.findKey(definition, (attr, name) => {
        return attr.primaryKey === true
      })
      definition._pk = pk || 'id'
    }

    return definition._pk
  },

  /**
   * Fired when a model is unregistered, typically when the server
   * is killed. Useful for tearing-down remaining open connections,
   * etc.
   *
   * @param  {Function} cb [description]
   * @return {[type]}      [description]
   */
  teardown (conn, cb = conn) {
    let connections = conn ? [ this.connections.get(conn) ] : this.connections.values()
    let promises = [ ]

    for (let cxn of connections) {
      if (!cxn) continue

      promises.push(new Promise(resolve => {
        cxn.knex.destroy(resolve)
        this.connections.delete(cxn.identity)
      }))
    }

    return Promise.all(promises)
      .then(() => cb())
      .catch(cb)
  }
}

_.bindAll(Adapter)
export default Adapter
