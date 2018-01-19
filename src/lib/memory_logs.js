const config = require('../constants');
const searchLogsArguments = require('../apps/logs_search_arguments_mapping');
const { mapIncludesObject } = require('./util');

const DEFAULT_LIMIT = 50;
const memoryIndexFactory = limit => ({
  limit,
  collection: {},
  total: 0,
  removeOldest() {
    const allTimes = this.getAllIndexTimes();
    if (allTimes.length > 0) {
      const oldestTime = allTimes[allTimes.length - 1];
      this.collection[oldestTime].pop();
      this.total--;
      if (this.collection[oldestTime].length === 0) {
        delete this.collection[oldestTime];
      }
    }
  },
  push(time, log) {
    while (this.total >= this.limit) {
      this.removeOldest();
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
});

const memoryIndex = memoryIndexFactory(config.logs.memory.retention);

const index = log => {
  const time = Math.floor(
    new Date(log.getIn(['request', 'time'])).getTime() / 1000
  );
  memoryIndex.limit = config.logs.memory.retention;
  memoryIndex.push(time, log);
};

const searchLogs = (args = {}) => {
  const { start, end, limit = DEFAULT_LIMIT } = args;
  let searchTimes = memoryIndex.getAllIndexTimes();
  const filterKeys = Object.keys(args).filter(k =>
    Object.keys(searchLogsArguments).includes(k)
  );
  const filterValues = filterKeys.reduce((accumulator, k) => {
    return Object.assign(accumulator, searchLogsArguments[k](args[k]));
  }, {});
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
      timeIndex.filter(log => mapIncludesObject(log, filterValues))
    );
    return answer.length >= limit;
  });
  return Promise.resolve(answer.slice(0, limit).map(l => l.toJS()));
};

module.exports = {
  index,
  searchLogs,
  memoryIndexFactory,
};
