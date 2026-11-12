# Tailscale Pebble plugin

This plugin runs in the Pebble mobile companion app. It queries the Tailscale API at `api.tailscale.com/api/v2` and serves device status, IP addresses, MagicDNS settings, subnet routes, and users to watchapps, watchfaces, and the system assistant.

The plugin is read-only. It makes GET requests only and cannot change tailnet state.

## Sources

The plugin serves sources under both the `network/` and `tailscale/` categories.

### network/device and tailscale/device

Emits one instance per device on the tailnet, ordered with online devices first.

- `name`: Given name or hostname as short text, fully qualified domain name as long text.
- `hostname`: Machine hostname.
- `ipv4`: Tailscale 100.x IPv4 address.
- `ipv6`: Tailscale fd7a:: IPv6 address.
- `status`: Online or offline as short text, last-seen time as long text.
- `connected`: Boolean status, true when connected to the control plane.
- `os`: Operating system name.
- `last_seen`: Relative time since last seen.
- `update_available`: Boolean status, true when client has an update.
- `client_version`: Tailscale release string.
- `tags`: ACL tags as a comma-separated list.
- `authorized`: Boolean status, true when the device is authorized.
- `user`: Account email or owner tag.
- `device_id`: Device node identifier.

### network/tailnet and tailscale/tailnet

Emits a single summary instance for the tailnet.

- `name`: Tailnet domain name.
- `devices_count`: Total registered devices.
- `online_count`: Number of currently online devices.
- `users_count`: Total user accounts.
- `magic_dns`: Boolean status for MagicDNS.

### network/routes and tailscale/routes

Emits one instance per device that advertises or enables subnet routes.

- `name`: Device name.
- `device_id`: Device identifier.
- `advertised_routes`: Routes advertised by the node.
- `enabled_routes`: Routes approved by the admin.
- `is_exit_node`: Boolean status, true if the node routes 0.0.0.0/0 or ::/0.

### network/dns and tailscale/dns

Emits a single instance with DNS settings.

- `name`: DNS configuration label.
- `magic_dns`: Boolean status for MagicDNS.
- `nameservers`: Global upstream nameservers.
- `searchpaths`: Search domains.

### network/user and tailscale/user

Emits one instance per user on the tailnet.

- `name`: Display name or login name.
- `login_name`: Account login address.
- `role`: Role name, such as owner, admin, or member.
- `status`: Account status, such as active.
- `device_count`: Number of devices owned by the user.
- `user_id`: Tailscale user identifier.

### network/key and tailscale/key

Emits one instance per active auth key or API access token.

- `name`: Description or key identifier.
- `key_id`: Key identifier.
- `key_type`: Key type string.
- `created`: Relative creation time.
- `expires`: Relative expiration time.

### network/configured and tailscale/configured

Emits a single instance indicating whether the plugin has credentials.

- `name`: Plugin name.
- `configured`: Boolean status, true when a token is saved.
- `tailnet`: Configured tailnet domain or dash for default.
- `online_devices`: Number of online devices.
- `total_devices`: Total number of devices.

## Authentication

The plugin authenticates using a Tailscale API access token:

1. Open the Tailscale admin console at `https://login.tailscale.com/admin/settings/keys`.
2. Under API access tokens, generate an access token.
3. Open the plugin settings page in the Pebble companion app.
4. Paste the token into the API token field.
5. Save the settings. The plugin checks the token against the API and stores it in secure storage.

If you belong to multiple tailnets, enter your organization domain in the tailnet field. Otherwise, leave it as `-` to use the default tailnet.

## Watchapp example

Watchapps read data using `Pebble.subscribeToSource`:

```javascript
Pebble.subscribeToSource({
  category: 'network',
  item: 'device',
  onData: function (envelope) {
    (envelope.instances || []).forEach(function (device) {
      var p = device.properties;
      console.log(p.name.shortText.text, p.ipv4.shortText.text, p.status.shortText.text);
    });
  },
  onError: function (err) {
    console.warn('Tailscale device error:', JSON.stringify(err));
  }
});
```

## Building from source

Build the plugin bundle:

```bash
cd tailscale-pebble-plugin
pebble build
```

Install the bundle into an emulator:

```bash
pebble install --emulator basalt --vnc
```

Or to your watch:
```bash
pebble install --cloudpebble (or --phone <IP>)

```
