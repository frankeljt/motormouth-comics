const { makeJsonResourceHandler } = require('./lib/jsonResource');

exports.handler = makeJsonResourceHandler('data/exhibitions.json', 'exhibitions.json');
