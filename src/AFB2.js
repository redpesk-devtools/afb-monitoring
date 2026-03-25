/*
 * Copyright (C) 2015-2026 IoT.bzh Company
 * Author: José Bollo <jose.bollo@iot.bzh>
 *
 * $RP_BEGIN_LICENSE$
 * Commercial License Usage
 *  Licensees holding valid commercial IoT.bzh licenses may use this file in
 *  accordance with the commercial license agreement provided with the
 *  Software or, alternatively, in accordance with the terms contained in
 *  a written agreement between you and The IoT.bzh Company. For licensing terms
 *  and conditions see https://www.iot.bzh/terms-conditions. For further
 *  information use the contact form at https://www.iot.bzh/contact.
 *
 * GNU General Public License Usage
 *  Alternatively, this file may be used under the terms of the GNU General
 *  Public license version 3. This license is as published by the Free Software
 *  Foundation and appearing in the file LICENSE.GPLv3 included in the packaging
 *  of this file. Please review the following information to ensure the GNU
 *  General Public License requirements will be met
 *  https://www.gnu.org/licenses/gpl-3.0.html.
 * $RP_END_LICENSE$
 */
"use strict";

/*
 * constants defining errors
 */
const AFB_ERRNO_INTERNAL_ERROR     =  -1;
const AFB_ERRNO_OUT_OF_MEMORY      =  -2;
const AFB_ERRNO_UNKNOWN_API        =  -3;
const AFB_ERRNO_UNKNOWN_VERB       =  -4;
const AFB_ERRNO_NOT_AVAILABLE      =  -5;
const AFB_ERRNO_UNAUTHORIZED       =  -6;
const AFB_ERRNO_INVALID_TOKEN      =  -7;
const AFB_ERRNO_FORBIDDEN          =  -8;
const AFB_ERRNO_INSUFFICIENT_SCOPE =  -9;
const AFB_ERRNO_BAD_API_STATE      = -10;
const AFB_ERRNO_NO_REPLY           = -11;
const AFB_ERRNO_INVALID_REQUEST    = -12;
const AFB_ERRNO_NO_ITEM            = -13;
const AFB_ERRNO_BAD_STATE          = -14;
const AFB_ERRNO_DISCONNECTED       = -15;
const AFB_ERRNO_TIMEOUT            = -16;

/* computation of connection URL */
function getURL(desc) {
	function get(key) { return desc && desc[key]; }
	var protocol = get(protocol) || window.location.protocol;
	var hostname = get(hostname) || window.location.hostname;
	var port = get(port) || window.location.port;
	var path = get(path) || "api";
	protocol = protocol == "http:" ? "ws:" : "wss:";
	return protocol + "//" + hostname + ":" + port + '/' + path;
}

/* helper for adding argument to url */
function urlAddArg(url, key, value) {
	return url + (url.indexOf('?') < 0 ? '?' : '&') + key + '=' + value;
}

/* Websocket connection to the given URL */
function connectAfbWebsocket(url, onOpened, onAborted, token, session) {

	/* known websocket protocols and their handler */
	const PROTOCOLS = {
		"x-afb-ws-rpc":   onConnectionAfbRPC,
		"x-afb-ws-json1": onConnectionAfbWSJ1
	};

	/* compute the URL */
	/* note that WebSocket does not allow to add headers */
	var u = url;
	if (token)
		u = urlAddArg(u, 'x-afb-token', token);
	if (session)
		u = urlAddArg(u, 'x-afb-uuid', session);

	/* create the web socket and set it up */
	var ws = new WebSocket(u, Object.keys(PROTOCOLS));
	ws.binaryType = "arraybuffer";
	ws.onopen = function(evt) {
		PROTOCOLS[ws.protocol](ws, onOpened, url, token, session);
	};
	ws.onclose = function(evt) {
		onAborted(evt.reason);
	};
}

/*
 * onConnection manages a websocket instance 'ws'
 * and its conversationnal state: pending calls,
 * event listeners, ....
 *
 * Messages coding and decoding is delegated to the received
 * interface 'itf'. This interface must implement 3 functions
 * as documented below.
 */
function onConnection(ws, itf, onOpened, url, token, session) {

	/* map of pending calls: array of onReply functions */
	var pendings = {};
	/* map of event listeners: array of functions to call */
	var awaitens = {};
	/* message id generator */
	var counter = 0;

	/* add an event handler */
	function addEvent(name, handler) {
		var list = awaitens[name] || (awaitens[name] = []);
		if (!list.includes(handler))
			list.push(handler);
	}

	/* drop an event handler */
	function dropEvent(name, handler) {
		var list = awaitens[name];
		if (list && list.includes(handler))
			awaitens[name] = list.filter((hndl) => hndl != handler);
	}

	/* close the connection */
	function close() {
		ws.close();
	}

	/* call a method */
	function call(api, verb, args, onReply) {
		do {
			counter = 32767 & (counter + 1)
		} while ((counter == 0) || (counter in pendings));
		pendings[counter] = onReply;
		ws.send(itf.getCall(counter, api, verb, args));
	}

	/* call a method */
	function callPromise(api, verb, args) {
		return new Promise(function (resolve, reject) {
			call(api, verb, args,
				function(rc, obj) {
					(rc < 0 ? reject : resolve)(obj); });
		});
	}

	/* build the item to use */
	var item = {
		url: url,
		addEvent: addEvent,
		dropEvent: dropEvent,
		close: close,
		call: call,
		callPromise: callPromise,
		protocol: ws.protocol
	};

	/* fire the event of key to its listeners */
	function fire(key, args, name) {
		var a = awaitens[key];
		if (a)
			a.forEach((handler) => handler(args, name));
	}

	/* fire the event to its listeners */
	function onevent(name, args) {

		fire(name, args, name);
		var i = name.indexOf("/");
		if (i >= 0)
			fire(name.substring(0, i), args, name);
		fire("*", args, name);
	}

	/* report a reply */
	function onreply(id, rc, args) {
		var fun = pendings[id];
		if (fun) {
			delete pendings[id];
			try { fun(rc, args); } catch (x) {/*TODO?*/}
		}
	}

	/* handle of the websocket: onerror */
	ws.onerror = function(event) {
		var fun = item.onError;
		if (fun)
			try { fun(); } catch(x) {/*NOTHING*/ }
	}

	/* handle of the websocket: onclose */
	ws.onclose = function(event) {
		var pends = pendings;
		pendings = {};
		for (var id in pends) {
			try { itf.disconnected(id, pends[id]); } catch (x) {/*NOTHING*/}
		}
		var fun = item.onClose;
		if (fun)
			try { fun(); } catch(x) {/*NOTHING*/ }
	}

	/* handle of the websocket: onmessage */
	ws.onmessage = function(event) {
		try { itf.onMessage(event.data, onreply, onevent); } catch(x) { /*NOTHING*/ }
	}

	/* activation */
	onOpened(item);
}

/*****************************************************************************/
/*****************************************************************************/
/**              AFBWSJ1 connection                                         **/
/*****************************************************************************/
/*****************************************************************************/

function onConnectionAfbWSJ1(ws, onOpened, url, token, session) {

	const CALL = 2;
	const RETOK = 3;
	const RETERR = 4;
	const EVENT = 5;

	var itf = {
		getCall: function(id, api, verb, args) {
			var request = args.length == 1 ? args[0] : args;
			return JSON.stringify([CALL, String(id), String(api)+'/'+String(verb), request]);
		},

		onMessage: function(data, onReply, onEvent) {
			var obj = JSON.parse(event.data);
			var code = obj[0];
			var id = obj[1];
			var args = Array(obj[2]);
			switch (code) {
			case RETOK:
				onReply(Number(id), 0, args);
				break;
			case RETERR:
				onReply(Number(id), -1, args);
				break;
			case EVENT:
			default:
				onEvent(id, args);
				break;
			}
		},

		disconnected: function(id, onReply) {
			const msg = [{
				jtype: 'afb-reply',
				request: {
					status: 'disconnected',
					info: 'server hung up'
				}}];
			onReply(id, AFB_ERRNO_DISCONNECTED, msg);
		}
	};

	onConnection(ws, itf, onOpened, url, token, session);
}

/*****************************************************************************/
/*****************************************************************************/
/**              AFBWSRPC connection                                        **/
/*****************************************************************************/
/*****************************************************************************/

function onConnectionAfbRPC(ws, onOpened, url, token, session) {

	var seqno = 0;
	var curver = 0;
	var seqno = 0;
	var res = new remoteRes();

	function nextSeqno() {
		return seqno = (((1 + seqno) & 65535) || 1);
	}

	var itf = {
		getCall: function(id, api, verb, args) {
			return encodeRequest(id, api, verb, args, nextSeqno);
		},

		onMessage: function(data, onReply, onEvent) {
			var rd = new reader(data);

			if (curver != 3) {
				var tag = rd.u8();
				var ver = rd.u8();
				var len = rd.u16();
				if (tag == "v".charCodeAt(0) && ver == 3 && len == 4)
					curver = 3;
				else {
					wc.close();
					return;
				}
			}

			while (rd.remaining() > 0) {
				var msg = decodeV3(rd, res);
				switch (msg.oper) {
				case 'reply':
					onReply(msg.callid, msg.status, msg.values);
					break;
				case 'push':
				case 'broadcast':
					onEvent(msg.event, msg.values);
					break;
				case 'create':
					res.add(msg.kindid, msg.id, msg.data);
					break;
				case 'destroy':
					res.drop(msg.kindid, msg.id);
					break;
				default:
					break;
				}
			}
		},

		disconnected: function(id, onReply) {
			onReply(id, AFB_ERRNO_DISCONNECTED, []);
		}
	};

	function start(item) {
		/* build and send version offer */
		var w = new Writer(8);
		w.u8("V".charCodeAt(0)); // version offer
		w.u32(0x174c1409);       // protocol tag
		w.u8(1);                 // count of handled versions
		w.u8(3);                 // version 3 only
		w.align(8);              // align
		ws.send(w.buf);
		onOpened(item);
	}

	onConnection(ws, itf, start, url, token, session);
}

/*****************************************************************************/
/** read/write primitives **/

/* translation from and to UTF8 */
var utf8Decoder = new TextDecoder();
var utf8Encoder = new TextEncoder();

/* compute alignment: return the newt base aligned on 'align' block */
function aligned(base, align) {
	var rest = base % align;
	return rest == 0 ? base : base + align - rest;
}

/* counter class */
class counter {
	constructor() { this.pos = 0; }
	get length() { return this.pos; }
	align(x) { this.pos = aligned(this.pos, x); }
	copy(buf) { this.pos += buf.length; }
	u8(x) { this.pos++; }
	u16(x) { this.pos += 2; }
	u32(x) { this.pos += 4; }
	u64(x) { this.pos += 8; }
	i8(x) { this.pos++; }
	i16(x) { this.pos += 2; }
	i32(x) { this.pos += 4; }
	i64(x) { this.pos += 8; }
	f32(x) { this.pos += 4; }
	f64(x) { this.pos += 8; }
	u16be(x) { this.pos += 2; }
	u32be(x) { this.pos += 4; }
	u64be(x) { this.pos += 8; }
	i16be(x) { this.pos += 2; }
	i32be(x) { this.pos += 4; }
	i64be(x) { this.pos += 8; }
	f32be(x) { this.pos += 4; }
	f64be(x) { this.pos += 8; }
};

/* Writer class */
class Writer {
	
	constructor(len) { this.pos = 0; this.buf = new ArrayBuffer(len); this.view = new DataView(this.buf); }
	get length() { return this.pos; }
	_(n) { let x = this.pos; this.pos += n; return x; }
	align(x) {
		var nxt = aligned(this.pos, x);
		while (this.pos < nxt)
			this.u8(0);
	}
	copy(buf) { new Uint8Array(this.buf).set(buf, this._(buf.length)); }
	u8(x) { this.view.setUint8(this._(1), x); }
	u16(x) { this.view.setUint16(this._(2), x, true); }
	u32(x) { this.view.setUint32(this._(4), x, true); }
	u64(x) { this.view.setBigUint64(this._(8), x, true); }
	i8(x) { this.view.setInt8(this._(1), x, true); }
	i16(x) { this.view.setInt16(this._(2), x, true); }
	i32(x) { this.view.setInt32(this._(4), x, true); }
	i64(x) { this.view.setBigInt64(this._(8), x, true); }
	f32(x) { this.view.setFloat32(this._(4), x, true); }
	f64(x) { this.view.setFloat64(this._(8), x, true); }
	u16be(x) { this.view.setUint16(this._(2), x, false); }
	u32be(x) { this.view.setUint32(this._(4), x, false); }
	u64be(x) { this.view.setBigUint64(this._(8), x, false); }
	i16be(x) { this.view.setInt16(this._(2), x, false); }
	i32be(x) { this.view.setInt32(this._(4), x, false); }
	i64be(x) { this.view.setBigInt64(this._(8), x, false); }
	f32be(x) { this.view.setFloat32(this._(4), x, false); }
	f64be(x) { this.view.setFloat64(this._(8), x, false); }
};

class reader {
	constructor(buf) { this.pos = 0; this.buf = buf; this.view = buf instanceof DataView ? buf : new DataView(this.buf); }
	_(n) { let x = this.pos; this.pos += n; return x; }

	subview(length) { return new DataView(this.view.buffer, this.view.byteOffset + this._(length), length); }

	copy(length) {
		var offset = this.view.byteOffset + this._(length);
		return this.view.buffer.slice(offset, offset + length);
	}

	stringz(length) {
		if (length == 0)
			return null;
		var x = utf8Decoder.decode(this.subview(length - 1));
		this.pos += length;
		return x;
	}
	subReader(length) { return new reader(this.subview(length)); }
	remaining() { return this.view.byteLength - this.pos; }
	align(x) { this.pos = aligned(this.pos, x); }

	u8() { return this.view.getUint8(this._(1)); }
	u16() { return this.view.getUint16(this._(2), true); }
	u32() { return this.view.getUint32(this._(4), true); }
	u64() { return this.view.getBigUint64(this._(8), true); }
	i8() { return this.view.getInt32(this._(1), true); }
	i16() { return this.view.getInt32(this._(2), true); }
	i32() { return this.view.getInt32(this._(4), true); }
	i64() { return this.view.getBigInt64(this._(8), true); }
	f32() { return this.view.getFloat32(this._(4), true); }
	f64() { return this.view.getFloat64(this._(8), true); }
	u16be() { return this.view.getUint16(this._(2), false); }
	u32be() { return this.view.getUint32(this._(4), false); }
	u64be() { return this.view.getBigUint64(this._(8), false); }
	i16be() { return this.view.getInt16(this._(2), false); }
	i32be() { return this.view.getInt32(this._(4), false); }
	i64be() { return this.view.getBigInt64(this._(8), false); }
	f32be() { return this.view.getFloat32(this._(4), false); }
	f64be(x) { return this.view.getFloat64(this._(8), false); }
};

/*****************************************************************************/
/** RPC v3 constants */

const ID_OP_CALL_REQUEST = 0xffff;
const ID_OP_CALL_REPLY = 0xfffe;
const ID_OP_EVENT_PUSH = 0xfffd;
const ID_OP_EVENT_SUBSCRIBE = 0xfffc;
const ID_OP_EVENT_UNSUBSCRIBE = 0xfffb;
const ID_OP_EVENT_UNEXPECTED = 0xfffa;
const ID_OP_EVENT_BROADCAST = 0xfff9;
const ID_OP_RESOURCE_CREATE = 0xfff8;
const ID_OP_RESOURCE_DESTROY = 0xfff7;


const ID_KIND_SESSION = 0xffff;
const ID_KIND_TOKEN = 0xfffe;
const ID_KIND_EVENT = 0xfffd;
const ID_KIND_API = 0xfffc;
const ID_KIND_VERB = 0xfffb;
const ID_KIND_TYPE = 0xfffa;
const ID_KIND_DATA = 0xfff9;
const ID_KIND_KIND = 0xfff8;
const ID_KIND_CREDS = 0xfff7;
const ID_KIND_OPERATOR = 0xfff6;


const ID_PARAM_PADDING = 0x0000;
const ID_PARAM_RES_ID = 0xffff;
const ID_PARAM_RES_PLAIN = 0xfffe;
const ID_PARAM_VALUE = 0xfffd;
const ID_PARAM_VALUE_TYPED = 0xfffc;
const ID_PARAM_VALUE_DATA = 0xfffb;
const ID_PARAM_TIMEOUT = 0xfffa;


const ID_TYPE_OPAQUE = 0xffff;
const ID_TYPE_BYTEARRAY = 0xfffe;
const ID_TYPE_STRINGZ = 0xfffd;
const ID_TYPE_JSON = 0xfffc;
const ID_TYPE_BOOL = 0xfffb;
const ID_TYPE_I8 = 0xfffa;
const ID_TYPE_U8 = 0xfff9;
const ID_TYPE_I16 = 0xfff8;
const ID_TYPE_U16 = 0xfff7;
const ID_TYPE_I32 = 0xfff6;
const ID_TYPE_U32 = 0xfff5;
const ID_TYPE_I64 = 0xfff4;
const ID_TYPE_U64 = 0xfff3;
const ID_TYPE_FLOAT = 0xfff2;
const ID_TYPE_DOUBLE = 0xfff1;
const ID_TYPE_I16_BE = 0xfff0;
const ID_TYPE_U16_BE = 0xffef;
const ID_TYPE_I32_BE = 0xffee;
const ID_TYPE_U32_BE = 0xffed;
const ID_TYPE_I64_BE = 0xffec;
const ID_TYPE_U64_BE = 0xffeb;
const ID_TYPE_FLOAT_BE = 0xffea;
const ID_TYPE_DOUBLE_BE = 0xffe9;

/*****************************************************************************/
/** RPC v3 decoding */

/* this class handles the recording of declared remote resources */
class remoteRes {
	constructor() { this.items = {}; }
	add(kind, id, value) {
		var u = this.items[kind] || (this.items[kind] = {});
		u[id] = value;
	}
	drop(kind, id) {
		var u = this.items[kind];
		if (u)
			delete u[id];
	}
	get(kind, id) {
		var u = this.items[kind];
		return u && u[id];
	}
}

function decodeTypedValue(rd, typeid, len)
{
	switch (typeid) {
	case ID_TYPE_OPAQUE:	return rd.copy(len);
	case ID_TYPE_BYTEARRAY:	return rd.copy(len);
	case ID_TYPE_STRINGZ:	return rd.stringz(len);
	case ID_TYPE_JSON:	return JSON.parse(rd.stringz(len));
	case ID_TYPE_BOOL:	return rd.u8() != 0;
	case ID_TYPE_I8:	return rd.i8();
	case ID_TYPE_U8:	return rd.u8();
	case ID_TYPE_I16:	return rd.i16();
	case ID_TYPE_U16:	return rd.u16();
	case ID_TYPE_I32:	return rd.i32();
	case ID_TYPE_U32:	return rd.u32();
	case ID_TYPE_I64:	return rd.i64();
	case ID_TYPE_U64:	return rd.u64();
	case ID_TYPE_FLOAT:	return rd.f32();
	case ID_TYPE_DOUBLE:	return rd.f64();
	case ID_TYPE_I16_BE:	return rd.i16be();
	case ID_TYPE_U16_BE:	return rd.u16be();
	case ID_TYPE_I32_BE:	return rd.i32be();
	case ID_TYPE_U32_BE:	return rd.u32be();
	case ID_TYPE_I64_BE:	return rd.i64be();
	case ID_TYPE_U64_BE:	return rd.u64be();
	case ID_TYPE_FLOAT_BE:	return rd.f32be();
	case ID_TYPE_DOUBLE_BE:	return rd.f64be();
	default:		return rd.copy(len);
	}
}

function decodeParam(rd, res) {
	var type, length, res;

	rd.align(2);
	type = rd.u16();
	while (type == ID_PARAM_PADDING)
		type = rd.u16();
	length = rd.u16();

	res = {};
	switch (type) {
	case ID_PARAM_RES_ID:
		res.family = 'resource';
		res.kindid = rd.u16();
		res.id = rd.u16();
		break;
	case ID_PARAM_RES_PLAIN:
		res.family = 'resource';
		res.kindid = rd.u16();
		res.data = rd.subview(length - 6);
		break;
	case ID_PARAM_VALUE:
		res.family = 'value';
		res.data = rd.subview(length - 4);
		break;
	case ID_PARAM_VALUE_TYPED:
		res.family = 'value';
		res.typeid = rd.u16();
		res.data = decodeTypedValue(rd, res.typeid, length - 6);
		break;
	case ID_PARAM_VALUE_DATA:
		res.family = 'value';
		res.id = rd.u16();
		break;
	case ID_PARAM_TIMEOUT:
		res.family = 'timeout';
		res.value = rd.u16();
		break;
	default:
		return false;
	}
	return res;
}

function decodeValues(rd, res, nvals) {
	var values = [];
	while (rd.remaining() > 0) {
		var item = decodeParam(rd, res);
		if (item.family == 'value')
			values.push(item.data);
	}
	return values;
}

function decodeRequest(rd, res) {
	var callid = rd.u16();
	var nvals = rd.u16();
	var values = [];
	var params = [];
	while (rd.remaining() > 0) {
		var item = decodeParam(rd, res);
		if (res.family == 'value')
			values.push(item);
		else
			params.push(item);
	}
	return { oper: 'request', callid, values, params };
}

function decodeReply(rd, res) {
	var callid = rd.u16();
	var nvals = rd.u16();
	var status = rd.i32();
	var values = decodeValues(rd, res, nvals);
	return { oper: 'reply', callid, status, values };
}

function decodePush(rd, res) {
	var eventid = rd.u16();
	var nvals = rd.u16();
	var args = decodeValues(rd, res, nvals);
	return { oper: 'push', eventid, args };
}

function decodeSubscribe(rd, res) {
	var callid = rd.u16();
	var eventid = rd.u16();
	return { oper: 'subscribe', callid, eventid };
}

function decodeUnsubscribe(rd, res) {
	var callid = rd.u16();
	var eventid = rd.u16();
	return { oper: 'unsubscribe', callid, eventid };
}

function decodeUnexpectedEvent(rd, res) {
	var eventid = rd.u16();
	return { oper: 'unexpected', eventid };
}

function decodeBroadcast(rd, res) {
	var nvals = rd.u16();
	var length = rd.u16();
	var uuid = rd.copy(16);
	var hop = rd.u8();
	var event = rd.stringz(length);
	var args = decodeValues(rd, res, nvals);
	return { oper: 'broadcast', event, uid, hop, args };
}

function decodeResourceCreate(rd, res) {
	var kindid = rd.u16();
	var id = rd.u16();
	var data = rd.subview(rd.remaining());
	return { oper: 'create', kindid, id, data };
}

function decodeResourceDestroy(rd, res) {
	var kindid = rd.u16();
	var id = rd.u16();
	return { oper: 'destroy', kindid, id };
}

function decodeV3(rd, res) {

	rd.align(8);
	var oper = rd.u16();
	var seqn = rd.u16();
	var leng = rd.u32();
	var subr = rd.subReader(leng - 8);
	rd.align(8);

	switch (oper) {
	case ID_OP_CALL_REQUEST:
		return decodeRequest(subr, res);
	case ID_OP_CALL_REPLY:
		return decodeReply(subr, res);
	case ID_OP_EVENT_PUSH:
		return decodePush(subr, res);
	case ID_OP_EVENT_SUBSCRIBE:
		return decodeSubscribe(subr, res);
	case ID_OP_EVENT_UNSUBSCRIBE:
		return decodeUnsubscribe(subr, res);
	case ID_OP_EVENT_UNEXPECTED:
		return decodeUnexpectedEvent(subr, res);
	case ID_OP_EVENT_BROADCAST:
		return decodeBroadcast(subr, res);
	case ID_OP_RESOURCE_CREATE:
		return decodeResourceCreate(subr, res);
	case ID_OP_RESOURCE_DESTROY:
		return decodeResourceDestroy(subr, res);
	default:
		return false;
	}
}

/*****************************************************************************/
/** RPC v3 encoding */

function encodeParamPlainStringz(w, kind, value) {
	var buf = utf8Encoder.encode(value);
	w.align(2);
	w.u16(ID_PARAM_RES_PLAIN);
	w.u16(buf.length + 1 + 6);
	w.u16(kind);
	w.copy(buf);
	w.u8(0);
}

function encodeTypedValueHeader(w, kind, align, length) {
	w.align(2)
	while ((w.length + 6) % align != 0)
		w.u16(ID_PARAM_PADDING);
	w.u16(ID_PARAM_VALUE_TYPED);
	w.u16(length + 6);
	w.u16(kind);
}

function encodeTypedValue(w, kind, align, length, value, fun) {
	encodeTypedValueHeader(w, kind, align, length);
	fun(w, value);
}

function getBasicEncFunc(kind, length, funam) {
	const align = length < 2 ? 2 : length;
	return function(w, value) {
		encodeTypedValueHeader(w, kind, align, length);
		w[funam].apply(w, [value]);
	}
}

function encodeValueBool(w, value) {
	encodeTypedValueHeader(w, ID_TYPE_BOOL, 2, 1);
	w.u8(Number(value));
}

function encodeValueByteArray(w, value) {
	encodeTypedValueHeader(w, ID_TYPE_BYTEARRAY, 2, value.length);
	w.copy(value);
}

function encodeValueStringz(w, value) {
	var buf = utf8Encoder.encode(value);
	encodeTypedValueHeader(w, ID_TYPE_STRINGZ, 2, buf.length + 1);
	w.copy(buf);
	w.u8(0);
}

function encodeValueJSON(w, value) {
	var buf = utf8Encoder.encode(JSON.stringify(value));
	encodeTypedValueHeader(w, ID_TYPE_JSON, 2, buf.length + 1);
	w.copy(buf);
	w.u8(0);
}

const valueEncoders = {
	bytearray: encodeValueByteArray,
	strinz: encodeValueStringz,
	json: encodeValueJSON,
	bool: encodeValueBool,

	i8: getBasicEncFunc(ID_TYPE_I8, 1, "i8"),
	u8: getBasicEncFunc(ID_TYPE_U8, 1, "u8"),
	i16: getBasicEncFunc(ID_TYPE_I16, 2, "i16"),
	u16: getBasicEncFunc(ID_TYPE_U16, 2, "u16"),
	i32: getBasicEncFunc(ID_TYPE_I32, 4, "i32"),
	u32: getBasicEncFunc(ID_TYPE_U32, 4, "u32"),
	i64: getBasicEncFunc(ID_TYPE_I64, 8, "i64"),
	u64: getBasicEncFunc(ID_TYPE_U64, 8, "u64"),
	f32: getBasicEncFunc(ID_TYPE_FLOAT, 4, "f32"),
	f64: getBasicEncFunc(ID_TYPE_DOUBLE, 8, "f64"),

	i16be: getBasicEncFunc(ID_TYPE_I16_BE, 2, "i16be"),
	u16be: getBasicEncFunc(ID_TYPE_U16_BE, 2, "u16be"),
	i32be: getBasicEncFunc(ID_TYPE_I32_BE, 4, "i32be"),
	u32be: getBasicEncFunc(ID_TYPE_U32_BE, 4, "u32be"),
	i64be: getBasicEncFunc(ID_TYPE_I64_BE, 8, "i64be"),
	u64be: getBasicEncFunc(ID_TYPE_U64_BE, 8, "u64be"),
	f32be: getBasicEncFunc(ID_TYPE_FLOAT_BE, 4, "f32be"),
	f64be: getBasicEncFunc(ID_TYPE_DOUBLE_BE, 8, "f64be")
};

function encodeReq(id, api, verb, args, w, seqno, length) {

	var param;

	if (!(args instanceof Array))
		args = [ args ];

	w.u16(ID_OP_CALL_REQUEST)
	w.u16(seqno)
	w.u32(length)

	w.u16(id)
	w.u16(args.length)

	encodeParamPlainStringz(w, ID_KIND_API, api);
	encodeParamPlainStringz(w, ID_KIND_VERB, verb);

	for(param of args) {
		var typ = "json";
		var value = param;
		switch(typeof param) {
		case "boolean":
			typ = "bool";
			break;
		case "number":
			if (!Number.isSafeInteger(param))
				typ = "f64";
			else if (param <= 2147483647 && param >= -2147483648)
				typ = "i32";
			else
				typ = "i64";
			break;
		case "string":
			typ = "stringz";
			break;
		case "object":
			if (param instanceof ArrayBuffer) {
				typ = "bytearray";
			}
			else if ("@type" in param && "@value" in param) {
				typ = param["@type"];
				value = param["@value"];
			}
			break;
		}
		var encoder = valueEncoders[typ] || encodeValueJSON;
		encoder(w, value);
	}
}


function encodeRequest(id, api, verb, args, seqno) {
	var cnt = new counter();
	encodeReq(id, api, verb, args, cnt, 0, 0);
	var len = cnt.length;
	var wrt = new Writer(len);
	encodeReq(id, api, verb, args, wrt, seqno, len);
	return wrt.buf;
}

