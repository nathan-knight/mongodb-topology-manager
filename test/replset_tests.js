'use strict';

var co = require('co'),
  f = require('util').format,
  assert = require('assert');

describe('ReplSet', function() {
  this.timeout(1000000);

  // Context variable stores all managers to clean up after test is completed
  var managers = [];

  afterEach(function() {
    return Promise.all(managers.map(manager => manager.stop())).then(() => (managers = []));
  });

  describe('manager', function() {
    it('establish server version', function() {
      return co(function*() {
        var ReplSet = require('../').ReplSet;

        // Create new instance
        var topology = new ReplSet(
          'mongod',
          [
            {
              // mongod process options
              options: {
                bind_ip: '127.0.0.1',
                port: 31000,
                dbpath: f('%s/../db/31000', __dirname)
              }
            },
            {
              // mongod process options
              options: {
                bind_ip: '127.0.0.1',
                port: 31001,
                dbpath: f('%s/../db/31001', __dirname)
              }
            },
            {
              // Type of node
              arbiter: true,
              // mongod process options
              options: {
                bind_ip: '127.0.0.1',
                port: 31002,
                dbpath: f('%s/../db/31002', __dirname)
              }
            }
          ],
          {
            replSet: 'rs'
          }
        );
        managers.push(topology);

        // Perform discovery
        var version = yield topology.discover();

        // Expect 3 integers
        assert.ok(typeof version.version[0] === 'number');
        assert.ok(typeof version.version[1] === 'number');
        assert.ok(typeof version.version[2] === 'number');
      });
    });

    it('start simple replicaset with 1 primary, 1 secondary and one arbiter', function() {
      return co(function*() {
        var ReplSet = require('../').ReplSet;

        // Create new instance
        var topology = new ReplSet(
          'mongod',
          [
            {
              // mongod process options
              options: {
                bind_ip: '127.0.0.1',
                port: 31000,
                dbpath: f('%s/../db/31000', __dirname)
              }
            },
            {
              // mongod process options
              options: {
                bind_ip: '127.0.0.1',
                port: 31001,
                dbpath: f('%s/../db/31001', __dirname)
              }
            },
            {
              // Type of node
              arbiter: true,
              // mongod process options
              options: {
                bind_ip: '127.0.0.1',
                port: 31002,
                dbpath: f('%s/../db/31002', __dirname)
              }
            }
          ],
          {
            replSet: 'rs'
          }
        );
        managers.push(topology);

        // Purge any directories
        yield topology.purge();

        // Start set
        yield topology.start();

        // Stop the set
        yield topology.stop();
      });
    });

    it('start simple ssl replicaset with 1 primary, 1 secondary and one arbiter', function() {
      return co(function*() {
        var ReplSet = require('../').ReplSet;

        // Create new instance
        var topology = new ReplSet(
          'mongod',
          [
            {
              // mongod process options
              options: {
                bind_ip: '127.0.0.1',
                port: 31000,
                dbpath: f('%s/../db/31000', __dirname),

                // SSL server instance options
                sslOnNormalPorts: null,
                sslPEMKeyFile: f('%s/ssl/server.pem', __dirname),
                sslAllowInvalidCertificates: null
              }
            },
            {
              // mongod process options
              options: {
                bind_ip: '127.0.0.1',
                port: 31001,
                dbpath: f('%s/../db/31001', __dirname),

                // SSL server instance options
                sslOnNormalPorts: null,
                sslPEMKeyFile: f('%s/ssl/server.pem', __dirname),
                sslAllowInvalidCertificates: null
              }
            },
            {
              // Type of node
              arbiter: true,
              // mongod process options
              options: {
                bind_ip: '127.0.0.1',
                port: 31002,
                dbpath: f('%s/../db/31002', __dirname),

                // SSL server instance options
                sslOnNormalPorts: null,
                sslPEMKeyFile: f('%s/ssl/server.pem', __dirname),
                sslAllowInvalidCertificates: null
              }
            }
          ],
          {
            // SSL client instance options
            replSet: 'rs',
            ssl: true,
            rejectUnauthorized: false
          }
        );
        managers.push(topology);

        // Perform discovery
        var result = yield topology.discover();
        // Skip ssl test
        if (!result.ssl) return;

        // Purge any directories
        yield topology.purge();

        // Start set
        yield topology.start();

        // Stop the set
        yield topology.stop();
      });
    });

    it('stepdown primary', function() {
      return co(function*() {
        var ReplSet = require('../').ReplSet;

        // Create new instance
        var topology = new ReplSet(
          'mongod',
          [
            {
              // mongod process options
              options: {
                bind_ip: '127.0.0.1',
                port: 31000,
                dbpath: f('%s/../db/31000', __dirname)
              }
            },
            {
              // mongod process options
              options: {
                bind_ip: '127.0.0.1',
                port: 31001,
                dbpath: f('%s/../db/31001', __dirname)
              }
            },
            {
              // Type of node
              arbiter: true,
              // mongod process options
              options: {
                bind_ip: '127.0.0.1',
                port: 31002,
                dbpath: f('%s/../db/31002', __dirname)
              }
            }
          ],
          {
            replSet: 'rs',
            electionCycleWaitMS: 5000,
            retryWaitMS: 1000
          }
        );
        managers.push(topology);

        // Purge any directories
        yield topology.purge();

        // Start set
        yield topology.start();

        // Step down primary and block until we have a new primary
        yield topology.stepDownPrimary(false, { stepDownSecs: 0, force: true });

        // Step down primary and immediately return
        yield topology.stepDownPrimary(true, { stepDownSecs: 0, force: true });

        // Block waiting for a new primary to be elected
        yield topology.waitForPrimary();

        // Stop the set
        yield topology.stop();
      });
    });

    it('add new member to set', function() {
      return co(function*() {
        var ReplSet = require('../').ReplSet;

        // Create new instance
        var topology = new ReplSet(
          'mongod',
          [
            {
              // mongod process options
              options: {
                bind_ip: '127.0.0.1',
                port: 31000,
                dbpath: f('%s/../db/31000', __dirname)
              }
            },
            {
              // mongod process options
              options: {
                bind_ip: '127.0.0.1',
                port: 31001,
                dbpath: f('%s/../db/31001', __dirname)
              }
            },
            {
              // Type of node
              arbiter: true,
              // mongod process options
              options: {
                bind_ip: '127.0.0.1',
                port: 31002,
                dbpath: f('%s/../db/31002', __dirname)
              }
            }
          ],
          {
            replSet: 'rs',
            electionCycleWaitMS: 5000,
            retryWaitMS: 1000
          }
        );
        managers.push(topology);

        // Purge any directories
        yield topology.purge();

        // Start set
        yield topology.start();

        // Add a new member to the set
        yield topology.addMember(
          {
            options: {
              bind_ip: '127.0.0.1',
              port: 31003,
              dbpath: f('%s/../db/31003', __dirname)
            }
          },
          {
            returnImmediately: false,
            force: false
          }
        );

        // Assert we have the expected number of instances
        var primary = yield topology.primary();
        var ismaster = yield primary.ismaster();
        assert.strictEqual(1, ismaster.arbiters.length);
        assert.strictEqual(3, ismaster.hosts.length);

        // Stop the set
        yield topology.stop();
      });
    });

    it('add new member to set with high priority', function() {
      // // Set the info level
      // Logger.setLevel('info');

      return co(function*() {
        var ReplSet = require('../').ReplSet;

        // Create new instance
        var topology = new ReplSet(
          'mongod',
          [
            {
              // mongod process options
              options: {
                bind_ip: '127.0.0.1',
                port: 31000,
                dbpath: f('%s/../db/31000', __dirname)
              }
            },
            {
              // mongod process options
              options: {
                bind_ip: '127.0.0.1',
                port: 31001,
                dbpath: f('%s/../db/31001', __dirname)
              }
            },
            {
              // Type of node
              arbiter: true,
              // mongod process options
              options: {
                bind_ip: '127.0.0.1',
                port: 31002,
                dbpath: f('%s/../db/31002', __dirname)
              }
            }
          ],
          {
            replSet: 'rs',
            electionCycleWaitMS: 5000,
            retryWaitMS: 1000
          }
        );
        managers.push(topology);

        // Purge any directories
        yield topology.purge();

        // Start set
        yield topology.start();

        // Add a new member to the set
        yield topology.addMember(
          {
            priority: 20,
            options: {
              bind_ip: '127.0.0.1',
              port: 31003,
              dbpath: f('%s/../db/31003', __dirname)
            }
          },
          {
            returnImmediately: false,
            force: false
          }
        );

        // Assert we have the expected number of instances
        var primary = yield topology.primary();
        var ismaster = yield primary.ismaster();
        assert.strictEqual(1, ismaster.arbiters.length);
        assert.strictEqual(3, ismaster.hosts.length);

        // Stop the set
        yield topology.stop();
      });
    });

    it('remove member from set', function() {
      return co(function*() {
        var ReplSet = require('../').ReplSet;

        // Create new instance
        var topology = new ReplSet(
          'mongod',
          [
            {
              // mongod process options
              options: {
                bind_ip: '127.0.0.1',
                port: 31000,
                dbpath: f('%s/../db/31000', __dirname)
              }
            },
            {
              // mongod process options
              options: {
                bind_ip: '127.0.0.1',
                port: 31001,
                dbpath: f('%s/../db/31001', __dirname)
              }
            },
            {
              // Type of node
              arbiter: true,
              // mongod process options
              options: {
                bind_ip: '127.0.0.1',
                port: 31002,
                dbpath: f('%s/../db/31002', __dirname)
              }
            },
            {
              // mongod process options
              options: {
                bind_ip: '127.0.0.1',
                port: 31003,
                dbpath: f('%s/../db/31003', __dirname)
              }
            }
          ],
          {
            replSet: 'rs',
            electionCycleWaitMS: 5000,
            retryWaitMS: 1000
          }
        );
        managers.push(topology);

        // Purge any directories
        yield topology.purge();

        // Start set
        yield topology.start();

        // Get all the secondaries
        var secondaries = yield topology.secondaries();

        // Remove a member from the set
        yield topology.removeMember(secondaries[0], {
          returnImmediately: false,
          force: false
        });

        // Assert we have the expected number of instances
        var primary = yield topology.primary();
        var ismaster = yield primary.ismaster();
        assert.strictEqual(1, ismaster.arbiters.length);
        assert.strictEqual(2, ismaster.hosts.length);

        // Stop the set
        yield topology.stop();
      });
    });

    it('put secondary in maintenance mode', function() {
      return co(function*() {
        var ReplSet = require('../').ReplSet;

        // Create new instance
        var topology = new ReplSet(
          'mongod',
          [
            {
              // mongod process options
              options: {
                bind_ip: '127.0.0.1',
                port: 31000,
                dbpath: f('%s/../db/31000', __dirname)
              }
            },
            {
              // mongod process options
              options: {
                bind_ip: '127.0.0.1',
                port: 31001,
                dbpath: f('%s/../db/31001', __dirname)
              }
            },
            {
              // Type of node
              arbiter: true,
              // mongod process options
              options: {
                bind_ip: '127.0.0.1',
                port: 31002,
                dbpath: f('%s/../db/31002', __dirname)
              }
            }
          ],
          {
            replSet: 'rs',
            electionCycleWaitMS: 5000,
            retryWaitMS: 1000
          }
        );
        managers.push(topology);

        // Purge any directories
        yield topology.purge();

        // Start set
        yield topology.start();

        // Get all the secondaries
        var secondaries = yield topology.secondaries();

        // Put secondary in maintenance mode
        yield topology.maintenance(true, secondaries[0], {
          returnImmediately: false
        });

        // Assert we have the expected number of instances
        var ismaster = yield secondaries[0].ismaster();
        assert.strictEqual(false, ismaster.secondary);
        assert.strictEqual(false, ismaster.ismaster);

        // Wait for server to come back
        yield topology.maintenance(false, secondaries[0], {
          returnImmediately: false
        });

        ismaster = yield secondaries[0].ismaster();
        assert.strictEqual(true, ismaster.secondary);

        // Stop the set
        yield topology.stop();
      });
    });

    it('reconfigure using existing configuration', function() {
      return co(function*() {
        var ReplSet = require('../').ReplSet;

        // Create new instance
        var topology = new ReplSet(
          'mongod',
          [
            {
              // mongod process options
              options: {
                bind_ip: '127.0.0.1',
                port: 31000,
                dbpath: f('%s/../db/31000', __dirname)
              }
            },
            {
              // mongod process options
              options: {
                bind_ip: '127.0.0.1',
                port: 31001,
                dbpath: f('%s/../db/31001', __dirname)
              }
            },
            {
              // mongod process options
              options: {
                bind_ip: '127.0.0.1',
                port: 31002,
                dbpath: f('%s/../db/31002', __dirname)
              }
            }
          ],
          {
            replSet: 'rs',
            electionCycleWaitMS: 5000,
            retryWaitMS: 1000
          }
        );
        managers.push(topology);

        // Purge any directories
        yield topology.purge();

        // Start set
        yield topology.start();

        // Get the configuration
        var config = JSON.parse(JSON.stringify(topology.configurations[0]));
        config.members[2].priority = 10;

        // Force the reconfiguration
        yield topology.reconfigure(config, {
          returnImmediately: false,
          force: false
        });

        // Get the current configuration
        var primary = yield topology.primary();
        var currentConfig = yield topology.configuration(primary);
        assert.strictEqual(10, currentConfig.members[2].priority);

        // Stop the set
        yield topology.stop();
      });
    });

    it('test retrieve number of arbiters, secondary & primary', function() {
      this.timeout(200000);

      return co(function*() {
        var ReplSet = require('../').ReplSet;

        // Create new instance
        var topology = new ReplSet(
          'mongod',
          [
            {
              // mongod process options
              options: {
                bind_ip: '127.0.0.1',
                port: 31000,
                dbpath: f('%s/../db/31000', __dirname)
              }
            },
            {
              // mongod process options
              options: {
                bind_ip: '127.0.0.1',
                port: 31001,
                dbpath: f('%s/../db/31001', __dirname)
              }
            },
            {
              // Type of node
              arbiter: true,
              // mongod process options
              options: {
                bind_ip: '127.0.0.1',
                port: 31002,
                dbpath: f('%s/../db/31002', __dirname)
              }
            }
          ],
          {
            replSet: 'rs'
          }
        );
        managers.push(topology);

        // Purge any directories
        yield topology.purge();

        // Start set
        yield topology.start();

        // Retrieve servers
        var primary = yield topology.primary();
        var secondaries = yield topology.secondaries();
        var passives = yield topology.passives();
        var arbiters = yield topology.arbiters();

        // Verify primary
        assert.strictEqual(primary.host, '127.0.0.1');
        assert.ok(primary.port === 31000 || primary.port === 31001);

        // Verify secondaries
        assert.strictEqual(secondaries.length, 1);
        assert.strictEqual(secondaries[0].host, '127.0.0.1');
        assert.strictEqual(secondaries[0].port, primary.port === 31000 ? 31001 : 31000);

        // Verify passives
        assert.strictEqual(passives.length, 0);

        // Verify arbiters
        assert.strictEqual(arbiters.length, 1);
        assert.strictEqual(arbiters[0].host, '127.0.0.1');
        assert.strictEqual(arbiters[0].port, 31002);

        // Stop the set
        yield topology.stop();
      });
    });
  });
});
