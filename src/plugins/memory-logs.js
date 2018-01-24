const omit = require('lodash.omit');
const { Map, List } = require('immutable');
const config = require('../constants');
const { logIsAugmented } = require('../lib/util');

const logMatchesQuery = (log, query) =>
  Object.keys(query).reduce((bool, key) => {
    const queryValues = query[key].split(',');
    return bool && queryValues.indexOf(log.getIn(key.split('.'))) !== -1;
  }, true);

const DEFAULT_LIMIT = 50;
const memoryIndexFactory = limit => ({
  limit,
  collection: new Map(),
  total: 0,
  removeOldest() {
    const oldestIndex = this.getOldestIndex();
    if (oldestIndex) {
      const newIndex = this.collection.get(oldestIndex).pop();
      this.total--;
      if (newIndex.size === 0) {
        this.collection = this.collection.delete(oldestIndex);
      } else {
        this.collection = this.collection.set(oldestIndex, newIndex);
      }
    }
  },
  push(time, log) {
    while (this.total >= this.limit && this.total !== 0) {
      if (time < this.getOldestIndex()) {
        return;
      }
      this.removeOldest();
    }
    if (this.limit === 0) {
      return;
    }
    if (!this.collection.has(time)) {
      this.collection = this.collection.set(time, new List().push(log));
    } else {
      const newIndex = this.collection.get(time).unshift(log);
      this.collection = this.collection.set(time, newIndex);
    }
    this.total++;
  },
  get(time) {
    return this.collection.get(time);
  },
  getAllIndexTimes() {
    return this.collection
      .keySeq()
      .toArray()
      .sort((a, b) => b - a);
  },
  getOldestIndex() {
    const indexes = this.getAllIndexTimes();
    return indexes[indexes.length - 1];
  },
});

const memoryIndex = memoryIndexFactory(config.logs.memory.retention);

function index(log) {
  if (logIsAugmented(log)) {
    const time = Math.floor(
      new Date(log.getIn(['request', 'time'])).getTime() / 1000
    );
    memoryIndex.limit = config.logs.memory.retention;
    memoryIndex.push(time, log);
  }
}

function searchLogs(args = {}) {
  const { start, end, limit = DEFAULT_LIMIT } = args;
  let searchTimes = memoryIndex.getAllIndexTimes();
  const filters = omit(args, ['start', 'end', 'limit']);
  let answer = [];
  if (start) {
    searchTimes = searchTimes.filter(t => t >= start);
  }
  if (end) {
    searchTimes = searchTimes.filter(t => t <= end);
  }
  searchTimes.some(t => {
    const timeIndex = memoryIndex.get(t);
    answer = answer.concat(
      timeIndex.filter(log => logMatchesQuery(log, filters)).toArray()
    );
    return answer.length >= limit;
  });
  return Promise.resolve(answer.slice(0, limit).map(l => l.toJS()));
}

module.exports = {
  index,
  searchLogs,
  memoryIndexFactory,
};
