//
// Plugin to discuss with the Access Watch Hub
//

const LRUCache = require('lru-cache')
const axios = require('axios')
const { Map, fromJS, is } = require('immutable')

const { signature } = require('access-watch-sdk')

const statsd = require('../lib/statsd')

const { selectKeys } = require('../lib/util')

const client = axios.create({
  baseURL: 'https://api.access.watch/1.2/hub',
  timeout: 1000,
  headers: {'User-Agent': 'Access Watch Hub Plugin'}
})

const cache = new LRUCache({max: 10000, maxAge: 3600 * 1000})

let buffer = {}

let batchScheduled

function augment (log) {
  // Share activity metrics and get updates
  activityFeedback(log)
  // Fetch identity and augment log (promise based)
  return fetchIdentity(Map({
    address: log.getIn(['address', 'value'], log.getIn(['request', 'address'])),
    headers: log.getIn(['request', 'headers']),
    captured_headers: log.getIn(['request', 'captured_headers'])
  })).then(identity => {
    if (identity) {
      // Add identity properties
      log = log.set('identity', selectKeys(identity, ['id', 'type', 'label']))
      // Add identity objects
      ;['address', 'user_agent', 'robot', 'reputation'].forEach(key => {
        if (identity.has(key)) {
          log = log.set(key, identity.get(key))
        }
      })
    }
    return log
  })
}

function fetchIdentity (identity) {
  statsd.set(`hub.cache.itemCount`, cache.itemCount)
  statsd.set(`hub.cache.length`, cache.length)
  let key = cacheKey(identity)
  if (cache.has(key)) {
    return Promise.resolve(cache.get(key))
  } else {
    return fetchIdentityPromise(key, identity)
  }
}

function cacheKey (identity) {
  return signature.getIdentityId(identity.toJS())
}

function fetchIdentityPromise (key, identity) {
  return new Promise((resolve, reject) => {
    if (Object.keys(buffer).length >= 100) {
      console.log('Buffer Full. Skipping augmentation.')
      resolve()
      return
    }
    if (!buffer[key]) {
      buffer[key] = {identity, promises: []}
    }
    buffer[key].promises.push({resolve, reject})
    if (!batchScheduled) {
      batchScheduled = setTimeout(fetchIdentityBatch, 333)
    }
  })
}

function fetchIdentityBatch () {
  batchScheduled = null

  let batch = []

  // Move entries from the buffer to the batch
  Object.keys(buffer).forEach(key => {
    batch.push(Object.assign({key}, buffer[key]))
    delete buffer[key]
  })

  if (batch.length === 0) {
    return
  }

  const requestIdentities = batch.map(batchEntry => batchEntry.identity)

  statsd.set('hub.identities.request.length', requestIdentities.length)
  statsd.increment('hub.identities.request.total', requestIdentities.length)

  const start = process.hrtime()

  getIdentities(requestIdentities)
    .then(responseIdentities => {
      if (batch.length !== responseIdentities.length) {
        throw new Error('Length mismatch')
      }
      statsd.increment('hub.identities.response.success')
      statsd.timing('hub.identities.response.success', process.hrtime(start)[1] / 1000000)
      batch.forEach((batchEntry, i) => {
        const identityMap = fromJS(responseIdentities[i])
        cache.set(batchEntry.key, identityMap)
        batchEntry.promises.forEach(({resolve}) => {
          resolve(identityMap.size ? identityMap : null)
        })
      })
    })
    .catch(() => {
      statsd.increment('hub.identities.response.exception')
      statsd.timing('hub.identities.response.exception', process.hrtime(start)[1] / 1000000)
      // Resolving all the requests with an empty response
      batch.forEach(batchEntry => {
        batchEntry.promises.forEach(({resolve}) => {
          resolve()
        })
      })
    })
}

function getIdentities (identities) {
  return client
    .post('/identities', {identities})
    .then(response => {
      if (typeof response.data !== 'object') {
        throw new TypeError('Response not an object')
      }
      if (!response.data.identities || !Array.isArray(response.data.identities)) {
        throw new TypeError('Response identities not an array')
      }
      return response.data.identities
    })
}

let activityBuffer = Map()

const types = {
  '/robots.txt': 'robot',
  '/favicon.ico': 'favicon',
  '.png': 'img',
  '.gif': 'img',
  '.jpg': 'img',
  '.svg': 'svg',
  '.css': 'css',
  '.js': 'js'
}

function detectType (url) {
  let type = 'mixed'

  Object.keys(types).some(key => {
    if (url.slice(key.length * -1) === key) {
      type = types[key]
      return true
    }
  })

  return type
}

function activityFeedback (log) {
  // Get identity id
  let identityId = log.getIn(['identity', 'id'])
  if (!identityId) {
    identityId = signature.getIdentityId({
      address: log.getIn(['address', 'value'], log.getIn(['request', 'address'])),
      headers: log.getIn(['request', 'headers']).toJS()
    })
  }

  // Get host
  let host = log.getIn(['request', 'headers', 'host'])
  if (!host) {
    return
  }
  if (host.indexOf(':') !== -1) {
    [host] = host.split(':')
  }

  const values = [
    log.getIn(['request', 'method']).toLowerCase(),
    detectType(log.getIn(['request', 'url']))
  ]
  values.forEach(value => {
    if (value) {
      activityBuffer = activityBuffer.updateIn([identityId, host, value], 0, n => n + 1)
    }
  })
}

function batchIdentityFeedback () {
  if (activityBuffer.size > 0) {
    const activity = activityBuffer.toJS()
    activityBuffer = activityBuffer.clear()

    const start = process.hrtime()

    client
      .post('/activity', {activity})
      .then(response => {
        if (typeof response.data !== 'object') {
          throw new TypeError('Response not an object')
        }
        if (!response.data.identities || !Array.isArray(response.data.identities)) {
          throw new TypeError('Response identities not an array')
        }
        statsd.increment('hub.activity.response.success')
        statsd.timing('hub.activity.response.success', process.hrtime(start)[1] / 1000000)
        response.data.identities.forEach(identity => {
          const identityMap = fromJS(identity)
          const cachedMap = cache.get(identity.id)
          if (!is(cachedMap, identityMap)) {
            cache.set(identity.id, identityMap)
          }
        })
      })
      .catch(err => {
        statsd.increment('hub.activity.response.exception')
        statsd.timing('hub.activity.response.exception', process.hrtime(start)[1] / 1000000)
        console.log('activity feedback', err)
      })
  }
}

setInterval(batchIdentityFeedback, 60 * 1000)

module.exports = {
  augment
}
