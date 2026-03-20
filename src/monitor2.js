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

var ws;

var t_api;
var t_verb;
var t_logmsg;
var t_traceevent;
var t_verbosity;
var t_trace;
var t_separator;

var apis = {};
var events = [];
var inhibit = false;
var msgs = false;
var autoscroll = false;

var root_node;
var connected_node;
var trace_events_node;
var logmsgs_node;
var apis_node;
var all_node;

var styles;

/* flags */
var show_perms = false;
var show_monitor_events = false;

_.templateSettings = { interpolate: /\{\{(.+?)\}\}/g };

/***************************************************************/
/* helpers for DOM *********************************************/

function at(id) { return document.getElementById(id); }
function value_at(id) { let n = at(id); return n && n.value; }

function for_all_nodes(root, sel, fun) {
	(root ? root : document).querySelectorAll(sel).forEach(fun);
}

function get(sel,x) {
	if (!x)
		x = document;
	var r = x.querySelector(sel);
	return r;
}

function plug(target, sel, node) {
	var x = get(sel, target);
	var n = target.ownerDocument.importNode(node, true);
	x.parentNode.insertBefore(n, x);
	x.parentNode.removeChild(x);
}

function class_toggle(node, assoc, defval) {
	var matched = false;
	var cs = node.className.split(" ").map(
		function(x){
			if (!matched && (x in assoc)) {
				matched = true;
				return assoc[x];
			}
			return x == defval ? "" : x;
		}).join(" ");
	if (!matched && defval)
		cs = cs + " " + defval;
	node.className = cs;
}

/***************************************************************/
/* helpers for autoscroll **************************************/

function start_autoscroll(val) {
	at("autoscroll").textContent =
		(autoscroll = val) ? "Stop scroll" : "Start scroll";
}

function toggle_autoscroll() {
	start_autoscroll(!autoscroll);
}

function show(x) {
	if (autoscroll)
		x.scrollIntoView();
}

/***************************************************************/
/* helpers for logging *****************************************/

function start_logmsgs(val) {
	at("stopmsgs").textContent =
		(msgs = val) ? "Stop logs" : "Get logs";
}

function toggle_logmsgs() {
	start_logmsgs(!msgs);
}

function drop_all_logmsgs() {
	logmsgs_node.innerHTML = "";
}

function add_logmsg(tag, content, add) {
	if (!msgs) return;
	var x = document.importNode(t_logmsg, true);
	get(".tag", x).textContent = tag;
	get(".content", x).textContent = content;
	get(".close", x).onclick = function(evt){x.remove();};
	if (add)
		x.className = x.className + " " + add;
	logmsg_add(x);
}

function logmsg_add(x) {
	if (!msgs) return;
	logmsgs_node.append(x);
	show(x);
}

/***************************************************************/
/* helpers for tracing *****************************************/

function drop_all_trace_events() {
	trace_events_node.innerHTML = "";
}

function on_toggle_traceevent(evt) {
	if (getSelection() != "") return;
	var node = evt.target;
	while(node && node.parentElement != trace_events_node)
		node = node.parentElement;
	node && toggle_opened_closed(node);
}

function trace_events_add(x) {
	trace_events_node.append(x);
	show(x);
}

/***************************************************************/
/* helpers for separators **************************************/

function add_separator() {
	trace_events_add(document.importNode(t_separator, true));
	logmsg_add(document.importNode(t_separator, true));
}

/***************************************************************/
/* helpers for managing styles *********************************/

function makecss()
{
	var i, l, a, links, x;

	x = { idx: 0, byidx: [], byname: {}, names: [] };
	links = document.getElementsByTagName("link");
	for (i = 0 ; i < links.length ; i++) {
		l = links[i];
		if (l.title && l.rel.indexOf( "stylesheet" ) != -1) {
			if (!(l.title in x.byname)) {
				x.byname[l.title] = x.byidx.length;
				x.names.push(l.title);
				x.byidx.push([]);
			}
			x.byidx[x.byname[l.title]].push(l);
		}
	}

	x.set = function(id) {
		if (id in x.byname)
			id = x.byname[id];
		if (id in x.byidx) {
			var i, j, a, b;
			x.idx = id;
			a = x.byidx;
			for (i = 0 ; i < a.length ; i++) {
				b = a[i];
				for (j = 0 ; j < b.length ; j++)
					b[j].disabled = i != id;
			}
		}
	};

	x.next = function() {
		x.set((x.idx + 1) % x.byidx.length);
	};

	x.set(0);
	return x;
}

function next_style(evt) {
	styles.next();
}

/***************************************************************/
/* helpers for managing connection *****************************/

function disconnect(status) {
	class_toggle(root_node, { on: "off" }, "off");
	connected_node.innerHTML = "Connection Closed";
	connected_node.className = status;
	if (ws) {
		untrace_all();
		ws.onClose = ws.onError = null;
		ws.close();
		ws = null;
	}
}

function connect() {
	disconnect();
	var url = getURL({ hostname: value_at("param-host"),
		           port: value_at("param-port") });
	connectAfbWebsocket(
		url,
		on_connection_success,
		function(reason) {
			disconnect("connection failed: " + reason);
		},
		value_at("param-token"),
		value_at("param-session"));
}

function on_connection_success(itf) {
	ws = itf;
	class_toggle(root_node, { off: "on" }, "on");
	connected_node.innerHTML = "Connected " + ws.url;
	connected_node.className = "ok";
	ws.addEvent("*", gotevent);
	ws.onClose = function() { disconnect("closed"); }
	untrace_all();
	for_all_nodes(all_node, ".trace-box", update_trace_box);
	do_call("monitor", "get", {apis: true, verbosity: true}, on_got_apis);
}

/***************************************************************/
/* xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx *****************************/

function init() {
	/* init styling */
	styles = makecss();
	at("style").onclick = next_style;

	/* prepare the DOM templates */
	t_api = at("t-api").content.firstElementChild;
	t_verb = at("t-verb").content.firstElementChild;
	t_logmsg = at("t-logmsg").content.firstElementChild;
	t_traceevent = at("t-traceevent").content.firstElementChild;
	t_verbosity = at("t-verbosity").content.firstElementChild;
	t_trace = at("t-trace").content.firstElementChild;
	t_separator = at("t-separator").content.firstElementChild;

	/* get interface nodes */
	root_node = at("root");
	connected_node = at("connected");
	trace_events_node = at("trace-events");
	logmsgs_node = at("logmsgs");
	apis_node = at("apis");
	all_node = at("all");

	/* plug items */
	plug(t_api, ".verbosity", t_verbosity);
	plug(t_api, ".trace", t_trace);
	plug(all_node, ".trace", t_trace);
	plug(all_node, ".verbosity", t_verbosity);
	plug(at("common"), ".verbosity", t_verbosity);

	/* connect handlers */
	for_all_nodes(root_node, ".opclo",
		function(n){n.onclick = on_toggle_opclo});
	for_all_nodes(root_node, ".opclo ~ :not(.closedoff)",
		function(n){n.onclick = on_toggle_opclo});
	for_all_nodes(root_node, ".verbosity select",
		function(n){n.onchange = set_verbosity});
	for_all_nodes(root_node, ".trace-item input",
		function(n){n.onchange = on_trace_change});
	document.onbeforeunload = on_disconnect;
	at("disconnect").onclick = on_disconnect;
	at("connect").onclick = on_connect;
	at("droptracevts").onclick = drop_all_trace_events;
	at("dropmsgs").onclick = drop_all_logmsgs;
	at("stopmsgs").onclick = toggle_logmsgs;
	at("autoscroll").onclick = toggle_autoscroll;
	at("addsep").onclick = add_separator;
	at("experts").onclick = toggle_experts;
	trace_events_node.onclick = on_toggle_traceevent;
	start_logmsgs(false);
	start_autoscroll(true);

	/* init connection */
	at("param-host").value = document.location.hostname;
	at("param-port").value = document.location.port;
	var args = new URLSearchParams(document.location.search.substring(1));
	at("param-token").value = args.get("x-afb-token") || args.get("token") || "HELLO";

	/* connect */
	connect();
}

function on_disconnect() {
	disconnect("ok");
}

function on_connect(evt) {
	connect();
}

function untrace_all() {
	do_call("monitor", "trace", {drop: true});
}

function do_call(api, verb, request, onreply) {
	var call = api + "/" + verb + "(" + JSON.stringify(request, null, 1) + ")";
	add_logmsg("send request", call, "call");
	ws.call(api, verb, [request],
		function(code, args) {
			add_logmsg("receive ", call + " -> " + String(code) + ": " + JSON.stringify(args, null, 1), code >= 0 ? "retok" : "reterr");
			if (onreply) {
				var args = args[0];
				if (args.jtype == "afb-reply")
					args = args.response;
				onreply(args);
			}
		});
}

/* show all verbosities */
function on_got_verbosities(obj) {
	inhibit = true;
	_.each(obj.verbosity, function(verbosity, api_name) {
		if (api_name == "monitor") return;
		var node = !api_name ? at("common") : api_name in apis ? apis[api_name].node : false;
		if (node)
			get(".verbosity option[value='"+verbosity+"']", node).selected = true;
	});
	inhibit = false;
}

function set_verbosity(evt) {
	if (inhibit) return;
	inhibit = true;
	var obj = evt.target;
	var req = {verbosity:{}};
	var name = obj.API ? obj.API.name : obj === get(".select", all_node) ? "*" : "";
	if (name != "*") {
		req.verbosity[name] = obj.value;
	} else {
		req.verbosity = obj.value;
	}
	inhibit = false;
	do_call("monitor", "set", req);
	do_call("monitor", "get", {verbosity:true}, on_got_verbosities);
}

/* creates an api object for the api of 'name' and return it */
function create_api(name) {
	var api = {
		node: document.importNode(t_api, true),
		verbs: {},
		name: name
	};
	api.node.API = api;
	api.node.dataset.apiname = name;
	api.vnode = get(".verbs", api.node);
	get(".name", api.node).textContent = name;
	var s = get(".verbosity select", api.node);
	s.API = api;
	s.onchange = set_verbosity;
	for_all_nodes(api.node, ".opclo", function(n){n.onclick = on_toggle_opclo});
	for_all_nodes(api.node, ".opclo ~ :not(.closedoff)", function(n){n.onclick = on_toggle_opclo});
	for_all_nodes(api.node, ".trace-item input", function(n){n.onchange = on_trace_change});
	return api;
}

function fill_api_for_info_v2(api, desc) {
	get(".desc", api.node).textContent = desc.info || "";
	_.each(desc.verbs, function(verb_desc){
		var verb_name = verb_desc.name;
		var verb = api.verbs[verb_name];
		if (!verb) {
			verb = {
				node: document.importNode(t_verb, true),
				name: verb_name,
				api: api
			};
			verb.node.VERB = verb;
			verb.node.dataset.verb = verb_name;
			api.verbs[verb_name] = verb;
			get(".name", verb.node).textContent = verb_name;
			get(".desc", verb.node).textContent = verb_desc.info || "";
			if (show_perms)
				get(".perm", verb.node).textContent = verb_desc.auth || "";
			api.vnode.append(verb.node);
		}
	});
}

function fill_api_for_legacy_description(api, desc) {
	get(".desc", api.node).textContent = desc.info.description || "";
	_.each(desc.paths, function(verb_desc, path_name){
		var verb_name = path_name.substring(1);
		var verb = api.verbs[verb_name];
		if (!verb) {
			verb = {
				node: document.importNode(t_verb, true),
				name: verb_name,
				api: api
			};
			verb.node.VERB = verb;
			verb.node.dataset.verb = verb_name;
			api.verbs[verb_name] = verb;
			get(".name", verb.node).textContent = verb_name;
			var g = verb_desc.get ||{};
			var r = g["responses"] || {};
			var t = r["200"] || {};
			var d = t.description || "";
			get(".desc", verb.node).textContent = d;
			if (show_perms) {
				var p = g["x-permissions"] || "";
				get(".perm", verb.node).textContent = p ? JSON.stringify(p, null, 1) : "";
			}
			api.vnode.append(verb.node);
		}
	});
}

function fill_api(api, desc) {
	if (desc === true) {
		get(".desc", api.node).textContent = "in progress...";
		do_call(api.name, "info", true, function(desc) {
			fill_api_for_info_v2(api, desc);
		});
	}
	else if (typeof desc == 'string') {
		get(".desc", api.node).textContent = "Alias of " + String(desc);
	}
	else if (desc === null) {
		get(".desc", api.node).textContent = "?? unrecoverable ??";
	}
	else {
		switch (desc.$shema) {
		case 'afb-api-info/v2':
			fill_api_for_info_v2(api, desc);
			break;
		default:
			fill_api_for_legacy_description(api, desc);
			break;
		}
	}
}

/* show all apis */
function on_got_apis(obj) {
	inhibit = true;
	var saved_apis = apis;
	apis = {};
	apis_node.innerHTML = "";
	_.each(obj.apis, function(api_desc, api_name) {
		if (api_name == "monitor") return;

		/* get the api node */
		var api = saved_apis[api_name]
		       || create_api(api_name);

		/* reactivate the expected traces */
		for_all_nodes(api.node, ".trace-box", update_trace_box);

		/* record in new set */
		apis[api_name] = api;
		fill_api(api, api_desc);
		apis_node.append(api.node);
	});
	inhibit = false;
	on_got_verbosities(obj);
}

function on_toggle_opclo(evt) {
	toggle_opened_closed(evt.target.parentElement);
}

function toggle_experts(evt) {
	toggle_opened_closed(evt.target);
}

function update_trace_box(node) {
	set_trace_box(node, false);
}

function set_trace_box(node, clear) {
	var api = node;
	while (api && !api.dataset.apiname)
		api = api.parentElement;
	var tag = api.dataset.apiname + "/" + node.dataset.trace;
	var value = false;
	for_all_nodes(node, "input", function(n){ if (n.checked) value = n.value; });
	if (clear)
		do_call("monitor", "trace", {drop: {tag: tag}});
	if (value != "no") {
		var spec = {tag: tag, name: "trace"};
		spec[node.dataset.trace] = value;
		if (api.dataset.apiname != "*")
			spec.apiname = api.dataset.apiname;
		do_call("monitor", "trace", {add: spec});
	}
}

function on_trace_change(evt) {
	var obj = evt.target;
	var box = obj.parentElement;
	while (box && !box.dataset.trace)
		box = box.parentElement;
	for_all_nodes(box, "input", function(n){n.checked = false;});
	obj.checked = true;
	set_trace_box(box, true);
}

function makecontent(node, deep, val) {
	if (--deep > 0) {
		if (_.isObject(val)) {
			node.append(makeobj(val, deep));
			return;
		}
		if (_.isArray(val)) {
			node.append(makearr(val, deep));
			return;
		}
	}
	node.innerHTML = '<pre>' + obj2html(val) + '</pre>';
}

function makearritem(tbl, deep, val) {
	var tr = document.createElement("tr");
	var td = document.createElement("td");
	tr.append(td);
	tbl.append(tr);
	makecontent(td, deep, val);
}

function makearr(arr, deep) {
	var node = document.createElement("table");
	node.className = "array";
	_.each(arr, function(v) { makearritem(node, deep, v);});
	return node;
}

function makeobjitem(tbl, deep, key, val) {
	var tr = document.createElement("tr");
	var td1 = document.createElement("td");
	var td2 = document.createElement("td");
	tr.className = key;
	tr.append(td1);
	td1.textContent = key;
	tr.append(td2);
	tbl.append(tr);
	makecontent(td2, deep, val);
}

function makeobj(obj, deep, ekey, eobj) {
	var node = document.createElement("table");
	node.className = "object";
	_.each(_.keys(obj).sort(), function(k) { makeobjitem(node, deep, k, obj[k]);});
	if (ekey)
		makeobjitem(node, deep, ekey, eobj);
	return node;
}

function gotevent(obj, name) {
	obj = obj[0];
	if (obj.event != "monitor/trace")
		add_logmsg("unexpected event!", JSON.stringify(obj, null, 1), "event");
	else {
		add_logmsg("trace event", JSON.stringify(obj, null, 1), "trace");
		gottraceevent(obj);
	}
}

function gottraceevent(obj) {
	var data = obj.data;
	var type = data.type;
	var desc = data[type];
	if (!show_monitor_events) {
		if (type == "event" ? desc.name.startsWith("monitor/") : desc.api == "monitor")
			return;
	}
	var x = document.importNode(t_traceevent, true);
	x.dataset.event = obj;
	get(".close", x).onclick = function(evt){x.remove();};
	x.className = x.className + " " + type;
	get(".time", x).textContent = data.time;
	get(".tag", x).textContent = ({
		request: function(r,d) { return r.api + "/" + r.verb + "  [" + r.index + "] " + r.action + (r.action == 'reply' ? ' '+d.data.error  : ''); },
		service: function(r) { return r.api + "@" + r.action; },
		daemon: function(r) { return r.api + ":" + r.action; },
		event: function(r) { return r.name + "!" + r.action; },
		global: function(r) { return "$" + r.action; },
		})[type](desc,data);
	var tab = makeobj(desc, 4);
	if ("data" in data)
		makeobjitem(tab, 2, "data", data.data);
	get(".content", x).append(tab);
	trace_events_add(x);
}

function toggle_opened_closed(node, defval) {
	class_toggle(node, { closed: "opened", opened: "closed" }, defval);
}

function obj2html(json) {
	json = JSON.stringify(json, undefined, 2);
	json = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	return json.replace(
		/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
		function (match) {
			var cls = 'number';
			if (/^"/.test(match)) {
				if (/:$/.test(match)) {
					cls = 'key';
				} else {
					cls = 'string';
					match = match.replace(/\\n/g, "\\n<br>");
				}
			} else if (/true|false/.test(match)) {
				cls = 'boolean';
			} else if (/null/.test(match)) {
				cls = 'null';
			}
			return '<span class="json ' + cls + '">' + match + '</span>';
		});
}






