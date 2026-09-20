// Local test broker only. Production uses Mosquitto + TLS and deploy/acl.
const net = require('net');
const aedes = require('../.tools/mqtt/node_modules/aedes')();
aedes.authenticate = (client, username, password, callback) => {
  client.identity = username;
  callback(null, password?.toString() === 'test-broker-password' && username === client.id);
};
aedes.authorizePublish = (client, packet, callback) => {
  const parts = packet.topic.split('/');
  const allowed = client.identity === 'inventory-server'
    ? parts[3] === 'down' : parts[2] === client.identity && parts[3] === 'up';
  callback(allowed ? null : new Error('Topic denied'));
};
aedes.authorizeSubscribe = (client, sub, callback) => {
  const parts = sub.topic.split('/');
  const allowed = client.identity === 'inventory-server'
    ? parts[3] === 'up' : parts[2] === client.identity && parts[3] === 'down';
  callback(null, allowed ? sub : null);
};
net.createServer(aedes.handle).listen(Number(process.argv[2]), '127.0.0.1', ()=>console.log('READY'));
