// import the framework
const app = require('./lib/app')
const pipeline = require('./lib/pipeline')
const database = require('./lib/database')

// configure the application
require('./config')

// start the application
function start () {
  pipeline.start()
  app.start()
}

// stop the application
function stop () {
  database.close()
  process.exit()
}

start()

process.on('SIGINT', stop)

// Report Memory Usage

const statsd = require('./lib/statsd')

setInterval(() => {
  const memoryUsage = process.memoryUsage()
  Object.keys(memoryUsage).forEach(key => {
    statsd.set(`process.memory.${key}`, memoryUsage[key])
  })
}, 1000)
