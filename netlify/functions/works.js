const { makeJsonResourceHandler } = require('./lib/jsonResource');

exports.handler = makeJsonResourceHandler('data/works.json', 'works.json');
