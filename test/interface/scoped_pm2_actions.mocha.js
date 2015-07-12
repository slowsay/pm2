
var cmd_pm2  = require('../..');
var should   = require('should');
var nssocket = require('nssocket');
var events   = require('events');
var util     = require('util');
var Cipher   = require('../../lib/Interactor/Cipher.js');
var cst      = require('../../constants.js');
var Plan     = require('../helpers/plan.js');

var Interactor = require('../../lib/Interactor/InteractorDaemonizer.js');
var gl_interactor_process;

var send_cmd = new events.EventEmitter();

process.env.NODE_ENV = 'local_test';

var meta_connect = {
  secret_key : 'osef',
  public_key : 'osef',
  machine_name : 'osef'
};

/**
 * Description
 * @method forkPM2
 * @return pm2
 */
function forkPM2(cb) {
  var pm2 = require('child_process').fork('lib/Satan.js', [], {
    detached   : true
  });

  pm2.unref();

  pm2.on('message', function() {
    cb(null, pm2);
  });
}

/**
 * Description
 * @method forkInteractor
 * @return CallExpression
 */
function forkInteractor(cb) {
  console.log('Launching interactor');

  Interactor.launchAndInteract(meta_connect, function(err, data, interactor_process) {
    gl_interactor_process = interactor_process;
    cb();
  });
}

/**
 * Mock server receiving data
 * @method forkInteractor
 * @return CallExpression
 */
function createMockServer(cb) {
  var server = nssocket.createServer(function(_socket) {

    console.log('Got new connection in Mock server');

    send_cmd.on('cmd', function(data) {
      console.log('Sending command %j', data);
      _socket.send(data._type, data);
    });

    _socket.data('*', function(data) {
      this.event.forEach(function(ev) {
        send_cmd.emit(ev, data);
      });
    });

  });

  server.on('error', function(e) {
    throw new Error(e);
  });

  server.on('listening', function() {
    cb(null, server);
  });

  server.listen(4322, '0.0.0.0');
}

function startSomeApps(cb) {
  setTimeout(function() {
    cmd_pm2.connect(function() {
      cmd_pm2.start('./test/fixtures/child.js', {instances : 4, name : 'child'}, cb);
    });
  }, 500);
}

describe('REMOTE PM2 ACTIONS', function() {
  var server;
  var interactor;
  var pm2;

  after(function(done) {
    server.close();
    Interactor.killDaemon(function() {
      var fs = require('fs');

      fs.unlinkSync(cst.INTERACTION_CONF);

      pm2.kill();

      pm2.on('exit', function() {done()});
    });
  });

  before(function(done) {
    createMockServer(function(err, _server) {
      server = _server;
      forkPM2(function(err, _pm2) {
        pm2 = _pm2;
        console.log('PM2 forked');
        forkInteractor(function(err, _interactor) {
          interactor = _interactor;
          console.log('Interactor forked');
          startSomeApps(function() {
            done();
          });
        });
      });
    });
  });

  it('should send ask, receive ask:rep and identify agent', function(done) {
    send_cmd.once('ask:rep', function(pck) {
      var data = Cipher.decipherMessage(pck.data, meta_connect.secret_key);
      data.machine_name.should.eql(meta_connect.machine_name);
      done();
    });

    send_cmd.emit('cmd', { _type : 'ask' });
  });

  /**
   * PM2 agent is now identified
   */
  describe('PM2 is identified', function() {
    it('should restart command via scoped pm2 action', function(done) {
      var plan = new Plan(4, function() {
        // Double check that process has been unlocked
        cmd_pm2.list(function(err, ret) {
          ret.forEach(function(proc) {
            proc.pm2_env.command.locked.should.be.false;
          });
        });
        done();
      });

      gl_interactor_process.on('message', function(pck) {
        if (pck.event == 'pm2:scoped:stream' && pck.data.out === 'Action restart received') {
          return plan.ok(true);
        }
        if (pck.event == 'pm2:scoped:stream' && pck.data.out.indexOf('unlocked') > -1) {
          return plan.ok(true);
        }
        if (pck.event == 'pm2:scoped:stream' && pck.data.out.indexOf('locked') > -1) {
          return plan.ok(true);
        }
        if (pck.event == 'pm2:scoped:end') {
          return plan.ok(true);
        }
        return false;
      });

      send_cmd.emit('cmd', {
        _type : 'trigger:pm2:scoped:action',
        method_name : 'restart',
        uuid : '1234',
        parameters : { name : 'child' }
      });
    });

  });

});
