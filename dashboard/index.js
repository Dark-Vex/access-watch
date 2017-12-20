const path = require('path')
const express = require('express')
const expressWs = require('express-ws')
const uuid = require('uuid/v4')
const { Map } = require('immutable')

/* Dashboard and Assets */

const app = express()

expressWs(app)

app.set('view engine', 'ejs')

app.get('/', (req, res) => res.redirect('/dashboard'))

app.use('/dashboard', express.static(path.join(__dirname, 'static')))

app.get('/dashboard', (req, res) => {
  const host = req.headers.host
  const baseUrl = req.baseUrl
  const apiBaseUrl = `http://${host}${baseUrl}`
  const websocket = `ws://${host}${baseUrl}`
  const index = path.join(__dirname, 'views', 'index.ejs')
  res.render(index, {apiBaseUrl, websocket})
})

/* Websocket */

const { stream } = require('./pipeline')

function websocket (endpoint, stream) {
  let clients = Map()

  app.ws(endpoint, function (ws, req) {
    const clientId = uuid()
    clients = clients.set(clientId, ws)
    ws.on('close', () => { clients = clients.delete(clientId) })
  })

  stream.map(log => {
    clients.forEach(client => {
      if (client.readyState === 1 /* === WebSocket.OPEN */) {
        client.send(JSON.stringify(log))
      }
    })
  })
}

websocket('/logs', stream)

module.exports = app
