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
 * constants defining standard errors
 */
export const AFB_ERRNO_INTERNAL_ERROR     =  -1;
export const AFB_ERRNO_OUT_OF_MEMORY      =  -2;
export const AFB_ERRNO_UNKNOWN_API        =  -3;
export const AFB_ERRNO_UNKNOWN_VERB       =  -4;
export const AFB_ERRNO_NOT_AVAILABLE      =  -5;
export const AFB_ERRNO_UNAUTHORIZED       =  -6;
export const AFB_ERRNO_INVALID_TOKEN      =  -7;
export const AFB_ERRNO_FORBIDDEN          =  -8;
export const AFB_ERRNO_INSUFFICIENT_SCOPE =  -9;
export const AFB_ERRNO_BAD_API_STATE      = -10;
export const AFB_ERRNO_NO_REPLY           = -11;
export const AFB_ERRNO_INVALID_REQUEST    = -12;
export const AFB_ERRNO_NO_ITEM            = -13;
export const AFB_ERRNO_BAD_STATE          = -14;
export const AFB_ERRNO_DISCONNECTED       = -15;
export const AFB_ERRNO_TIMEOUT            = -16;

/*
 * computation of connection URL
 *
 * returns params.protocol//params.hostname:params.port/params.path
 *
 * but if protocol, hostname or port is not defined, use the
 * value found in window.location if it exists
 *
 * If no part is found in params or window.location, use the default
 * value coming from ws://localhost:1234/api
 */
export
function getURL(params) {
  function get(key, def) {
    return params?.[key] || def;
  };
  function getw(key, def) {
    return params?.[key] || window?.location?.[key] || def;
  };
  var protocol = getw('protocol', 'ws:');
  var hostname = getw('hostname', 'localhost');
  var port = String(getw('port', '1234'));
  var path = get('path', 'api');
  protocol = [ "http:", "ws:" ].indexOf(protocol) >= 0 ? "ws:" : "wss:";
  return protocol + "//" + hostname + ":" + port + '/' + path;
}

/*
 * Class for managing connection to AFB using websocket protocol
 *
 * Instances of this class are passed to the 'onopen' callback
 * when the connection to AFB service successed.
 *
 * Each instance has the below fields:
 *
 * - call: is a function (api, verb, args, onreply) where 'api' is
 *   the name (string) of the API, 'verb' is the name (string) of the
 *   verb to invoke within the API, 'args' is an array of parameters
 *   to the call, 'onreply' is a function (rc, values) that will be
 *   called with the result of invocation.
 *
 * - callPromise: is a function (api, verb, args) returning a Promise
 *   that will invoke the verb of the API with the args (like function
 *   call above) and the promise will resolve or reject with an array
 *   [rc, values] where rc is a number (negative for reject and positive
 *   or null for resolve) and values is an array of values.
 *
 * - addEvent: is a function (name, handler) that record the event
 *   handler for events matching 'name'. the handler is a function
 *   (values, name) that receives the name (string) of the event and
 *   the values attached (an array).
 *
 * - dropEvent: is a function (name, handler) that removes a previously
 *   event handler recorded with addEvent. If handler is not given or
 *   is falsy, any handlers of name are removed.
 *
 * - close; fis a function () that closes the connection.
 *
 * - url: is the connction URL
 *
 * - protocol: is the current protocol (string being json1 or rpc)
 *
 * - parameters: is the parameters given to afbWsConnect at connection.
 *
 * In more, applications can add the below fields for handling some event.
 *
 * - onclose: if defined this function() is called when the connection is closed
 *
 * - onerror: if defined this function() is called when an error is reported
 */
export
class AfbWs {
};

/*
 * Websocket connection to an AFB service
 *
 * Takes one parameter, an object with one mandatory field: 'onopen'.
 * The fields are:
 *
 * - url: the url for connecting. If missing, a default url is
 *        computed based on other fields ('protocol', 'hostname',
 *        'port', 'path') or is present the current window.location.
 *
 * - onopen: a function receiving (afbws), an AfbWs object when websocket
 *           link is correctly opened
 *
 * - onabort: a function receiving (reason, url) the reason of the failure
 *            and the url of the connection
 *
 * - expected: a string or an array of allowed type of connections.
 *             currently possible protocols are: 'rpc', 'json1'
 *
 * - protocol: if url misses, the protocol to use
 *
 * - hostname: if url misses, the hostname to use
 *
 * - port: if url misses, the port to use
 *
 * - path: if url misses, the path to use
 */
export
function afbWsConnect(params) {

  /* check params and its callbacks */
  if (!params)
    throw new Error("Parameter is expected");
  if (!(params instanceof Object))
    throw new Error("Parameter should be an object");
  if (!params.onopen)
    throw new Error("Parameter should have an 'onopen' property");
  if (!(params.onopen instanceof Function))
    throw new Error("Property 'onopen' should be a function");

  /* compute the url */
  var url = params.url || getURL(params);
  var fullurl = url;
  if (params.session)
    fullurl = urlAddArg(fullurl, 'x-afb-uuid', params.session);
  if (params.token)
    fullurl = urlAddArg(fullurl, 'x-afb-token', params.token);

  /* compute the protocols */
  var protocols = params.expected;
  if (!protocols)
    protocols = allprotos();
  else {
    if (!Array.isArray(protocols))
      protocols = new Array(protocols);
    protocols = protocols.map((name) => {
      name = String(name); /*in case*/
      var result = name2proto(name);
      if (!result)
        throw new Error("connection type '"+name+"' not handled");
      return result;
    });
  }

  /* create the web socket and set it up */
  var ws = new WebSocket(fullurl, protocols);
  ws.binaryType = "arraybuffer";
  ws.onopen = function(evt) {
    proto2handler(ws.protocol)(ws, url, params);
  };
  ws.onclose = function(evt) {
    params.onabort && params.onabort(evt.reason, url);
  };
}

/* helper for adding argument to url */
function urlAddArg(url, key, value) {
  return url + (url.indexOf('?') < 0 ? '?' : '&') + key + '=' + value;
}

/* known websocket protocols, their handlers, their names */
const PROTOCOLS = [
  [ 'rpc',   'x-afb-ws-rpc',   onConnectionAfbRPC ],
  [ 'json1', 'x-afb-ws-json1', onConnectionAfbWSJ1 ]
];

function name2proto(name) {
  return PROTOCOLS.find((x) => x[0] == name)?.[1];
}

function proto2name(proto) {
  return PROTOCOLS.find((x) => x[1] == proto)?.[0];
}

function proto2handler(proto) {
  return PROTOCOLS.find((x) => x[1] == proto)?.[2];
}

function allprotos() {
  return PROTOCOLS.map((x) => x[1]);
}

/*
 * onConnection manages a websocket instance 'ws'
 * and its conversationnal state: pending calls,
 * event listeners, ....
 *
 * Messages coding and decoding is delegated to the received
 * interface 'itf'. This interface must be an object with
 * 3 fields, the three being functions:
 *
 *  - getCall: function(id, api, verb, args)
 *  - onMessage: function(data, onreply, onevent)
 *  - disconnected: function(id, onreply)
 *
 * The function of the field 'getCall' receives 'id', a number
 * between 1 and 32767 to use for identifying the call.
 * 'api' and 'verb', two strings identifying the target API
 * and its target VERB, 'args', the arguments of the call.
 * The function getCall must return either a string or a
 * ArrayBuffer that will be sent to the service by the websocket.
 *
 * The function of the field 'onMessage' receives 'data', the data
 * received by the websocket, 'onreply', a function to call on a
 * reply message, and 'onevent', a function to call on an event
 * message.
 *
 * The function of the field 'disconnected' receives 'id',
 * a number identifying the call to signal and 'onreply' the function
 * to call for sending the disconnection reply.
 *
 * The functions 'onreply' received by 'onMessage' and 'disconnected'
 * take 3 arguments (id, rc, values) where 'id' is the number
 * that identify the replied call, 'rc' is a number corresponding
 * to the status of the call, and 'values', the value produced by the
 * call.
 *
 * The function 'onevent' received by 'onMessage' takes 2 arguments
 * (name, values) where 'name' is the name of the recived event and
 * 'values' is an object received attached to the event.
 */
function onConnection(ws, itf, start, url, params) {

  /* internal and hidden state */
  var state = {
    ws: ws,
    itf: itf,
    pendings: {},  /* pending calls: onreply function */
    listeners: {}, /* event listeners: array of functions */
    counter: 0     /* callid id generator */
  };

  /* add an event handler */
  function addEvent(name, handler) {
    var list = state.listeners[name] || (state.listeners[name] = []);
    if (!list.includes(handler)) {
      list.push(handler);
    }
  }

  /* drop an event handler */
  function dropEvent(name, handler) {
    var list = state.listeners[name];
    if (list) {
      if (handler)
        state.listeners[name] = list.filter((hndl) => hndl != handler);
      else
        delete state.listeners[name];
    }
  }

  /* close the connection */
  function close() {
    state.ws.close();
  }

  /* call a method */
  function call(api, verb, args, onreply) {
    do {
      state.counter = 32767 & (state.counter + 1)
    } while ((state.counter == 0) || (state.counter in state.pendings));
    state.pendings[state.counter] = onreply;
    state.ws.send(state.itf.getCall(state.counter, api, verb, args));
  }

  /* call a method */
  function callPromise(api, verb, args) {
    return new Promise(function (resolve, reject) {
      call(api, verb, args,
        function(rc, values) {
          (rc < 0 ? reject : resolve)([rc, values]); });
    });
  }

  /* build the afbws to use */
  var afbws = new AfbWs();
  afbws.url = url;
  afbws.addEvent = addEvent;
  afbws.dropEvent = dropEvent;
  afbws.close = close;
  afbws.call = call;
  afbws.callPromise = callPromise;
  afbws.protocol = proto2name(state.ws.protocol);
  afbws.parameters = params;

  /* fire the event of key to its listeners */
  function fire(key, values, name) {
    state.listeners[key]?.forEach((handler) => {
      try {
        handler(values, name);
      }
      catch(x) {
        /*nothing*/
      }
    });
  }

  /* fire the event to its listeners */
  function onevent(name, values) {
    var key = name;
    fire(key, values, name);
    var i = key.lastIndexOf("/");
    while (i > 0) {
      key = key.substring(0, i);
      fire(key + '/*', values, name);
      fire(key, values, name);
      i = key.lastIndexOf("/");
    }
    fire("*", values, name);
  }

  /* report a reply */
  function onreply(id, rc, values) {
    var fun = state.pendings[id];
    if (fun) {
      delete state.pendings[id];
      try {
        fun(rc, values);
      }
      catch (x) {
        /*NOTHING*/
      }
    }
  }

  /* handle of the websocket: onerror */
  state.ws.onerror = function(event) {
    try {
      afbws.onerror?.();
    }
    catch(x) {
      /*NOTHING*/
    }
  }

  /* handle of the websocket: onclose */
  state.ws.onclose = function(event) {
    var pends = state.pendings;
    state.pendings = {};
    for (var id in pends) {
      try {
        state.itf.disconnected(id, pends[id]);
      }
      catch (x) {
        /*NOTHING*/
      }
    }
    try {
      afbws.onclose?.();
    }
    catch(x) {
      /*NOTHING*/
    }
  }

  /* handle of the websocket: onmessage */
  state.ws.onmessage = function(event) {
    try {
      state.itf.onMessage(event.data, onreply, onevent);
    }
    catch(x) {
      close();
    }
  }

  /* activation */
  start(afbws);
}

/*****************************************************************************/
/*****************************************************************************/
/**              AFBWSJ1 connection                                         **/
/*****************************************************************************/
/*****************************************************************************/

class ItfAfbWSJ1 {

  CALL = 2;
  RETOK = 3;
  RETERR = 4;
  EVENT = 5;

  getCall(id, api, verb, args) {
    var request;
    if (Array.isArray(args))
      request = args.length == 1 ? args[0] : args.length == 0 ? null : args;
    else
      request = typeof args == 'undefined' ? null : args;
    return JSON.stringify([this.CALL, String(id), String(api)+'/'+String(verb), request]);
  }

  onMessage(data, onreply, onevent) {
    var obj = JSON.parse(typeof data == 'string' ? data : utf8Decoder.decode(data));
    var code = obj[0];
    var id = obj[1];
    var values = Array(obj[2]);
    switch (code) {
    case this.RETOK:
      onreply(Number(id), 0, values);
      break;
    case this.RETERR:
      onreply(Number(id), -1, values);
      break;
    case this.EVENT:
    default:
      onevent(id, values);
      break;
    }
  }

  disconnected(id, onreply) {
    const msg = [{
      jtype: 'afb-reply',
      request: {
        status: 'disconnected',
        info: 'server hung up'
      }}];
    onreply(id, AFB_ERRNO_DISCONNECTED, msg);
  }
};

function onConnectionAfbWSJ1(ws, url, params) {

  onConnection(ws, new ItfAfbWSJ1(), params.onopen, url, params);
}

/*****************************************************************************/
/*****************************************************************************/
/**              AFBWSRPC connection                                        **/
/*****************************************************************************/
/*****************************************************************************/

class ItfAfbRPC {

  constructor() {
    this.curver = 0;
    this.seqno = 0;
    this.res = new remoteRes();
  }

  nextSeqno() {
    return this.seqno = (((1 + this.seqno) & 65535) || 1);
  }

  getCall(id, api, verb, args) {
    args = Array.isArray(args) ? args : args == null ? [] : [args];
    return encodeRequest(id, api, verb, args, this.nextSeqno());
  }

  onMessage(data, onreply, onevent) {
    var rd = new reader(data);

    if (this.curver != 3) {
      var tag = rd.u8();
      var ver = rd.u8();
      var len = rd.u16();
      if (tag != "v".charCodeAt(0) || ver != 3 || len != 4)
  throw new Error("RPC protocol version mismatch");
      this.curver = 3;
    }

    while (rd.remaining() > 0) {
      var msg = decodeV3(rd, this.res);
      switch (msg.oper) {
      case 'reply':
        onreply(msg.callid, msg.status, msg.values);
        break;
      case 'push':
  var evn = this.res.get(ID_KIND_EVENT, msg.eventid);
        onevent(evn, msg.values);
        break;
      case 'broadcast':
        onevent(msg.event, msg.values);
        break;
      case 'create':
        this.res.add(msg.kindid, msg.id, msg.data);
        break;
      case 'destroy':
        this.res.drop(msg.kindid, msg.id);
        break;
      default:
        break;
      }
    }
  }

  disconnected(id, onreply) {
    onreply(id, AFB_ERRNO_DISCONNECTED, []);
  }
};

function onConnectionAfbRPC(ws, url, params) {

  function start(afbws) {
    /* build and send version offer */
    var w = new Writer(8);
    w.u8("V".charCodeAt(0)); // version offer
    w.u32(0x174c1409);       // protocol tag
    w.u8(1);                 // count of handled versions
    w.u8(3);                 // version 3 only
    w.align(8);              // align
    ws.send(w.buf);
    params.onopen(afbws);
  }

  onConnection(ws, new ItfAfbRPC(), start, url, params);
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
    var len = value.byteLength;
    u[id] = len ? utf8Decoder.decode(new DataView(value.buffer, value.byteOffset, len - 1)) : null;
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
  case ID_TYPE_OPAQUE:  return rd.copy(len);
  case ID_TYPE_BYTEARRAY:  return rd.copy(len);
  case ID_TYPE_STRINGZ:  return rd.stringz(len);
  case ID_TYPE_JSON:  return JSON.parse(rd.stringz(len));
  case ID_TYPE_BOOL:  return rd.u8() != 0;
  case ID_TYPE_I8:  return rd.i8();
  case ID_TYPE_U8:  return rd.u8();
  case ID_TYPE_I16:  return rd.i16();
  case ID_TYPE_U16:  return rd.u16();
  case ID_TYPE_I32:  return rd.i32();
  case ID_TYPE_U32:  return rd.u32();
  case ID_TYPE_I64:  return rd.i64();
  case ID_TYPE_U64:  return rd.u64();
  case ID_TYPE_FLOAT:  return rd.f32();
  case ID_TYPE_DOUBLE:  return rd.f64();
  case ID_TYPE_I16_BE:  return rd.i16be();
  case ID_TYPE_U16_BE:  return rd.u16be();
  case ID_TYPE_I32_BE:  return rd.i32be();
  case ID_TYPE_U32_BE:  return rd.u32be();
  case ID_TYPE_I64_BE:  return rd.i64be();
  case ID_TYPE_U64_BE:  return rd.u64be();
  case ID_TYPE_FLOAT_BE:  return rd.f32be();
  case ID_TYPE_DOUBLE_BE:  return rd.f64be();
  default:    return rd.copy(len);
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
  var values = decodeValues(rd, res, nvals);
  return { oper: 'push', eventid, values };
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
  var values = decodeValues(rd, res, nvals);
  return { oper: 'broadcast', event, uuid, hop, values };
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

