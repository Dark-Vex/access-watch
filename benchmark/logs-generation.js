const requestsData = require('./fake_requests_data');
const addresses = require('./addresses');

const MAX_COOKIE_BLOAT_SIZE = 1000;
const MAX_COOKIES = 20;

const getRandomMax = max => Math.floor(Math.random() * max);

function getBloat(bloatSize) {
  const getRandomChar = () => String.fromCharCode(getRandomMax(65535));
  return Array(bloatSize)
    .fill(0)
    .map(getRandomChar)
    .join('');
}

function getRandomCookies() {
  const cookiesSize = getRandomMax(MAX_COOKIES);
  return Array(cookiesSize)
    .fill(0)
    .reduce(() => `${getBloat(15)}: ${getBloat(MAX_COOKIE_BLOAT_SIZE)};`, '');
}

function getRandomAddress() {
  getRandomInArray(addresses);
  return Array(4)
    .fill(0)
    .map(() => getRandomMax(255))
    .join('.');
}

function getRandomInArray(arr) {
  return arr[getRandomMax(arr.length)];
}

function generateRandomFromData(data) {
  return Object.keys(data).reduce(
    (acc, k) =>
      Object.assign(
        {
          [k]: Array.isArray(data[k])
            ? getRandomInArray(data[k])
            : generateRandomFromData(data[k]),
        },
        acc
      ),
    {}
  );
}

function generateFakeRequest({ time = new Date().toISOString() } = {}) {
  const randomRequest = generateRandomFromData(requestsData);
  randomRequest.request.time = time;
  randomRequest.request.headers.cookies = getRandomCookies();
  randomRequest.request.address = getRandomAddress();
  return randomRequest;
}

module.exports = generateFakeRequest;
