(function attachLoggerManager(root, factory) {
  const logger = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = logger;
  }
  root.LoggerManager = logger;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createLoggerManager() {
  const LOG_TAG = 'logger_tag_chai';
  let debugEnabled = true;

  function setDebugEnabled(enabled) {
    debugEnabled = Boolean(enabled);
  }

  function getLineNumber() {
    const stack = new Error().stack || '';
    const line = stack.split('\n')[4] || stack.split('\n')[3] || '';
    const match = line.match(/:(\d+):\d+\)?$/);
    return match ? match[1] : '0';
  }

  function format(className, methodName, msg) {
    return `${LOG_TAG} ${className} - ${methodName}(${getLineNumber()}) : ${msg}`;
  }

  function debug(className, methodName, msg, data) {
    if (!debugEnabled) return;
    if (data !== undefined) {
      console.log(format(className, methodName, msg), data);
    } else {
      console.log(format(className, methodName, msg));
    }
  }

  function warn(className, methodName, msg, data) {
    if (!debugEnabled) return;
    if (data !== undefined) {
      console.warn(format(className, methodName, msg), data);
    } else {
      console.warn(format(className, methodName, msg));
    }
  }

  function error(className, methodName, msg, errorData) {
    if (!debugEnabled) return;
    if (errorData !== undefined) {
      console.error(format(className, methodName, msg), errorData);
    } else {
      console.error(format(className, methodName, msg));
    }
  }

  return {
    LOG_TAG,
    setDebugEnabled,
    debug,
    warn,
    error
  };
});
