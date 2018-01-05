const StatsD = require('node-statsd')

// Enable appmetrics statsd integration
require('appmetrics-statsd').StatsD()

module.exports = new StatsD()
