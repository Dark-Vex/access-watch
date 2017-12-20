const express = require('express')
const expressWs = require('express-ws')
const bodyParser = require('body-parser')

const app = express()

expressWs(app)

app.use(bodyParser.json())

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Access-Control-Allow-Methods', 'GET')
  res.header('Access-Control-Allow-Headers', 'Authorization')
  next()
})

app.set('port', process.env.PORT || 3000)

app.start = () => {
  app.listen(app.get('port'), function () {
    console.log('HTTP and Websocket Server listening on port %d', app.get('port'))
  })
}

module.exports = app
