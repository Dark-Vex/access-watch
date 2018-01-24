const { index, searchLogs } = require('../src/plugins/memory-logs');
const { fromJS } = require('immutable');
const generateFakeRequest = require('./logs-generation');
const timePromise = (promise, name) => (...args) => {
  const startTime = new Date().getTime();
  return promise(...args).then(r => {
    const endTime = new Date().getTime();
    console.log(`${name} took: ${endTime - startTime}ms`);
    return r;
  });
};

const requestsPerTime = 10;
const totalTime = 1000;
const TOTAL_REQUESTS = requestsPerTime * totalTime;
const baseTime = new Date().getTime();

const startBuildingRequests = new Date().getTime();
const getTime = delta => new Date(baseTime - 1000 * delta).toISOString();

const fakeRequests = new Array(TOTAL_REQUESTS).fill(0).map((_, i) =>
  fromJS(
    Object.assign(
      { identity: { id: 1 } },
      generateFakeRequest({
        time: getTime(totalTime - Math.floor((i + 1) / requestsPerTime)),
      })
    )
  )
);

console.log(
  `Total time spent building requests: ${new Date().getTime() -
    startBuildingRequests}ms`
);

const startTime = new Date().getTime();
console.log(startTime);
fakeRequests.forEach(index);

const time = new Date().getTime() - startTime;
console.log(`Total spent indexing: ${time}ms`);
timePromise(searchLogs, 'searchLogs')({
  limit: TOTAL_REQUESTS,
  start: Math.floor(baseTime / 1000 - 5),
}).then(res => {
  console.log(`index size: ${res.length}`);
});

timePromise(searchLogs, 'searchLogs full')({
  limit: TOTAL_REQUESTS,
}).then(res => {
  console.log(`index size: ${res.length}`);
});
