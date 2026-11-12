// Tailscale plugin for the Pebble mobile companion app.
// Connects to https://api.tailscale.com/api/v2 and serves network/* and tailscale/* sources.

var API_ROOT = 'https://api.tailscale.com/api/v2';
var TOKEN_KEY = 'tailscale_api_token';
var TAILNET_KEY = 'tailscale_tailnet';
var DEVICES_CACHE_KEY = 'tailscale_devices_cache';
var SUMMARY_CACHE_KEY = 'tailscale_summary_cache';
var BLOCKED_KEY = 'tailscale.blocked.v1';
var REFRESH_MS = 60 * 1000;
var REACH_HOSTS = ['api.tailscale.com'];

var ALL_SOURCES = [
  'network/device',
  'network/tailnet',
  'network/routes',
  'network/dns',
  'network/user',
  'network/key',
  'network/configured',
  'tailscale/device',
  'tailscale/tailnet',
  'tailscale/routes',
  'tailscale/dns',
  'tailscale/user',
  'tailscale/key',
  'tailscale/configured'
];

async function blockedHost() {
  var permissions = typeof Pebble !== 'undefined' && Pebble.permissions;
  if (permissions && typeof permissions.query === 'function') {
    for (var i = 0; i < REACH_HOSTS.length; i++) {
      try {
        var state = await permissions.query('Internet/' + REACH_HOSTS[i]);
        if (state !== 'granted') return { host: REACH_HOSTS[i], sure: true };
      } catch (e) {}
    }
  }
  return null;
}

async function checkReach() {
  var blocked = await blockedHost();
  try {
    if (blocked) localStorage.setItem(BLOCKED_KEY, JSON.stringify(blocked));
    else localStorage.removeItem(BLOCKED_KEY);
  } catch (e) {}
  return blocked;
}

async function getStorageItem(key) {
  try {
    if (typeof Pebble !== 'undefined' && Pebble.secureStorage) {
      var val = await Pebble.secureStorage.getItem(key);
      if (val && val.trim()) return val.trim();
    }
  } catch (e) {
    console.warn('[TailscalePlugin] secureStorage getItem failed for ' + key + ':', e);
  }
  try {
    return (localStorage.getItem(key) || '').trim();
  } catch (e) {
    return '';
  }
}

async function setStorageItem(key, value) {
  var clean = (value || '').trim();
  try {
    if (typeof Pebble !== 'undefined' && Pebble.secureStorage) {
      if (clean) await Pebble.secureStorage.setItem(key, clean);
      else await Pebble.secureStorage.removeItem(key);
    }
  } catch (e) {
    console.warn('[TailscalePlugin] secureStorage setItem failed for ' + key + ':', e);
  }
  try {
    if (clean) localStorage.setItem(key, clean);
    else localStorage.removeItem(key);
  } catch (e) {}
}

async function getApiToken() {
  return await getStorageItem(TOKEN_KEY);
}

async function setApiToken(token) {
  await setStorageItem(TOKEN_KEY, token);
}

async function getTailnetName() {
  var tn = await getStorageItem(TAILNET_KEY);
  return tn || '-';
}

async function setTailnetName(tailnet) {
  await setStorageItem(TAILNET_KEY, (tailnet || '-').trim());
}

async function clearCredentials() {
  await setStorageItem(TOKEN_KEY, '');
  await setStorageItem(TAILNET_KEY, '');
  try {
    localStorage.removeItem(DEVICES_CACHE_KEY);
    localStorage.removeItem(SUMMARY_CACHE_KEY);
  } catch (e) {}
}

function formatRelativeTime(isoString) {
  if (!isoString) return 'Unknown';
  try {
    var then = new Date(isoString).getTime();
    if (isNaN(then)) return String(isoString);
    var now = Date.now();
    var diffSec = Math.floor((now - then) / 1000);
    if (diffSec < 0) return 'Just now';
    if (diffSec < 60) return diffSec + 's ago';
    var diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return diffMin + 'm ago';
    var diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return diffHr + 'h ago';
    var diffDays = Math.floor(diffHr / 24);
    if (diffDays < 30) return diffDays + 'd ago';
    return new Date(isoString).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch (e) {
    return String(isoString);
  }
}

function formatOs(osName) {
  if (!osName) return 'Unknown';
  var lower = osName.toLowerCase();
  if (lower === 'macos' || lower === 'darwin') return 'macOS';
  if (lower === 'ios') return 'iOS';
  if (lower === 'linux') return 'Linux';
  if (lower === 'windows') return 'Windows';
  if (lower === 'android') return 'Android';
  if (lower === 'tvos') return 'tvOS';
  if (lower === 'freebsd') return 'FreeBSD';
  return osName.charAt(0).toUpperCase() + osName.slice(1);
}

function extractIps(addresses) {
  var ipv4 = '';
  var ipv6 = '';
  if (Array.isArray(addresses)) {
    for (var i = 0; i < addresses.length; i++) {
      var addr = addresses[i];
      if (!ipv4 && addr.indexOf('.') !== -1) ipv4 = addr;
      else if (!ipv6 && addr.indexOf(':') !== -1) ipv6 = addr;
    }
  }
  return { ipv4: ipv4, ipv6: ipv6 };
}

async function tailscaleFetch(endpoint, method, body, tokenOverride) {
  var token = tokenOverride || await getApiToken();
  if (!token) {
    return { ok: false, status: 401, error: 'AUTH_REQUIRED', message: 'No API token configured.' };
  }

  var url = API_ROOT + endpoint;
  var headers = {
    'Authorization': 'Bearer ' + token,
    'Accept': 'application/json'
  };

  var fetchOptions = {
    method: method || 'GET',
    headers: headers
  };

  if (body) {
    headers['Content-Type'] = 'application/json';
    fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
  }

  try {
    var res = await fetch(url, fetchOptions);
    var text = await res.text();
    var json = null;
    try {
      json = JSON.parse(text);
    } catch (parseErr) {}

    if (!res.ok) {
      var errMsg = (json && (json.message || json.error)) || ('HTTP ' + res.status);
      if (res.status === 401) {
        return { ok: false, status: 401, error: 'AUTH_REQUIRED', message: 'Tailscale API token is invalid or expired: ' + errMsg };
      }
      if (res.status === 403) {
        return { ok: false, status: 403, error: 'PERMISSION_DENIED', message: 'Permission denied: ' + errMsg };
      }
      if (res.status === 404) {
        return { ok: false, status: 404, error: 'NOT_FOUND', message: 'Resource not found: ' + errMsg };
      }
      if (res.status === 429) {
        return { ok: false, status: 429, error: 'RATE_LIMITED', message: 'Rate limited by Tailscale API: ' + errMsg };
      }
      return { ok: false, status: res.status, error: 'HTTP_ERROR', message: errMsg, json: json };
    }

    return { ok: true, status: res.status, json: json };
  } catch (err) {
    console.error('[TailscalePlugin] Network error on ' + endpoint + ':', err);
    return { ok: false, status: 0, error: 'NETWORK_ERROR', message: 'Network request failed: ' + (err.message || String(err)) };
  }
}

async function apiGetDevices(tailnet, token) {
  var tn = encodeURIComponent(tailnet || '-');
  var res = await tailscaleFetch('/tailnet/' + tn + '/devices', 'GET', null, token);
  if (!res.ok) return res;
  return { ok: true, devices: (res.json && res.json.devices) || [] };
}

async function apiGetDevice(deviceId, token) {
  var id = encodeURIComponent(deviceId);
  return await tailscaleFetch('/device/' + id, 'GET', null, token);
}

async function apiGetDeviceRoutes(deviceId, token) {
  var id = encodeURIComponent(deviceId);
  return await tailscaleFetch('/device/' + id + '/routes', 'GET', null, token);
}

async function apiGetDnsPreferences(tailnet, token) {
  var tn = encodeURIComponent(tailnet || '-');
  return await tailscaleFetch('/tailnet/' + tn + '/dns/preferences', 'GET', null, token);
}

async function apiGetDnsNameservers(tailnet, token) {
  var tn = encodeURIComponent(tailnet || '-');
  return await tailscaleFetch('/tailnet/' + tn + '/dns/nameservers', 'GET', null, token);
}

async function apiGetDnsSearchPaths(tailnet, token) {
  var tn = encodeURIComponent(tailnet || '-');
  return await tailscaleFetch('/tailnet/' + tn + '/dns/searchpaths', 'GET', null, token);
}

async function apiGetDnsSplit(tailnet, token) {
  var tn = encodeURIComponent(tailnet || '-');
  return await tailscaleFetch('/tailnet/' + tn + '/dns/split-dns', 'GET', null, token);
}

async function apiGetDnsConfiguration(tailnet, token) {
  var tn = encodeURIComponent(tailnet || '-');
  return await tailscaleFetch('/tailnet/' + tn + '/dns/configuration', 'GET', null, token);
}

async function apiGetUsers(tailnet, token) {
  var tn = encodeURIComponent(tailnet || '-');
  var res = await tailscaleFetch('/tailnet/' + tn + '/users', 'GET', null, token);
  if (!res.ok) return res;
  return { ok: true, users: (res.json && res.json.users) || [] };
}

async function apiGetUser(userId, token) {
  var id = encodeURIComponent(userId);
  return await tailscaleFetch('/users/' + id, 'GET', null, token);
}

async function apiGetKeys(tailnet, token) {
  var tn = encodeURIComponent(tailnet || '-');
  var res = await tailscaleFetch('/tailnet/' + tn + '/keys', 'GET', null, token);
  if (!res.ok) return res;
  return { ok: true, keys: (res.json && res.json.keys) || [] };
}

async function apiGetKey(tailnet, keyId, token) {
  var tn = encodeURIComponent(tailnet || '-');
  var kid = encodeURIComponent(keyId);
  return await tailscaleFetch('/tailnet/' + tn + '/keys/' + kid, 'GET', null, token);
}

async function apiGetSettings(tailnet, token) {
  var tn = encodeURIComponent(tailnet || '-');
  return await tailscaleFetch('/tailnet/' + tn + '/settings', 'GET', null, token);
}

async function apiGetContacts(tailnet, token) {
  var tn = encodeURIComponent(tailnet || '-');
  return await tailscaleFetch('/tailnet/' + tn + '/contacts', 'GET', null, token);
}

async function apiGetWebhooks(tailnet, token) {
  var tn = encodeURIComponent(tailnet || '-');
  var res = await tailscaleFetch('/tailnet/' + tn + '/webhooks', 'GET', null, token);
  if (!res.ok) return res;
  return { ok: true, webhooks: (res.json && res.json.webhooks) || [] };
}

async function apiGetAcl(tailnet, token) {
  var tn = encodeURIComponent(tailnet || '-');
  return await tailscaleFetch('/tailnet/' + tn + '/acl', 'GET', null, token);
}

Pebble.registerSourceHandler(async function (request, respond) {
  console.log('[TailscalePlugin] Source request:', request.category, request.item);

  var isNetwork = (request.category === 'network');
  var isTailscale = (request.category === 'tailscale');

  if (!isNetwork && !isTailscale) {
    respond.error('INVALID_REQUEST', 'Unsupported category: ' + request.category);
    return;
  }

  var token = await getApiToken();
  var tailnet = await getTailnetName();

  if (request.item === 'configured') {
    var hasToken = (token && token.length > 0);
    var cachedSummary = null;
    try {
      cachedSummary = JSON.parse(localStorage.getItem(SUMMARY_CACHE_KEY) || 'null');
    } catch (e) {}

    var onlineCount = (cachedSummary && cachedSummary.onlineDevices) || 0;
    var totalCount = (cachedSummary && cachedSummary.totalDevices) || 0;

    respond.data({
      instances: [{
        instanceId: 'configured',
        properties: {
          name: { shortText: { text: 'Tailscale' } },
          configured: {
            boolean: { value: !!hasToken },
            shortText: { text: hasToken ? 'Connected' : 'Not configured' }
          },
          tailnet: {
            shortText: { text: (cachedSummary && cachedSummary.tailnet) || tailnet || '-' }
          },
          online_devices: {
            numericValue: { value: onlineCount },
            shortText: { text: onlineCount + ' online' }
          },
          total_devices: {
            numericValue: { value: totalCount },
            shortText: { text: totalCount + ' devices' }
          }
        }
      }]
    });
    return;
  }

  if (!token) {
    respond.error('AUTH_REQUIRED', 'Please set your Tailscale Bearer token in the plugin settings page.');
    return;
  }

  if (request.item === 'device') {
    var devRes = await apiGetDevices(tailnet, token);
    if (!devRes.ok) {
      respond.error(devRes.error || 'PLUGIN_UNAVAILABLE', devRes.message || 'Failed to fetch Tailscale devices.');
      return;
    }

    var devices = devRes.devices || [];
    try {
      localStorage.setItem(DEVICES_CACHE_KEY, JSON.stringify(devices));
    } catch (e) {}

    var sortedDevices = devices.slice().sort(function (a, b) {
      if (a.connectedToControl && !b.connectedToControl) return -1;
      if (!a.connectedToControl && b.connectedToControl) return 1;
      var nameA = (a.givenName || a.hostname || '').toLowerCase();
      var nameB = (b.givenName || b.hostname || '').toLowerCase();
      return nameA.localeCompare(nameB);
    });

    var instances = sortedDevices.map(function (dev) {
      var ips = extractIps(dev.addresses);
      var displayName = dev.givenName || dev.hostname || 'Device';
      var fqdn = dev.name || displayName;
      var isOnline = !!dev.connectedToControl;
      var lastSeenText = formatRelativeTime(dev.lastSeen);
      var osPretty = formatOs(dev.os);
      var tagsText = (dev.tags && dev.tags.length) ? dev.tags.join(', ') : '';
      var userText = dev.user || (dev.tags && dev.tags[0]) || '';
      var updateAvail = !!dev.updateAvailable;
      var isAuthorized = dev.authorized !== false;

      return {
        instanceId: String(dev.nodeId || dev.id),
        properties: {
          name: {
            shortText: { text: displayName },
            longText: { text: displayName + ' (' + fqdn + ')' }
          },
          hostname: {
            shortText: { text: dev.hostname || displayName }
          },
          ipv4: {
            shortText: { text: ips.ipv4 || 'No IPv4' }
          },
          ipv6: {
            shortText: { text: ips.ipv6 || 'No IPv6' }
          },
          status: {
            shortText: { text: isOnline ? 'Online' : 'Offline' },
            longText: { text: isOnline ? 'Online' : ('Last seen ' + lastSeenText) }
          },
          connected: {
            boolean: { value: isOnline },
            shortText: { text: isOnline ? 'Online' : 'Offline' }
          },
          os: {
            shortText: { text: osPretty }
          },
          last_seen: {
            shortText: { text: isOnline ? 'Now' : lastSeenText }
          },
          update_available: {
            boolean: { value: updateAvail },
            shortText: { text: updateAvail ? 'Update available' : 'Up to date' }
          },
          client_version: {
            shortText: { text: dev.clientVersion || 'Unknown' }
          },
          tags: {
            shortText: { text: tagsText || 'None' },
            longText: { text: tagsText || 'No tags' }
          },
          authorized: {
            boolean: { value: isAuthorized },
            shortText: { text: isAuthorized ? 'Authorized' : 'Unauthorized' }
          },
          user: {
            shortText: { text: userText }
          },
          device_id: {
            shortText: { text: String(dev.id || dev.nodeId) }
          }
        }
      };
    });

    var onlineDevicesCount = devices.filter(function (d) { return d.connectedToControl; }).length;
    try {
      localStorage.setItem(SUMMARY_CACHE_KEY, JSON.stringify({
        tailnet: tailnet,
        totalDevices: devices.length,
        onlineDevices: onlineDevicesCount,
        updatedAt: Date.now()
      }));
    } catch (e) {}

    respond.data({
      validUntilMs: Date.now() + REFRESH_MS,
      instances: instances
    });
    return;
  }

  if (request.item === 'tailnet') {
    var devRes2 = await apiGetDevices(tailnet, token);
    var devList = (devRes2.ok && devRes2.devices) || [];
    var totalDevs = devList.length;
    var onlineDevs = devList.filter(function (d) { return d.connectedToControl; }).length;

    var dnsPrefRes = await apiGetDnsPreferences(tailnet, token);
    var magicDnsOn = !!(dnsPrefRes.ok && dnsPrefRes.json && dnsPrefRes.json.magicDNS);

    var userRes = await apiGetUsers(tailnet, token);
    var totalUsers = (userRes.ok && userRes.users && userRes.users.length) || 0;

    var resolvedTailnet = tailnet;
    if ((!resolvedTailnet || resolvedTailnet === '-') && devList.length > 0 && devList[0].name) {
      var parts = devList[0].name.split('.');
      if (parts.length > 1) {
        resolvedTailnet = parts.slice(1).join('.');
      }
    }

    try {
      localStorage.setItem(SUMMARY_CACHE_KEY, JSON.stringify({
        tailnet: resolvedTailnet,
        totalDevices: totalDevs,
        onlineDevices: onlineDevs,
        updatedAt: Date.now()
      }));
    } catch (e) {}

    respond.data({
      validUntilMs: Date.now() + REFRESH_MS,
      instances: [{
        instanceId: 'tailnet',
        properties: {
          name: {
            shortText: { text: resolvedTailnet || 'Tailscale' },
            longText: { text: 'Tailscale Tailnet (' + (resolvedTailnet || 'Default') + ')' }
          },
          devices_count: {
            numericValue: { value: totalDevs },
            shortText: { text: totalDevs + ' devices' }
          },
          online_count: {
            numericValue: { value: onlineDevs },
            shortText: { text: onlineDevs + ' online' },
            longText: { text: onlineDevs + ' of ' + totalDevs + ' devices online' }
          },
          users_count: {
            numericValue: { value: totalUsers },
            shortText: { text: totalUsers + ' users' }
          },
          magic_dns: {
            boolean: { value: magicDnsOn },
            shortText: { text: magicDnsOn ? 'MagicDNS On' : 'MagicDNS Off' }
          }
        }
      }]
    });
    return;
  }

  if (request.item === 'routes') {
    var devResR = await apiGetDevices(tailnet, token);
    if (!devResR.ok) {
      respond.error(devResR.error || 'PLUGIN_UNAVAILABLE', devResR.message || 'Failed to fetch devices for routes.');
      return;
    }

    var devicesWithRoutes = [];
    var allDevs = devResR.devices || [];

    for (var d = 0; d < allDevs.length; d++) {
      var devObj = allDevs[d];
      var adv = devObj.advertisedRoutes || [];
      var ena = devObj.enabledRoutes || [];

      if (adv.length > 0 || ena.length > 0) {
        var isExitNode = ena.indexOf('0.0.0.0/0') !== -1 || ena.indexOf('::/0') !== -1 ||
                         adv.indexOf('0.0.0.0/0') !== -1 || adv.indexOf('::/0') !== -1;
        var rDevName = devObj.givenName || devObj.hostname || 'Device';

        devicesWithRoutes.push({
          instanceId: String(devObj.id || devObj.nodeId),
          properties: {
            name: {
              shortText: { text: rDevName },
              longText: { text: rDevName + ' (' + (isExitNode ? 'Exit Node' : 'Subnet Router') + ')' }
            },
            device_id: {
              shortText: { text: String(devObj.id || devObj.nodeId) }
            },
            advertised_routes: {
              shortText: { text: adv.join(', ') || 'None' },
              longText: { text: adv.join(', ') || 'No advertised routes' }
            },
            enabled_routes: {
              shortText: { text: ena.join(', ') || 'None' },
              longText: { text: ena.join(', ') || 'No enabled routes' }
            },
            is_exit_node: {
              boolean: { value: isExitNode },
              shortText: { text: isExitNode ? 'Exit Node' : 'Subnet Router' }
            }
          }
        });
      }
    }

    respond.data({
      validUntilMs: Date.now() + (REFRESH_MS * 2),
      instances: devicesWithRoutes
    });
    return;
  }

  if (request.item === 'dns') {
    var dnsPref = await apiGetDnsPreferences(tailnet, token);
    var dnsNameservers = await apiGetDnsNameservers(tailnet, token);
    var dnsSearch = await apiGetDnsSearchPaths(tailnet, token);

    var magicDns = !!(dnsPref.ok && dnsPref.json && dnsPref.json.magicDNS);
    var nsList = (dnsNameservers.ok && dnsNameservers.json && dnsNameservers.json.dns) || [];
    var searchList = (dnsSearch.ok && dnsSearch.json && dnsSearch.json.searchPaths) || [];

    respond.data({
      validUntilMs: Date.now() + (REFRESH_MS * 5),
      instances: [{
        instanceId: 'dns',
        properties: {
          name: {
            shortText: { text: 'Tailscale DNS' },
            longText: { text: 'MagicDNS & Global Nameservers' }
          },
          magic_dns: {
            boolean: { value: magicDns },
            shortText: { text: magicDns ? 'MagicDNS Enabled' : 'MagicDNS Disabled' }
          },
          nameservers: {
            shortText: { text: nsList.join(', ') || 'Default' },
            longText: { text: nsList.join(', ') || 'Default Tailscale Nameservers' }
          },
          searchpaths: {
            shortText: { text: searchList.join(', ') || 'None' },
            longText: { text: searchList.join(', ') || 'No custom search paths' }
          }
        }
      }]
    });
    return;
  }

  if (request.item === 'user') {
    var usersRes = await apiGetUsers(tailnet, token);
    if (!usersRes.ok) {
      respond.error(usersRes.error || 'PLUGIN_UNAVAILABLE', usersRes.message || 'Failed to fetch Tailscale users.');
      return;
    }

    var users = usersRes.users || [];
    var userInstances = users.map(function (u) {
      var dName = u.displayName || u.loginName || 'User';
      return {
        instanceId: String(u.id),
        properties: {
          name: {
            shortText: { text: dName },
            longText: { text: u.displayName ? (u.displayName + ' (' + u.loginName + ')') : u.loginName }
          },
          login_name: {
            shortText: { text: u.loginName || '' }
          },
          role: {
            shortText: { text: u.role || 'member' }
          },
          status: {
            shortText: { text: u.status || 'active' }
          },
          device_count: {
            numericValue: { value: u.deviceCount || 0 },
            shortText: { text: (u.deviceCount || 0) + ' devices' }
          },
          user_id: {
            shortText: { text: String(u.id) }
          }
        }
      };
    });

    respond.data({
      validUntilMs: Date.now() + (REFRESH_MS * 5),
      instances: userInstances
    });
    return;
  }

  if (request.item === 'key') {
    var keysRes = await apiGetKeys(tailnet, token);
    if (!keysRes.ok) {
      respond.error(keysRes.error || 'PLUGIN_UNAVAILABLE', keysRes.message || 'Failed to fetch Tailscale keys.');
      return;
    }

    var keys = keysRes.keys || [];
    var keyInstances = keys.map(function (k) {
      var kName = k.description || k.id || 'Key';
      return {
        instanceId: String(k.id),
        properties: {
          name: {
            shortText: { text: kName },
            longText: { text: k.description ? (k.description + ' (' + k.id + ')') : k.id }
          },
          key_id: {
            shortText: { text: String(k.id) }
          },
          key_type: {
            shortText: { text: k.keyType || 'auth' }
          },
          created: {
            shortText: { text: formatRelativeTime(k.created) }
          },
          expires: {
            shortText: { text: formatRelativeTime(k.expires) }
          }
        }
      };
    });

    respond.data({
      validUntilMs: Date.now() + (REFRESH_MS * 5),
      instances: keyInstances
    });
    return;
  }

  respond.error('INVALID_REQUEST', 'Unknown source item: ' + request.item);
});

Pebble.registerActionHandler(function (request, respond) {
  respond.error('INVALID_REQUEST', 'Tailscale plugin is read-only. Unknown action: ' + request.action);
});

Pebble.registerConfigHandler(async function (message, respond) {
  var type = message && message.type;
  console.log('[TailscalePlugin] Config handler message:', type);

  if (type === 'reach') {
    respond({ blocked: await checkReach().catch(function () { return null; }) });
    return;
  }

  if (type === 'status') {
    var token = await getApiToken();
    var tailnet = await getTailnetName();

    if (!token) {
      respond({
        configured: false,
        tailnet: tailnet || '-',
        devicesCount: 0,
        onlineCount: 0
      });
      return;
    }

    var testRes = await apiGetDevices(tailnet, token);
    if (!testRes.ok) {
      respond({
        configured: false,
        expired: testRes.status === 401,
        error: testRes.message || 'Could not connect to Tailscale API.',
        tailnet: tailnet || '-'
      });
      return;
    }

    var devices = testRes.devices || [];
    var online = devices.filter(function (d) { return d.connectedToControl; }).length;
    var resolvedTailnet = tailnet;
    if ((!resolvedTailnet || resolvedTailnet === '-') && devices.length > 0 && devices[0].name) {
      var parts = devices[0].name.split('.');
      if (parts.length > 1) {
        resolvedTailnet = parts.slice(1).join('.');
      }
    }

    respond({
      configured: true,
      tailnet: resolvedTailnet,
      devicesCount: devices.length,
      onlineCount: online,
      devices: devices.map(function (d) {
        return {
          id: d.id,
          name: d.givenName || d.hostname,
          hostname: d.hostname,
          connected: !!d.connectedToControl,
          os: d.os,
          addresses: d.addresses
        };
      })
    });
    return;
  }

  if (type === 'save') {
    var inputToken = (message.token || '').trim();
    var inputTailnet = (message.tailnet || '').trim() || '-';

    if (!inputToken) {
      respond({ error: 'Please enter a valid Tailscale Bearer API token.' });
      return;
    }

    var verifyRes = await apiGetDevices(inputTailnet, inputToken);
    if (!verifyRes.ok) {
      respond({
        error: verifyRes.message || 'Failed to authenticate with Tailscale API. Please check your token.'
      });
      return;
    }

    var devs = verifyRes.devices || [];
    var onlineDevs = devs.filter(function (d) { return d.connectedToControl; }).length;
    var finalTailnet = inputTailnet;
    if ((!finalTailnet || finalTailnet === '-') && devs.length > 0 && devs[0].name) {
      var p = devs[0].name.split('.');
      if (p.length > 1) finalTailnet = p.slice(1).join('.');
    }

    await setApiToken(inputToken);
    await setTailnetName(inputTailnet);

    try {
      localStorage.setItem(SUMMARY_CACHE_KEY, JSON.stringify({
        tailnet: finalTailnet,
        totalDevices: devs.length,
        onlineDevices: onlineDevs,
        updatedAt: Date.now()
      }));
    } catch (e) {}

    Pebble.refreshSources(ALL_SOURCES);

    respond({
      ok: true,
      configured: true,
      tailnet: finalTailnet,
      devicesCount: devs.length,
      onlineCount: onlineDevs
    });
    return;
  }

  if (type === 'unlink') {
    await clearCredentials();
    Pebble.refreshSources(ALL_SOURCES);
    respond({ ok: true, configured: false });
    return;
  }

  respond({ error: 'Unknown message type: ' + type });
});
