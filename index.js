var request = require("request");
var oneConcurrent = require("one-concurrent");
var retry = require("retry");

/**
 * Allows you to get and set the status of a Visonic security system (i.e. arm or disarm it) via its PowerLink3 communication module
 * 
 * @constructor
 * @param {Object} config - Config object, containing a 'host', 'userCode', 'appType', 'userId', 'panelWebName', and optionally a 'debug' boolean
 * @param {Function} [log] - Optional logging function
 */
function PowerLink3(config, log) {
	let self = this;

	self.failSafe = false; // failSafe will be turned on when authentication fails; it will cause further authentication attempts to be aborted, to prevent the PowerLink3 locking out your account for a huge amount of time

	self.log = log || console.log; // Allow a custom logging function, else default to console.log
	
	self.debug = config.debug;

	self.baseURL = 'https://' + config.host; // Would use HTTPS, but the connection fails to handshake
	self.userCode = config.userCode;
	self.appType = config.appType;
	self.userId = config.userId;
	self.panelWebName = config.panelWebName;
	self.retry = 0;

	self.timeout = config.timeout || 2500;
}

PowerLink3.STATUSES = {
	DISARMED: 'disarmed',
	ARMED_HOME: 'home',
	ARMED_AWAY: 'away',
	EXIT_DELAY: 'exit delay', // Can only get, not set, this status. Occurs when the system has begun arming; allowing people to exit.
	UNKNOWN: 'unknown' // Can only get, not set, this status.
}


/**
 * Get the current system status
 * 
 * @param  {Function} callback - Callback to call with the status or error (error, status). Status will be a value from PowerLink3.STATUSES
 */
PowerLink3.prototype.getStatus = function (callback) {
	var self = this;
	var request = {
		url: self.baseURL + '/rest_api/3.0/status',
		method: 'GET',
		headers: {
			'Content-Type': 'application/json'
		},
	 	qs: {
			user_code: self.userCode,
			app_type: self.appType,
			user_id: self.userId,
			panel_web_name: self.panelWebName
		}
	}

	var operation = retry.operation({
		retries: 3,            // try 1 time and retry 2 times if needed, total = 3
		minTimeout: 2 * 1000, // the number of milliseconds before starting the first retry
		maxTimeout: 10 * 1000  // the maximum number of milliseconds between two retries
	  });
 
	operation.attempt(function(currentAttempt) {
		self.authenticatedRequest(request, function(error, response, body) {

			self.log('Updating status (' + currentAttempt + ')');
			if (error) {
				callback(new Error(`Error getting raw status: ${error}`));
				return;
			}
	
			if (self.debug) {
				self.log(`Response from getRawState HTTP call:`)
				self.log(`response: %j`, response)
				self.log(`body: %j`, JSON.parse(body))
			}
	
			var json = JSON.parse(body);
			if (json.is_connected != true && operation.retry(new Error('Not connected'))) {
				// Not yet connected to panel
				self.log('Panel not yet connected');
				return;
			}
	
			var statusString = json.partitions[0].state;
			// statusString = "Disarm" / "HOME" / "AWAY" / unexpected
	
			let statusStringToStatus = {
				'Disarm': PowerLink3.STATUSES.DISARMED,
				'NotReady': PowerLink3.STATUSES.DISARMED,
				'Exit Delay': PowerLink3.STATUSES.EXIT_DELAY,
				'Home': PowerLink3.STATUSES.ARMED_HOME,
				'Away': PowerLink3.STATUSES.ARMED_AWAY,
			}
	
			let status = statusStringToStatus[statusString] || PowerLink3.STATUSES.UNKNOWN;
			self.lastStatus = status;
	
			callback(error, status);
		});
	});
}

/**
 * Sets the system status (i.e. arms or disarms the system)
 * 
 * @param {string} status - The status to set. Use a value from PowerLink3.STATUSES
 * @param {Function} callback - Callback to call (error)
 */
PowerLink3.prototype.setStatus = function (status, callback) {
	var self = this;

	let urlMap = {};
	urlMap[PowerLink3.STATUSES.DISARMED] = '/rest_api/3.0/disarm';
	urlMap[PowerLink3.STATUSES.ARMED_HOME] = '/rest_api/3.0/arm_home';
	urlMap[PowerLink3.STATUSES.ARMED_AWAY] = '/rest_api/3.0/arm_away';

	let url = urlMap[status]; // Get the right string for use in the API call

	if (url == undefined) {
		callback(new Error(`Cannot set status to: ${status}`)); // For example: PowerLink3.STATUSES.EXIT_DELAY
		return;
	}

	self.authenticatedRequest({
		url: self.baseURL + url,
		method: 'POST',
		headers: {
			'Content-Type': 'application/json'
		},
		json: {
			'partition': 'P1'
		}
	}, 
	function (error, response, body) {

		self.log(`Response from setStatus HTTP call:`)
		self.log(`response: %j`, response)
		self.log(`body: %j`, body)

		callback(error);
	});
}

/**
 * Logs in, and gets the session-token
 * 
 * @private
 * @param  {Function} callback - Callback to call with the session-token string (error, session-token)
 */
PowerLink3.prototype.getSessionToken = function (callback) {
	var self = this;

	// "Mmmm, yummy!" – Manila Luzon

	if (self.failSafe) {
		callback(new Error("A previous authentication attempt failed; not continuing."));
		return;
	}

	if (self.sessionToken != null) { // Do we already have an session token from before?
		callback(null, self.sessionToken);
		return;
	}

	request({
		url: self.baseURL + '/rest_api/3.0/login',
		method: 'POST',
		headers: {
			'Content-Type': 'application/json'
		},
		json: {
			user_code: self.userCode,
			app_type: self.appType,
			user_id: self.userId,
			panel_web_name: self.panelWebName
		},
		timeout: self.timeout
	}, 
	function(error, response, body) {

		if (self.debug) {
			self.log(`Response from getSessionToken HTTP call:`)
			self.log(`error: ${error}`)
			self.log('response:  %j', response)
			self.log(`body: %j`, body)
		}

		if (error) { callback(error); return; }
		if (body.error != null) { callback(body.error_message); return; }
		
		self.sessionToken = body.session_token;
		self.debugLog(`Got session-token: ${self.sessionToken}`);

		callback(null, self.sessionToken);
	});
}

/**
 * Makes a HTTP request using the 'request' module, first injecting the stored authentication cookie (or grabbing one first if required)
 *
 * @private
 * @param {Object} config - Configuration object, in the format that the 'request' module expects
 * @param {Function} callback - Callback to call (error, response, body)
 */
PowerLink3.prototype.authenticatedRequest = function (config, callback) {
	let self = this;

	oneConcurrent(function (callback) {
		self.getSessionToken(callback);

	}, function (error, sessionToken) {

		if (error) { 
			callback(new Error(`Failed to get authentication session-token: ${error}`)); 
			return; 
		}

		config.headers = config.headers || {};
		config.headers['Session-Token'] = sessionToken

		config.timeout = config.timeout || self.timeout;

		request(config, function (error, response, body) {

			if (!error) {

				// Check whether we're not logged in anymore
				if (response.statusCode == 440) {

					self.debugLog(`Our session-token probably isn't valid anymore - let's get another one`);

					self.sessionToken = null; // Invalidate the cookie we have

					setTimeout(function () {
						self.authenticatedRequest(config, callback); // Re-run this request, fetching a new cookie in the meantime
					}, 3*1000); // Sane retry delay
					
					return;
				}
			}

			callback(error, response, body); // Continue as normal
		});
	});
}

/** 
 * Logging function which will only actually log if self.debug is true. Can be passed anything you'd pass to config.log
 * 
 * @private
 * @param {...*} value - Value to log
 */
PowerLink3.prototype.debugLog = function () {
	let self = this;
	
	if (self.debug) 
		self.log.apply(self, arguments);
}

module.exports = PowerLink3;
