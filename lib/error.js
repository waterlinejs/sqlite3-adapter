import _ from 'lodash'

const Errors = {
  SQLITE_CONSTRAINT (sqliteError) {
    return {
      code: 'E_UNIQUE',
      message: sqliteError.message,
      invalidAttributes: [ ]
    }
  }
}

const AdapterError = {
  wrap(cb, txn) {
    return function (sqliteError) {
      let errorWrapper = Errors[sqliteError.code] || sqliteError
      let error = sqliteError

      if (_.isFunction(errorWrapper)) {
        error = errorWrapper(sqliteError)
      }

      _.isFunction(cb) && cb(error)
    }
  }
}

export default AdapterError
