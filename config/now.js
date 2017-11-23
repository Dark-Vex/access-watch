const pipeline = require('../lib/pipeline')

const input = require('../input')
const format = require('../format')

const httpInput = input.http.create({
  name: 'HTTP (JSON standard format)',
  path: '/input/log',
  parse: format.json.parser()
})

pipeline.registerInput(httpInput)

const webSocketServerInput = input.websocket.create({
  name: 'WebSocket server (JSON standard format)',
  type: 'server',
  path: '/input/log',
  parse: format.json.parser()
})

pipeline.registerInput(webSocketServerInput)
