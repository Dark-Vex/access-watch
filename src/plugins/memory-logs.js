const omit = require('lodash.omit');
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
  collection: {},
  total: 0,
  removeOldest() {
    const oldestIndex = this.getOldestIndex();
    if (oldestIndex) {
      this.collection[oldestIndex].pop();
      this.total--;
      if (this.collection[oldestIndex].length === 0) {
        delete this.collection[oldestIndex];
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
    if (!this.collection[time]) {
      this.collection[time] = [];
    }
    this.collection[time].unshift(log);
    this.total++;
  },
  get(time) {
    return this.collection[time];
  },
  getAllIndexTimes() {
    return Object.keys(this.collection)
      .map(k => parseInt(k, 10))
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
      timeIndex.filter(log => logMatchesQuery(log, filters))
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
