'use strict'

var ADSR = require('adsr')

// Default sample options
var DEFAULTS = {
  gain: 1,
  loop: false,
  pitch: 0,
  loopStart: 0,
  loopEnd: 0,
  adsr: [0.01, 0.1, 0.8, 0.3],
  filter: 'highpass',
  freq: 0
}

/**
 * Create an audio sample. An audio sample is an object with the following
 * connected nodes:
 *
 * - source: a buffer source node
 * - filter: a biquad filter node
 * - env: a gain envelop adsr node
 * - amp: a gain node
 *
 * They are public, and you can modify them before play.
 *
 * Additionally, an audio sample has a `start` and  `stop` methods and a `onended`
 * event handler.
 *
 * @param {AudioBuffer} buffer - (Required) the audio buffer
 * @param {AudioNode} destination - (Required) the audio destination
 * @param {Hash|Function} options - (Optional) the sample options
 * @param {Function} fire - (Optiona) a function to fire events
 * @return {Sample} the sample
 *
 * @example
 * var sample = new Sample(buffer, ac.destination)
 * sample.play(ac.currentTime)
 */
function Sample (buffer, destination, options, event) {
  if (!(this instanceof Sample)) return new Sample(buffer, destination, options, event)
  var s = this
  var opts = typeof options === 'function' ? options : from(options, {}, {})
  s.ac = destination.context
  s.event = event || function () {}
  s.amp = s.ac.createGain()
  s.amp.gain.value = 0
  s.amp.connect(destination || s.output)
  s.env = adsr(s.ac, opts('adsr'))
  s.env.value.value = opts('gain')
  s.env.connect(s.amp.gain)

  s.filter = s.ac.createBiquadFilter()
  s.filter.type = opts('filter')
  s.filter.frequency.value = opts('freq')
  s.filter.connect(s.amp)

  s.source = s.ac.createBufferSource()
  s.source.buffer = buffer
  s.source.loop = opts('loop')
  s.source.connect(s.filter)
  s.source.playbackRate.value = centsToRate(opts('pitch') * 100)
  s.source.loopStart = opts('loopStart')
  s.source.loopEnd = opts('loopEnd')

  s.source.onended = function () {
    s.event('ended', s)
    s.source.stop()
    s.source.disconnect()
    s.filter.disconnect()
    s.amp.disconnect()
    s.env.disconnect()
    s.onended(this)
  }
}

/**
 * A event handler that contains the callback associated with the `ended`
 * audio buffer source event
 *
 * @name sample.onended
 * @example
 * var sample = new Sample(buffer, ac.destination)
 * sample.onended = function(sample) { console.log('ended!') }
 */
Sample.prototype.onended = function () { }

/**
 * Schedule the sample to start. Only can be called once.
 *
 * @name sample.start
 * @function
 * @param {Float} when - (Optional) when to start the sample or now
 * @param {Float} duration - (Optional) the duration in seconds. Only if its
 * greater than 0, the `stop` method of sample will be called after that duration
 *
 * @example
 * var sample = new Sample(buffer, ac.destination)
 * sample.start()
 * sample.start() // => thows Error. Create a new sample instead.
 */
Sample.prototype.start = function (when, duration) {
  this.event('start', this, when)
  this.env.start(when)
  this.source.start(when)
  if (duration > 0) this.stop(when + duration)
}

/**
 * Schedule the sample to stop.
 *
 * @name sample.stop
 * @function
 * @param {Float} when - (Optiona) when to stop the sample, or now
 *
 * @example
 * var sample = new Sample(buffer, ac.destination)
 * sample.start(ac.currentTime + 1)
 * sample.stop(ac.currentTime + 2)
 */
Sample.prototype.stop = function (when) {
  this.event('stop', this, when)
  var stopAt = this.env.stop(when || this.ac.currentTime)
  this.source.stop(stopAt)
}

/**
 * Create a audio buffer player. An audio buffer player allows to play audio
 * buffers easily.
 *
 * It has three methods: `start`, `stop` and `connect`
 *
 * @name Player
 * @function
 * @param {AudioNode|AudioContext} destination - the destination
 * or the audio context. In the first case, the player will connect to that
 * destination. In the second, you will have to call `connect` explicitly
 * @param {Hash} options - (Optional) the default sample configuration.
 * See `Sample` constructor
 * @return {Player} the sample player
 * @see Sample
 *
 * @example
 * var player = new Player(ac.destination)
 * // play the same buffer with 1 second of difference
 * player.start(buffer, ac.currentTime)
 * player.start(buffer, ac.currentTime + 1)
 */
function Player (ac, options) {
  if (!(this instanceof Player)) return new Player(ac, options)

  this.options = options || {}
  this.nextId = 1
  this._playing = {}
  this.onevent = function () {}

  // if its a destination, connect
  if (ac.context) {
    this.ac = ac.context
    this.output = this.ac.createGain()
    this.output.connect(ac)
  } else {
    this.ac = ac
    this.output = ac.createGain()
  }
}

/**
 * Start a buffer
 *
 * @name player.start
 * @param {AudioBuffer} buffer - the audio buffer to play
 * @param {Float} when - the start time
 * @param {Float} duration - (Optional) the duration in seconds. If it's
 * a number greater than 0, it will stop the buffer after that time.
 * @param {Hash} options - (Optional) options (same as in Player function)
 * @param {AudioDestinationNode} destination - (Optional) a destination that
 * overrides the default routing
 * @return {Object} an object with the following connected nodes:
 *
 * @example
 * var player = new Player(ac.destination)
 * player.start(buffer, ac.currentTime, 1, { loop: true })
 */
Player.prototype.start = function (buffer, when, duration, options, destination) {
  var ac = this.ac
  var event = this.onevent
  var tracked = this._playing
  when = when || ac.currentTime

  var opts = from(options || {}, this.options, DEFAULTS)

  var s = new Sample(buffer, destination || this.output, opts, event)
  s.id = this.nextId++
  tracked[s.id] = s
  s.onended = function () { delete tracked[s.id] }
  s.start(when, duration)
  return s
}

/**
 * Stop some or all of the playing samples
 *
 * @name player.stop
 * @function
 * @param {Float} when - the time to schedule the stop
 * @param {Integer|Array<Integer>} ids - (Optional) the ids of the samples to
 * stop or stop all samples if no value is provided
 *
 * @example
 * var player = new Player(ac.destination, { loop: true })
 * player.start(drumLoop1)
 * player.start(drumLoop2)
 * player.start(drumLoop3)
 * player.stop(ac.currentTime + 10) // stop all loops after 10 seconds
 */
Player.prototype.stop = function (when, ids) {
  when = when || 0
  var tracked = this._playing

  function stopById (id) {
    var p = tracked[id]
    if (!p) return null
    p.stop()
    delete tracked[id]
    return id
  }

  if (!ids) return Object.keys(tracked).map(stopById)
  else if (Array.isArray(ids)) return ids.map(stopById)
  else return stopById(ids)
}

/**
 * Set player destination
 *
 * If you pass an audio destination in the Player constructor, you won't need
 * to call this method
 *
 * @name player.connect
 * @function
 * @param {AudioNode} destination - the sample destination
 * @return {Player} the player (chainable function)
 *
 * @example
 * var player = new Player(ac)
 * player.connect(ac.destination)
 * // same as:
 * var player = new Player(ac.destination)
 */
Player.prototype.connect = function (destination) {
  this.output.connect(destination)
  return this
}

Player.Sample = Sample

if (typeof module === 'object' && module.exports) module.exports = Player
if (typeof window !== 'undefined') window.Player = Player

// /////////////////////////////// PRIVATE  /////////////////////////////// //

/**
 * Create a hash accessor
 * @private
 */
function from (a, b, c) {
  return function (name) {
    return name in a ? a[name] : (name in b ? b[name] : c[name])
  }
}

/**
 * Get playback rate for a given pitch change (in cents)
 *
 * Basic [math](http://www.birdsoft.demon.co.uk/music/samplert.htm):
 * f2 = f1 * 2^( C / 1200 )
 * @private
 */
function centsToRate (cents) { return Math.pow(2, cents / 1200) }

/**
 * Create an ADSR envelope with the adsr options
 * @private
 */
function adsr (ac, adsr) {
  return ['attack', 'decay', 'sustain', 'release'].reduce(function (env, n, i) {
    env[n] = adsr[i]
    return env
  }, ADSR(ac))
}
