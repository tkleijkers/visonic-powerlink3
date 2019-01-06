# visonic-powerlink3

Allows you to get and set the status of a Visonic security system (i.e. arm or disarm it) via its PowerLink3 communication module and server

## Install

```bash
$ npm install --save visonic-powerlink3
```

## Usage

```javascript
var PowerLink3 = require("visonic-powerlink3");

var PowerLink3 = new PowerLink3({
	host: "visonic.tycomonitor.com",
	userCode: "your-pin-code",
	appType: "com.visonic.PowerMaxApp",
	userId: "generated-guid",
	panelWebName: "your-panel-web-name"
});

PowerLink3.getStatus(function (error, status) {

	if (error) {
		console.log(`Error getting status: ${error}`);
		return;
	}

	console.log(`Status: ${status}`); //=> Status: disarmed
});

PowerLink3.setStatus(PowerLink3.STATUSES.ARMED_HOME, function (error) {

	if (error) {
		console.log(`Error getting status: ${error}`);
		return;
	}

	console.log(`Status set successfully`);
});

```

## API

### PowerLink3

#### STATUSES

Map of possible statuses

* `DISARMED`
* `ARMED_HOME`
* `ARMED_AWAY`
* `EXIT_DELAY` – Can only get, not set, this status. Occurs when the system has begun arming; allowing people to exit.
* `UNKNOWN` – Can only get, not set, this status.

#### new PowerLink3(config, [log])

* `config` **Object**

	- `host` **string** – The IP address, or hostname, of the PowerLink3. (The IP address will match your router's, but with the last block being `.200`, if DHCP is used)

	- `userCode` **string** – The pin code you use to disarm or arm the system

	- `appType` **string** – Default: com.visonic.PowerMaxApp

    - `userId` **string** – A newly generated GUID

	- `panelWebName` **string** – The panel web name as used in the Visonic GO app

	- `debug` optional **boolean** – Turns on extensive logging, to help debug issues, when set to `true` (default: `false`)

* `log` optional **Function** - Logging function

**getStatus(callback)**

Get the current system status

* `callback` **Function** - Callback to call with the status or error (error, status). Status will be a value from `PowerLink3.STATUSES`

**setStatus(status, callback)**

Sets the system status (i.e. arms or disarms the system)

* `status` **string** - The status to set. Use a value from `PowerLink3.STATUSES`
* `callback` **Function** - Callback to call (error)