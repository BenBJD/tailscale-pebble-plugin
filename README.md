# Tailscale Pebble Plugin

A Pebble phone-side plugin that connects to the Tailscale REST API v2 (`api.tailscale.com`) to provide real-time mesh network status, connected devices, IP addresses, tailnet overview, MagicDNS settings, subnet routes/exit nodes, and user directory to Pebble watchapps, watchfaces, and the Index assistant using the Pebble Plugins API.

The plugin operates in **read-only mode**, retrieving tailnet information without performing administrative modifications.

---

## Features & Exposed Sources

The plugin exposes sources under both the standard `network/*` domain and the `tailscale/*` namespace:

### 1. `network/device` (and `tailscale/device`)
*Supports multiple instances: one for each device/node on the tailnet.*
- `name` (`shortText`, `longText`): Device display name (e.g. `Work MacBook`) and FQDN.
- `hostname` (`shortText`): Machine short hostname (e.g. `work-mbp`).
- `ipv4` (`shortText`): Tailscale IPv4 address (e.g. `100.82.14.5`).
- `ipv6` (`shortText`): Tailscale IPv6 address (e.g. `fd7a:115c:a1e0::5`).
- `status` (`shortText`, `longText`): `Online` or `Offline` (`Last seen 2h ago`).
- `connected` (`boolean`, `shortText`): Boolean connection state (`true` if connected to control).
- `os` (`shortText`): Operating system (e.g. `macOS`, `Linux`, `iOS`, `Android`, `Windows`).
- `last_seen` (`shortText`): Relative time string (e.g. `Now`, `10m ago`, `2d ago`).
- `update_available` (`boolean`, `shortText`): Indicates if a client upgrade is available.
- `client_version` (`shortText`): Tailscale client software version.
- `tags` (`shortText`, `longText`): Assigned ACL tags (e.g. `tag:server, tag:prod`).
- `authorized` (`boolean`, `shortText`): Device authorization state.
- `user` (`shortText`): Owning user email or primary tag.
- `device_id` (`shortText`): Node / machine identifier.

### 2. `network/tailnet` (and `tailscale/tailnet`)
*Single instance summarizing your tailnet.*
- `name` (`shortText`, `longText`): Tailnet domain name (e.g. `my-tailnet.ts.net`).
- `devices_count` (`numericValue`, `shortText`): Total registered machines.
- `online_count` (`numericValue`, `shortText`, `longText`): Count of currently active/online machines.
- `users_count` (`numericValue`, `shortText`): Number of users in the tailnet.
- `magic_dns` (`boolean`, `shortText`): MagicDNS status (`MagicDNS On` / `MagicDNS Off`).

### 3. `network/routes` (and `tailscale/routes`)
*Supports multiple instances: one for each router or exit node.*
- `name` (`shortText`, `longText`): Device display name and route role.
- `device_id` (`shortText`): Node ID.
- `advertised_routes` (`shortText`, `longText`): Subnet routes advertised by node.
- `enabled_routes` (`shortText`, `longText`): Approved/enabled routes.
- `is_exit_node` (`boolean`, `shortText`): `true` if node provides default gateway routing (`0.0.0.0/0` or `::/0`).

### 4. `network/dns` (and `tailscale/dns`)
*Single instance for DNS and nameserver configuration.*
- `name` (`shortText`, `longText`): DNS configuration title.
- `magic_dns` (`boolean`, `shortText`): MagicDNS enabled state.
- `nameservers` (`shortText`, `longText`): Configured global DNS nameservers.
- `searchpaths` (`shortText`, `longText`): DNS search domains.

### 5. `network/user` (and `tailscale/user`)
*Supports multiple instances: one for each user in the tailnet.*
- `name` (`shortText`, `longText`): User display name and login name.
- `login_name` (`shortText`): User email / identifier.
- `role` (`shortText`): User role (`owner`, `admin`, `member`, `it-admin`).
- `status` (`shortText`): Account status (`active`, `suspended`).
- `device_count` (`numericValue`, `shortText`): Number of devices owned by user.
- `user_id` (`shortText`): Tailscale user ID.

### 6. `network/key` (and `tailscale/key`)
*Supports multiple instances: active auth keys and API keys.*
- `name` (`shortText`, `longText`): Key description or ID.
- `key_id` (`shortText`): Key ID.
- `key_type` (`shortText`): `auth` or `api`.
- `created` (`shortText`): Creation relative time.
- `expires` (`shortText`): Expiration relative time.

### 7. `network/configured` (and `tailscale/configured`)
*Standard plugin health check indicator for watchfaces and Index assistant.*
- `name` (`shortText`): `Tailscale`
- `configured` (`boolean`, `shortText`): `true` / `Connected` or `false` / `Not configured`.
- `tailnet` (`shortText`): Tailnet name.
- `online_devices` (`numericValue`, `shortText`): Online count.
- `total_devices` (`numericValue`, `shortText`): Total count.

---

## Setup & Authentication

The plugin authenticates using a Tailscale **API access token** (Bearer authentication):

1. Open the [Tailscale Admin Console](https://login.tailscale.com/admin/settings/keys) and sign in.
2. Under **Settings > Keys > API access tokens**, click **Generate API access token**.
3. Set your preferred expiration (1 to 90 days) and copy the token (starts with `tskey-api-`).
4. In the Pebble companion app, open the **Tailscale Plugin Settings** page:
   - Paste your token into the **Bearer API Token** field.
   - *(Optional)* Specify your tailnet name or leave as `-` for your default tailnet.
   - Tap **Connect & Validate Token**.
5. The plugin validates the token against `api.tailscale.com`, securely stores it in phone hardware storage, and begins serving real-time network sources.

---

## Consuming in Watchapps (PebbleKit JS)

Watchapps can subscribe to Tailscale plugin data using `Pebble.subscribeToSource`:

```javascript
// Check connection status
Pebble.subscribeToSource({
  category: 'network',
  item: 'configured',
  onData: function (envelope) {
    var instance = envelope.instances && envelope.instances[0];
    var isConnected = instance && instance.properties.configured.boolean.value;
    console.log('Tailscale connected:', isConnected);
  }
});

// Stream devices to watch
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

---

## Building from Source

### Prerequisites
- Python 3.10 - 3.13
- Pebble Tool CLI (`uv tool install pebble-tool`)
- Active Pebble SDK 4.44+ (`pebble sdk install latest`)

### Build
```bash
cd tailscale-pebble-plugin
pebble build
```

### Install onto Watch or Emulator
```bash
# Emulator
pebble install --emulator basalt --vnc

# Inspect active plugins in emulator
pebble plugins list --emulator basalt --vnc

# Physical watch
pebble install --phone <PHONE_IP>
```

---

## License

MIT
