var inherits = require('util').inherits;
var Writable = require('readable-stream').Writable;

var FileListStream = require('./html5-filelist-stream');
var Messaging = require('./messaging');

inherits(ObjectStream, Writable);

function setImmediate(fn) {
  return setTimeout(fn, 0);
}

/**
 * Object stream overrides Writable stream to allow object size to be
 * defined differently than just number of objects for backpressure.
 * @param {[type]} options [description]
 */
function ObjectStream(options) {
  if (!(this instanceof ObjectStream))
    return new ObjectStream(options);
  if (typeof options == "undefined")
    options = {};
  Writable.call(this, {
    objectMode: true,
    highWaterMark: Infinity // Number of objects is unbounded.
  });
  // Track size of objects.
  this.length = 0;
  // Arbitrary units.
  this.__highWaterMark = options.highWaterMark || 16;
}

/**
 * Override to get buffered data length.
 * @override
 */
ObjectStream.prototype.write = function(chunk, encoding, cb) {
  console.log("ObjectStream#write: Received chunk.");
  var size = this._size(chunk);
  // Size of currently called write value + size of all buffered calls.
  this.length += size;
  // Disregard original return value.
  Writable.prototype.write.apply(this, arguments);
  var ret = this.length < this.__highWaterMark;
  if (!ret) {
    console.log("ObjectStream#write: Need drain.");
    this._writableState.needDrain = true;
  }

  return ret;
};

/**
 * Override to get written data length and call subclass override __write.
 * @override
 */
ObjectStream.prototype._write = function(chunk, encoding, cb) {
  var writelen = this._size(chunk);
  // Remove from size of internal buffer.
  this.length -= writelen;
  this.__write(chunk, encoding, cb);
};

// Subclasses may override. Same signature as _write.
ObjectStream.prototype.__write = function(chunk, encoding, cb) {
  console.log("ObjectStream#__write not overriden.");
};

// Subclasses must override. Takes obj and returns integer size.
ObjectStream.prototype._size = function(obj) {
  console.warn("ObjectStream#_size not overriden!");
};

inherits(ReplayImportStream, ObjectStream);
module.exports = ReplayImportStream;

/**
 * @typedef {object} ReplayImportOptions
 * @property {integer} [highWaterMark] - Size (in bytes) used to restrict
 *   the maximum number of replays that can be sent at once, and also
 *   restricts the length of the ObjectStore internal buffer. Assume app
 *   may have objects of this size * 2 allocated. Default is equal to
 *   50MB.
 */
/**
 * Stream for importing replays. Pipe a fileliststream into me.
 * Works best with a quick source and a slower insertion (which is
 * currently the case with IndexedDB and reading the files).
 */
function ReplayImportStream(options) {
  if (!(this instanceof ReplayImportStream))
    return new ReplayImportStream(options);
  if (typeof options == "undefined")
    options = {};
  this._cache = [];
  this._cachesize = 0;
  this._importing = false;
  this._highWaterMark = options.highWaterMark || 1024 * 1024 * 50;
  this._done = false;
  ObjectStream.call(this, {
    objectMode: true,
    highWaterMark: this._highWaterMark
  });

  var self = this;
  this.on('finish', function () {
    console.log("ReplayImportStream: finish callback.");
    this._done = true;
    if (!self._importing && !self._moreBuffered()) {
      this.emit('done');
    }
  });

  this.on('pipe', function (src) {
    self.src = src;
  });
}

/**
 * Override for ObjectStream.
 * @override
 * @param {FileInfo} value - Replay file information.
 * @param {string} encoding - disregarded.
 * @param {Function} done - Called with 
 * @return {[type]} [description]
 */
ReplayImportStream.prototype.__write = function(value, encoding, done) {
  console.log("ReplayImportStream#__write: Writing chunk.");
  this._lastValue = value;
  var self = this;
  function pending(err) {
    // Done being written to, and no more values buffered.
    if (self._done && !self._moreBuffered()) {
      self.emit('done');
      done(err);
    } else {
      // More values or not done.
      done(err);
    }
  }
  this._cache.push(value);
  this._cachesize += this._size(value);
  // Add to cache if cachesize allows it.
  if (this._cachesize < this._highWaterMark) {
    if (this._moreBuffered()) {
      // Fill up the cache.
      done();
    } else if (!this._importing) {
      this._pendingCallback = pending;
      this._send();
    }
  } else if (!this._importing) {
    this._pendingCallback = pending;
    this._send();
  }
  // Emit drain prior to callback check.
  if (this._writableState.needDrain && !this._moreBuffered()) {
    this.emit('drain');
  }
};

/**
 * Override for ObjectStream.
 * @override
 */
ReplayImportStream.prototype._size = function(obj) {
  return obj.size;
};

/**
 * Determine if the given value is the last buffered chunk available.
 * @param {*} value
 * @return {boolean}
 */
ReplayImportStream.prototype._moreBuffered = function() {
  return this._writableState.lastBufferedRequest &&
      this._writableState.lastBufferedRequest.chunk !== this._lastValue;
};

ReplayImportStream.prototype._send = function() {
  var self = this;
  this._importing = true;

  var cache = this._cache;
  this._cache = [];
  this._cachesize = 0;
  console.log("ReplayImportStream#_send: Sending %d replays.", cache.length);

  Messaging.send('importReplay', cache, function (response) {
    console.log("ReplayImportStream:callback: Replay import complete.");
    // Emit error.
    response.forEach(function (result) {
      if (result.failed) {
        self.emit('error', result);
        console.error("Failed to import replay %s: %s.", result.name, result.reason);
      }
    });
    self._importing = false;
    if (self._pendingCallback) {
      console.log("ReplayImportStream:callback: calling pending callback.");
      var cb = self._pendingCallback;
      self._pendingCallback = null;
      cb();
    }
  });
};
