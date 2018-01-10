//
// Plugin to discuss with the Access Watch Hub
//

const LRUCache = require('lru-cache')
const axios = require('axios')
const uuid = require('uuid/v4')
const { Map, fromJS, is } = require('immutable')

const { signature } = require('access-watch-sdk')

const { selectKeys } = require('../lib/util')
const config = require('../config/constants')

const client = axios.create({
  baseURL: 'https://api.access.watch/1.2/hub',
  timeout: config.hub.timeout,
  headers: { 'User-Agent': 'Access Watch Hub Plugin' }
})

const cache = new LRUCache(config.hub.cache)

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
      log = log.set('identity', selectKeys(identity, ['id', 'type', 'label']));
      // Add identity objects
      ['address', 'user_agent', 'robot', 'reputation'].forEach(key => {
        if (identity.has(key)) {
          log = log.set(key, identity.get(key))
        }
      })
    }
    return log
  })
}

const cacheFetchFactory = cache => ({ cacheKeyFn, fetchFn }) => item => {
  const key = cacheKeyFn(item)
  if (cache.has(key)) {
    return Promise.resolve(cache.get(key))
  }
  return fetchFn(key, item)
}

const withMaxConcurrentRequests = ({ maxConcurrentRequests, fetchFn, name }) => {
  const currentRequests = {}
  return (...args) => new Promise((resolve, reject) => {
    if (Object.keys(currentRequests).length >= maxConcurrentRequests) {
      console.log(`Max concurrent requests for ${name} batch. Skipping.`)
      resolve()
      return
    }
    const requestId = uuid()
    currentRequests[requestId] = fetchFn(...args)
      .then(r => {
        delete currentRequests[requestId]
        return r
      })
      .catch(err => {
        delete currentRequests[requestId]
        throw err
      })
  })
}

function batchFetch ({ cache, name, batchRequests, buffer, fetchFn }) {
  const batch = Object.keys(buffer).map(key => {
    delete buffer[key]
    return {
      key,
      ...buffer[key]
    }
  })

  if (batch.length > 0) {
    return Promise.resolve()
  }

  return fetchFn(batch)
    .then(response => {
      if (batch.length !== response.length) {
        throw new Error(`${name}: batch requests length mismatch`)
      }
      batch.forEach((batchEntry, i) => {
        const map = fromJS(response[i])
        cache.set(batchEntry.key, map)
        batchEntry.promises.forEach(({ resolve }) => {
          resolve(map.size ? map : null)
        })
      })
    })
    .catch(err => {
      console.error(name, err)
      // Resolving all the requests with an empty response
      batch.forEach(batchEntry => {
        batchEntry.promises.forEach(({ resolve }) => {
          resolve()
        })
      })
    })
}

const batchFetchFactory = ({ maxConcurrentRequests, name, fetchFn, interval, maxBuffer = 25 }) => {
  const buffer = {}
  const batchRequests = {}
  const thisBatchFetch = withMaxConcurrentRequests({
    maxConcurrentRequests,
    name,
    fetchFn: batchFetch.bind(null, { name, fetchFn, batchRequests, buffer })
  })
  setInterval(thisBatchFetch, interval)
  return (key, item) => new Promise((resolve, reject) => {
    const bufferSize = Object.keys(buffer).length
    if (bufferSize >= maxBuffer) {
      console.log(`${name} buffer full. Skipping.`, bufferSize)
      resolve()
      return
    }
    if (!buffer[key]) {
      buffer[key] = { [name]: item, promises: [] }
    }
    buffer[key].promises.push({ resolve, reject })
  })
}

const cacheFetch = cacheFetchFactory(cache)

const identityBatchFetch = batchFetchFactory({
  maxConcurrentRequests: config.hub.identity.maxConcurrentRequests,
  interval: config.hub.identity.batchInterval,
  name: 'identity',
  fetchFn: items => getIdentities(items.map(({ identity }) => identity))
})

const fetchIdentity = cacheFetch({
  cacheKeyFn: identity => signature.getIdentityId(identity.toJS()),
  fetchFn: identityBatchFetch
})

function getIdentities (identities) {
  return client
    .post('/identities', { identities })
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
  const activityBufferCount = activityBuffer.size
  if (activityBufferCount >= 100) {
    console.log('Activity feedback buffer full. Skipping.', activityBufferCount)
    return
  }

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

function batchActivityFeedback () {
  if (activityBuffer.size === 0) {
    return Promise.resolve()
  }

  const activity = activityBuffer.toJS()
  activityBuffer = activityBuffer.clear()

  return client
    .post('/activity', { activity })
    .then(response => {
      if (typeof response.data !== 'object') {
        throw new TypeError('Response not an object')
      }
      if (!response.data.identities || !Array.isArray(response.data.identities)
      ) {
        throw new TypeError('Response identities not an array')
      }
      response.data.identities.forEach(identity => {
        const identityMap = fromJS(identity)
        const cachedMap = cache.get(identity.id)
        if (!is(cachedMap, identityMap)) {
          cache.set(identity.id, identityMap)
        }
      })
    })
    .catch(err => {
      console.error('activity feedback', err)
    })
}

setInterval(withMaxConcurrentRequests({
  maxConcurrentRequests: config.hub.activity.maxConcurrentRequests,
  name: 'activity',
  fetchFn: batchActivityFeedback
}), config.hub.activity.batchInterval)

module.exports = {
  augment
}
