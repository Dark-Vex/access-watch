const express = require('express')

const { fromJS } = require('immutable')

function create ({name = 'HTTP replay server', port}) {
  const app = express()

  return {
    name: name,
    start: (pipeline) => {
      app.use((req, res, next) => {
        const message = {
          request: {
            time: new Date().toISOString(),
            address: req.headers['x-real-ip'] || req.ip,
            method: req.method,
            url: req.originalUrl || req.url,
            headers: req.headers
          },
          response: {
            status: res.statusCode
          }
        }
        pipeline.success(fromJS(message))
        next()
      })

      app.listen(port, function () {
        console.log('HTTP replay server listening on port %d', port)
      })

      pipeline.status(null, `Listening on http://__HOST__:${port}`)
    }
  }
}

module.exports = {
  create: create
}
