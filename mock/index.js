var assert = require('assert')
var fs = require('fs')
var chokidar = require('chokidar')
var chalk = require('chalk')
var url = require('url')
var path = require('path')
var bodyParser = require('body-parser')
var proxyMiddleware = require('http-proxy-middleware')

var existsSync = fs.existsSync
var join = path.join

var error = null;
var { wp, resolve } = require('../bin/utils')
var configFile = resolve('./mock.config.js')
var mockDir = resolve('./mock/')
var appDirectory = resolve()

var debug = require('debug')('goku:mock');

function getConfig() {
	if (existsSync(configFile)) {
		// disable require cache
		Object.keys(require.cache).forEach(file => {
		if (file === configFile || file.indexOf(mockDir) > -1) {
			debug(`delete cache ${file}`);
			delete require.cache[file];
		}
		});
		return require(configFile);
	} else {
		return {};
	}
}

function parseKey(key) {
	var method = 'get';
	var path = key;

	if (key.indexOf(' ') > -1) {
	  var splited = key.split(' ');
	  method = splited[0].toLowerCase();
	  path = splited[1];
	}

	return { method, path };
}

function createMockHandler(method, path, value) {
	return function mockHandler(...args) {
	  const res = args[1];
	  if (typeof value === 'function') {
		value(...args);
	  } else {
		res.json(value);
	  }
	};
}

function createProxy(path, target) {

  // TODO: 支持对象传递
  var options = {
    target
  }
  return proxyMiddleware(path, options)
}

function outputError() {
	if (!error) return;

	var filePath = error.message.split(': ')[0];
	var relativeFilePath = filePath.replace(appDirectory, '.');
	var errors = error.stack
	  .split('\n')
	  .filter(line => line.trim().indexOf('at ') !== 0)
	  .map(line => line.replace(`${filePath}: `, ''));
	errors.splice(1, 0, ['']);

	console.log(chalk.red('Failed to parse mock config.'));
	console.log();
	console.log(`Error in ${relativeFilePath}`);
	console.log(errors.join('\n'));
	console.log();
}

function realApplyMock(app) {
	var config = getConfig();

	app.use(bodyParser.json({ limit: '5mb' }));
	app.use(
	  bodyParser.urlencoded({
		extended: true,
		limit: '5mb',
	  }),
	);

	Object.keys(config).forEach(key => {
	  var keyParsed = parseKey(key);
	  assert(
		typeof config[key] === 'function' ||
		  typeof config[key] === 'object' ||
		  typeof config[key] === 'string',
		`mock value of ${key} should be function or object or string, but got ${typeof config[
		  key
		]}`,
	  );
	  if (typeof config[key] === 'string') {
		var { path } = keyParsed;

		// 代理转发
		app.use(path, createProxy(path, config[key]));
	  } else {
		app[keyParsed.method](
		  keyParsed.path,
		  createMockHandler(keyParsed.method, keyParsed.path, config[key]),
		);
	  }
	});

  var startIndex = null;
  var lastIndex = null;
  var mockAPILength = null;
	app._router.stack.forEach((item, index) => {
    if (item.name === 'jsonParser') {
      startIndex = index;
    }
	  if (item.name === 'webpackDevMiddleware') {
		  lastIndex = index;
    }
	});

  // 更新中间件
	if (lastIndex) {
    if (lastIndex < startIndex) {
      mockAPILength = app._router.stack.length - startIndex;
      var newStack = app._router.stack.splice(startIndex, mockAPILength);
      app._router.stack.splice(lastIndex - 1, 0, ...newStack);
      startIndex = lastIndex
      lastIndex = startIndex + mockAPILength
    } else {
      mockAPILength = lastIndex - 2;
    }
	} else {
    mockAPILength = app._router.stack.length - startIndex;
  }

	var watcher = chokidar.watch([configFile, mockDir], {
	  ignored: /node_modules/,
	  persistent: true,
	});
	watcher.on('change', path => {
	  console.log(chalk.green('CHANGED'), path.replace(appDirectory, '.'));
	  watcher.close();

	  // 删除旧的 mock api
	  app._router.stack.splice(startIndex, mockAPILength);
	  applyMock(app);
	});
  }

function applyMock(app) {
	try {
		realApplyMock(app);
		error = null;
	} catch (e) {
		console.log(e);
		error = e;

		console.log();
		outputError();

		const watcher = chokidar.watch([configFile, mockDir], {
			ignored: /node_modules/,
			ignoreInitial: true,
		});
		watcher.on('change', path => {
			console.log(
				chalk.green('CHANGED'),
				path.replace(appDirectory, '.'),
			);
			watcher.close();
			applyMock(devServer);
		});
	}
}

module.exports = applyMock
