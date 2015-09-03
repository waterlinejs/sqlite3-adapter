import fs from 'fs'
import path from 'path'
import sqlite3 from 'sqlite3'
import Knex from 'knex'
import _ from 'lodash'
import WaterlineSequel from 'waterline-sequel'
import WaterlineError from 'waterline-errors'

//import AdapterError from './error'
import Util from './util'
//import SQL from './sql'

const Adapter = {

  identity: 'waterline-sqlite3',

  wlSqlOptions: {
    parameterized: true,
    caseSensitive: true,
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
    debug: true,
    mode: sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE,

    filename: 'waterlinedb.sqlite'
  },

  /**
   * This method runs when a connection is initially registered
   * at server-start-time. This is the only required method.
   *
   * @param  {[type]}   connection [description]
   * @param  {[type]}   collection [description]
   * @param  {Function} cb         [description]
   * @return {[type]}              [description]
   */
  registerConnection (connection, collections, cb) {
    if (!connection.identity) {
      return cb(WaterlineError.adapter.IdentityMissing)
    }
    if (this.connections.get(connection.identity)) {
      return cb(WaterlineError.adapter.IdentityDuplicate)
    }

    _.defaults(connection, this.defaults)

    let cxn = {
      identity: connection.identity,
      schema: this.buildSchema(connection, collections),
      collections: collections,
      //extant: fs.existsSync(connection.filename),
      knex: Knex({
        client: 'sqlite3',
        connection: {
          filename: connection.filename
        },
        debug: process.env.WATERLINE_DEBUG_SQL || connection.debug
      })
    }
    this.connections.set(connection.identity, cxn)

    cb()
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
   * @param connectionName
   * @param tableName
   */
  describe (connectionName, tableName, cb) {
    let cxn = this.connections.get(connectionName)

    // https://github.com/AndrewJo/sails-sqlite3/blob/master/lib/adapter.js#L156
    cb()

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
      .then(() => {
        _.isFunction(cb) && cb()
      })
      .catch(cb)
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
      .catch(cb)
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
      .catch(cb)
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

    console.log('query', query.toString())

    return query.then(rows => {
        let result = _.map(rows, row => {
          return Util.castSqlValues(row, cxn.collections[tableName])
        })
        console.log('query result', result)
        _.isFunction(cb) && cb(null, result)
        return result
      })
      .catch(cb)
  },

  create (connectionName, tableName, record, cb) {
    let cxn = this.connections.get(connectionName)
    let pk = this.getPrimaryKey(cxn, tableName)

    return cxn.knex.transaction(txn => {
      return txn.insert(Util.castRecord(record))
      .into(tableName)
      .then(([ id ]) => {
        return txn.select().from(tableName).where(pk, id)
      })
      .then(([ created ]) => {
        let record = Util.castSqlValues(created, cxn.collections[tableName])
        cb(null, record)
        return record
      })
    })
    .catch(cb)
  },

  find (connectionName, tableName, options, cb) {
    let cxn = this.connections.get(connectionName)
    let wlsql = new WaterlineSequel(cxn.schema, this.wlSqlOptions)

    return new Promise((resolve, reject) => {
        resolve(wlsql.find(tableName, options))
      })
      .then(({ query: [query], values: [values] }) => {
        return this.query(connectionName, tableName, query, values)
      })
      .then(rows => {
        _.isFunction(cb) && cb(null, rows)
        return rows
      })
      .catch(cb)
  },

  /**
   * Update a record
   */
  update (connectionName, tableName, options, data, cb) {
    let cxn = this.connections.get(connectionName)
    let wlsql = new WaterlineSequel(cxn.schema, this.wlSqlOptions)

    return new Promise((resolve, reject) => {
        resolve(wlsql.update(tableName, options, data))
      })
      .then(({ query: _query, values }) => {
        let [ $, setClause ] = _query.split('SET')
        let query = `UPDATE "${tableName}" SET ` + setClause
        return this.query(connectionName, tableName, query, values)
      })
      .then(() => {
        return this.find(connectionName, tableName, options)
      })
      .then(rows => {
        _.isFunction(cb) && cb(null, rows)
        return rows
      })
      .catch(cb)
  },

  /**
   * Destroy a record
   */
  destroy (connectionName, tableName, options, cb) {
    let cxn = this.connections.get(connectionName)
    let wlsql = new WaterlineSequel(cxn.schema, this.wlSqlOptions)
    let found

    console.log('destroy()')

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
      .catch(cb)
  },

  /**
   * Count the number of records
   */
  count (connectionName, tableName, options, cb) {
    let cxn = this.connections.get(connectionName)
    let wlsql = new WaterlineSequel(cxn.schema, this.wlSqlOptions)

    return new Promise((resolve, reject) => {
        resolve(wlsql.count(tableName, options))
      })
      .then(({ query: [query], values: [values] }) => {
        return this.query(connectionName, tableName, query, values)
      })
      .then(row => {
        console.log('count', row)
        let count = Number(row.count)
        _.isFunction(cb) && cb(null, count)
        return count
      })
      .catch(cb)
  },

  /**
   * Get the primary key column of a table
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

    for (let cxn of connections) {
      if (!cxn) continue

      cxn.knex.destroy()
      this.connections.delete(cxn.identity)
    }
    cb()
  }
}

_.bindAll(Adapter)
export default Adapter
