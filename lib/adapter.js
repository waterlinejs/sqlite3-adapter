import fs from 'fs'
import path from 'path'
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
    canReturnValues: true,
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

    return cxn.knex(tableName).columnInfo()
      .then(columnInfo => {
        if (_.isEmpty(columnInfo)) {
          return cb()
        }

        return this.query(connectionName, tableName, SQL.indexes, [ tableName ])
          .then(({ rows }) => {
            _.merge(columnInfo, _.indexBy(camelize(rows), 'columnName'))
            _.isFunction(cb) && cb(null, columnInfo)
          })
      })
      .catch(cb)
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
  query (connectionName, tableName, queryString, _args, _cb) {
    let cxn = this.connections.get(connectionName)
    let args = null
    let cb = _cb

    if (_.isFunction(_args)) {
      cb = _args
    }
    else {
      args = _args
    }

    let query = cxn.knex.raw(Util.toKnexRawQuery(queryString), Util.castValues(args))

    return query.then((result = { }) => {
        _.isFunction(cb) && cb(null, result)
        return result
      })
      .catch(cb)
  },

  create (connectionName, tableName, record, cb) {
    let cxn = this.connections.get(connectionName)
    let pk = this.getPrimaryKey(cxn, tableName)

    return cxn.knex(tableName)
      .insert(record)
      .then(([ id ]) => {
        return cxn.knex(tableName).select().where(pk, id)
      })
      .then(([ created ]) => {
        let record = Util.castSqlValues(created, cxn.collections[tableName])
        console.log('create() created', record)
        cb(null, record)
        return created
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
      .then(({ rows }) => {
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

    return new Promise((resolve, reject) => {
        resolve(wlsql.destroy(tableName, options))
      })
      .then(({ query, values }) => {
        return this.query(connectionName, tableName, query, values)
      })
      .then(({ rows }) => {
        cb(null, rows)
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
      .then(({ rows: [row] }) => {
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
