'use strict';

const co = require('co'),
  f = require('util').format,
  Logger = require('./logger'),
  ReplSet = require('./replset'),
  EventEmitter = require('events').EventEmitter,
  ConfigServers = require('./config_servers'),
  Mongos = require('./mongos'),
  spawn = require('child_process').spawn,
  clone = require('./utils').clone;

var reportError = function(self, reject) {
  return function(err) {
    self.logger.error(f('%s at %s', err.message, err.stack));
    reject(err);
  };
};

class Sharded extends EventEmitter {
  constructor(options) {
    super();
    options = options || {};
    // Unpack default runtime information
    this.mongod = options.mongod || 'mongod';
    this.mongos = options.mongos || 'mongos';

    // Create logger instance
    this.logger = Logger('Sharded', options);

    // All pieces of the topology
    this.shards = [];
    this.configurationServers = null;
    this.proxies = [];

    // Keep all options
    this.topologyElements = {
      shards: [],
      configurations: [],
      proxies: []
    };
  }

  discover() {
    var self = this;

    return new Promise(function(resolve, reject) {
      var proc = spawn(self.mongod, ['--version']);
      // Variables receiving data
      var stdout = '';
      var stderr = '';

      // Get the stdout
      proc.stdout.on('data', function(data) {
        stdout += data;
      });

      // Get the stderr
      proc.stderr.on('data', function(data) {
        stderr += data;
      });

      // Got an error
      proc.on('error', function(err) {
        reject(err);
      });

      // Process terminated
      proc.on('close', function() {
        // Perform version match
        var versionMatch = stdout.match(/[0-9]+\.[0-9]+\.[0-9]+/);

        // Check if we have ssl
        var sslMatch = stdout.match(/ssl/i) || stderr.match(/ssl/i);

        // Resolve the server version
        resolve({
          version: versionMatch
            .toString()
            .split('.')
            .map(function(x) {
              return parseInt(x, 10);
            }),
          ssl: sslMatch != null
        });
      });
    });
  }

  addShard(nodes, options) {
    var self = this;

    return new Promise(function(resolve) {
      options = options || {};

      // Create a shard
      var shard = new ReplSet(self.mongod, nodes, options);

      // Add listener to the state and remit
      shard.on('state', function(state) {
        self.emit('state', state);
      });

      // Add shard to list of shards
      self.shards.push(shard);

      // Save the options
      self.topologyElements.shards.push({
        node: nodes,
        options: options
      });

      resolve();
    });
  }

  addConfigurationServers(nodes, options) {
    var self = this;

    return new Promise(function(resolve, reject) {
      co(function*() {
        options = options || {};
        // Establish the version of the mongod process
        var result = yield self.discover();
        var version = result.version;

        // If configuration server has not been set up
        options = clone(options);
        // Clone the nodes
        nodes = JSON.parse(JSON.stringify(nodes));
        // Add config server to each of the nodes
        nodes = nodes.map(function(x) {
          if (x.arbiter) {
            delete x['arbiter'];
          }

          if (!x.arbiter) {
            x.options.configsvr = null;
          }

          return x;
        });

        // Check if we have 3.2.0 or higher where we need to boot up a replicaset
        // not a set of configuration server
        if (version[0] >= 4 || (version[0] === 3 && version[1] >= 2)) {
          self.configurationServers = new ReplSet(self.mongod, nodes, options);
          // Tag options with is replicaset
          options.isReplicaset = true;
        } else {
          self.configurationServers = new ConfigServers(
            self.mongod,
            nodes.map(function(x) {
              return x.options;
            }),
            options
          );
          // Tag options with is not a replicaset
          options.isReplicaset = false;
        }

        // Add listener to the state and remit
        self.configurationServers.on('state', function(state) {
          self.emit('state', state);
        });

        // Save the options
        self.topologyElements.configurations.push({
          node: nodes,
          options: options
        }),
          resolve();
      }).catch(reportError(self, reject));
    });
  }

  addProxies(nodes, options) {
    var self = this;

    return new Promise(function(resolve, reject) {
      options = options || {};

      // Clone the options
      options = clone(options);

      // Is the proxy connecting to a replicaset
      if (self.topologyElements.configurations.length === 0) {
        reject(
          new Error('A configuration server topology must be specified before adding proxies')
        );
      }

      // Get the configuration setup
      if (self.topologyElements.configurations[0].options.isReplicaset) {
        nodes = nodes.map(function(x) {
          // x.replSet = self.topologyElements.configurations[0].options.replSet;
          x.configdb = f(
            '%s/%s',
            self.topologyElements.configurations[0].options.replSet,
            x.configdb
          );
          return x;
        });
      }

      // For each node create a proxy
      for (var i = 0; i < nodes.length; i++) {
        var proxy = new Mongos(self.mongos, nodes[i], options);

        // Add listener to the state and remit
        proxy.on('state', function(state) {
          self.emit('state', state);
        });

        // Add proxy to list
        self.proxies.push(proxy);
      }

      // Save the options
      self.topologyElements.proxies.push({
        node: nodes,
        options: options
      });

      resolve();
    });
  }

  enableSharding(db, credentials) {
    var self = this;

    return new Promise(function(resolve, reject) {
      co(function*() {
        // Get a proxy
        var proxy = self.proxies[0];

        if (self.logger.isInfo()) {
          self.logger.info(f('enable sharding for db %s', db));
        }

        // Execute the enable sharding command
        var result = yield proxy.executeCommand(
          'admin.$cmd',
          {
            enableSharding: db
          },
          credentials
        );

        if (self.logger.isInfo()) {
          self.logger.info(
            f(
              'successfully enabled sharding for db %s with result [%s]',
              db,
              JSON.stringify(result)
            )
          );
        }

        // Resolve
        resolve();
      }).catch(reportError(self, reject));
    });
  }

  shardCollection(db, collection, shardKey, options, credentials) {
    var self = this;

    return new Promise(function(resolve, reject) {
      co(function*() {
        options = options || {};
        options = clone(options);
        // Get a proxy
        var proxy = self.proxies[0];

        // Create shard collection command
        var command = {
          shardCollection: f('%s.%s', db, collection),
          key: shardKey
        };

        // Unique shard key
        if (options.unique) {
          command.unique = true;
        }

        if (self.logger.isInfo()) {
          self.logger.info(
            f(
              'shard collection for %s.%s with command [%s]',
              db,
              collection,
              JSON.stringify(command)
            )
          );
        }

        // Execute the enable sharding command
        var result = yield proxy.executeCommand('admin.$cmd', command, credentials);

        if (self.logger.isInfo()) {
          self.logger.info(
            f(
              'successfully sharded collection for %s.%s with command [%s] and result [%s]',
              db,
              collection,
              JSON.stringify(command),
              JSON.stringify(result)
            )
          );
        }

        // Resolve
        resolve();
      }).catch(reportError(self, reject));
    });
  }

  start() {
    var self = this;

    return new Promise(function(resolve, reject) {
      co(function*() {
        // Boot up the shards first
        // Purge all shards first
        yield Promise.all(self.shards.map(shard => shard.purge()));

        // Then boot up the shards
        yield Promise.all(self.shards.map((shard) => {
          if (self.logger.isInfo()) {
            self.logger.info(f('start shard %s', shard.shardUrl()));
          }

          return shard.start();
        }));

        if (self.logger.isInfo()) {
          self.logger.info(f('start configuration server %s', self.configurationServers.url()));
        }

        // Purge directories
        yield self.configurationServers.purge();
        // Boot up the configuration servers
        yield self.configurationServers.start();

        // Purge all proxies first
        yield Promise.all(self.proxies.map(proxy => proxy.purge()));

        // Then boot up the proxies
        yield Promise.all(self.proxies.map(function(proxy) {
          if (self.logger.isInfo()) {
            self.logger.info(f('start proxy at %s', proxy.name));
          }

          return proxy.start();
        }));

        // Connect and add the shards
        const proxy = self.proxies[0];
        if (!proxy) return reject('no mongos process found');

        // Add all the shards
        for (let i = 0; i < self.shards.length; i++) {
          if (self.logger.isInfo()) {
            self.logger.info(f('add shard at %s', self.shards[i].shardUrl()));
          }

          // Add the shard
          var result = yield proxy.executeCommand(
            'admin.$cmd',
            {
              addShard: self.shards[i].shardUrl()
            },
            null,
            {
              reExecuteOnError: true
            }
          );

          if (self.logger.isInfo()) {
            self.logger.info(
              f(
                'add shard at %s with result [%s]',
                self.shards[i].shardUrl(),
                JSON.stringify(result)
              )
            );
          }
        }

        if (self.logger.isInfo()) {
          self.logger.info(f('sharded topology is up'));
        }

        self.state = 'running';

        resolve();
      }).catch(reportError(self, reject));
    });
  }

  purge() {
    var self = this;

    return new Promise(function(resolve, reject) {
      co(function*() {
        // We are already running, so we shouldn't really purge
        // TODO: Throw here?
        if (self.state === 'running') return resolve();

        if (self.logger.isInfo()) {
          self.logger.info(f('purging mongo proxy directories'));
        }

        // Purge all the proxies
        yield Promise.all(self.proxies.map(proxy => proxy.purge()));

        if (self.logger.isInfo()) {
          self.logger.info(f('purging configuration server directories'));
        }

        // Shutdown configuration server
        if (self.configurationServers) {
          yield self.configurationServers.purge();
        }

        if (self.logger.isInfo()) {
          self.logger.info(f('purging shard directories'));
        }

        // Purge all the shards
        yield Promise.all(self.shards.map(shard => shard.purge()));

        if (self.logger.isInfo()) {
          self.logger.info(f('done purging directories for topology'));
        }

        // Resolve
        resolve();
      }).catch(reportError(self, reject));
    });
  }

  stop() {
    var self = this;

    return new Promise(function(resolve, reject) {
      co(function*() {
        // We are already running, just return
        if (self.state !== 'running') return resolve();

        if (self.logger.isInfo()) {
          self.logger.info(f('Shutting down mongos proxies'));
        }

        // Shutdown all the proxies
        yield Promise.all(self.proxies.map(proxy => proxy.stop()));

        if (self.logger.isInfo()) {
          self.logger.info(f('Shutting down configuration servers'));
        }

        // Shutdown configuration server
        yield self.configurationServers.stop();

        if (self.logger.isInfo()) {
          self.logger.info(f('Shutting down shards'));
        }

        // Shutdown all the shards
        yield Promise.all(self.shards.map(shard => shard.stop()));

        if (self.logger.isInfo()) {
          self.logger.info(f('done shutting down sharding topology'));
        }

        // Set the state to running
        self.state = 'stopped';

        // Resolve
        resolve();
      }).catch(reportError(self, reject));
    });
  }

  restart() {
    var self = this;

    return new Promise(function(resolve, reject) {
      co(function*() {}).catch(reportError(self, reject));
    });
  }
}

module.exports = Sharded;
