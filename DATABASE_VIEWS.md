# Database Views

This file contains the SQL definitions for the views used to "flatten" the JSON data stored in SQLite. These views allow for easier analysis using tools like Datasette, Metabase, or Grafana.

## 🧠 Core Database (`core.db`)

### `load_reports_view`
Flattens the performance metrics reports.

```sql
CREATE VIEW IF NOT EXISTS load_reports_view AS 
SELECT 
    id, 
    bot_id, 
    datetime(json_extract(json_data, '$.period.start')/1000, 'unixepoch') as start_time_utc, 
    datetime(json_extract(json_data, '$.period.end')/1000, 'unixepoch') as end_time_utc, 
    json_extract(json_data, '$.duration') as duration_seconds, 
    json_extract(json_data, '$.messages.receivedPrivate') as recv_private, 
    json_extract(json_data, '$.messages.receivedGroup') as recv_group, 
    json_extract(json_data, '$.messages.sentPrivate') as sent_private, 
    json_extract(json_data, '$.messages.sentGroup') as sent_group, 
    (json_extract(json_data, '$.messages.receivedPrivate') + 
     json_extract(json_data, '$.messages.receivedGroup') + 
     json_extract(json_data, '$.messages.sentPrivate') + 
     json_extract(json_data, '$.messages.sentGroup')) as total_msgs, 
    json_extract(json_data, '$.messages.messagesPerHour') as msgs_per_hour, 
    CAST(json_extract(json_data, '$.responseTime.average') AS REAL) as resp_avg_sec, 
    CAST(json_extract(json_data, '$.responseTime.max') AS REAL) as resp_max_sec, 
    json_extract(json_data, '$.responseTime.count') as resp_count 
FROM load_reports;
```

### `groups_view`
Extracts key configuration and status from groups.

```sql
CREATE VIEW IF NOT EXISTS groups_view AS 
SELECT 
    id, 
    name, 
    json_extract(json_data, '$.addedBy') as added_by, 
    datetime(json_extract(json_data, '$.createdAt')/1000, 'unixepoch') as created_at_utc, 
    json_extract(json_data, '$.filters.links') as filter_links, 
    json_extract(json_data, '$.filters.nsfw') as filter_nsfw, 
    json_extract(json_data, '$.interact.enabled') as interact_enabled, 
    datetime(json_extract(json_data, '$.interact.lastInteraction')/1000, 'unixepoch') as last_interact_utc, 
    json_extract(json_data, '$.greetings.text') as welcome_msg, 
    json_extract(json_data, '$.autoTranslateTo') as auto_translate 
FROM groups;
```

### `custom_commands_view`
Details on custom commands created by users.

```sql
CREATE VIEW IF NOT EXISTS custom_commands_view AS 
SELECT 
    group_id, 
    trigger, 
    json_extract(json_data, '$.responses[0]') as first_response, 
    json_extract(json_data, '$.adminOnly') as admin_only, 
    json_extract(json_data, '$.count') as usage_count, 
    json_extract(json_data, '$.metadata.createdBy') as created_by, 
    datetime(json_extract(json_data, '$.metadata.createdAt')/1000, 'unixepoch') as created_at_utc, 
    datetime(json_extract(json_data, '$.lastUsed')/1000, 'unixepoch') as last_used_utc 
FROM custom_commands;
```

### `donations_view`
Flattens donation records.

```sql
CREATE VIEW IF NOT EXISTS donations_view AS 
SELECT 
    name, 
    json_extract(json_data, '$.valor') as amount, 
    json_extract(json_data, '$.numero') as phone, 
    datetime(json_extract(json_data, '$.timestamp')/1000, 'unixepoch') as last_donation_utc 
FROM donations;
```

### `soft_blocks_view`
Users with specific blocks (like invites).

```sql
CREATE VIEW IF NOT EXISTS soft_blocks_view AS 
SELECT 
    number, 
    json_extract(json_data, '$.invites') as block_invites 
FROM soft_blocks;
```

### `pending_joins_view`
Requests to join groups.

```sql
CREATE VIEW IF NOT EXISTS pending_joins_view AS 
SELECT 
    code, 
    json_extract(json_data, '$.authorId') as author_id, 
    json_extract(json_data, '$.authorName') as author_name, 
    datetime(json_extract(json_data, '$.timestamp')/1000, 'unixepoch') as requested_at_utc 
FROM pending_joins;
```

## 🎣 Fishing Database (`fishing.db`)

### `fishing_users_view`
Player statistics and best catch.

```sql
CREATE VIEW IF NOT EXISTS fishing_users_view AS 
SELECT 
    user_id, 
    name, 
    baits, 
    total_weight, 
    total_catches, 
    json_extract(biggest_fish_json, '$.name') as best_fish_name, 
    json_extract(biggest_fish_json, '$.weight') as best_fish_weight, 
    datetime(json_extract(biggest_fish_json, '$.timestamp')/1000, 'unixepoch') as best_fish_date 
FROM fishing_users;
```

### `fishing_group_stats_view`
Aggregated fishing statistics per group.

```sql
CREATE VIEW IF NOT EXISTS fishing_group_stats_view AS 
SELECT 
    group_id, 
    user_id, 
    name, 
    total_weight, 
    total_catches, 
    json_extract(biggest_fish_json, '$.name') as best_fish_name, 
    json_extract(biggest_fish_json, '$.weight') as best_fish_weight 
FROM fishing_group_stats;
```
