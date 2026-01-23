# Databases Documentation

This project uses a hybrid data storage approach. structured and heavy data is stored in **SQLite** databases located in `data/sqlites/`.

To facilitate data analysis, we have created **SQL Views** in the key databases. These views "flatten" the JSON content stored in columns like `json_data` into standard columns.

## 🧠 Core Database
**File:** `data/sqlites/core.db`

### `load_reports`
Bot performance metrics.

```mermaid
classDiagram
    class load_reports {
        +INTEGER id
        +TEXT bot_id
        +TEXT json_data
    }
    class load_reports_view {
        +INTEGER id
        +TEXT bot_id
        +DATETIME start_time_utc
        +DATETIME end_time_utc
        +REAL duration_seconds
        +INTEGER total_msgs
        +REAL msgs_per_hour
        +REAL resp_avg_sec
        +REAL resp_max_sec
    }
    load_reports ..> load_reports_view : flattens
```
```sql
CREATE VIEW IF NOT EXISTS load_reports_view AS SELECT id, bot_id, datetime(json_extract(json_data, '$.period.start')/1000, 'unixepoch') as start_time_utc, ... FROM load_reports;
```

### `groups`
Group configurations.

```mermaid
classDiagram
    class groups {
        +TEXT id
        +TEXT name
        +TEXT json_data
    }
    class groups_view {
        +TEXT id
        +TEXT name
        +TEXT added_by
        +DATETIME created_at_utc
        +BOOLEAN filter_links
        +BOOLEAN filter_nsfw
        +BOOLEAN interact_enabled
        +DATETIME last_interact_utc
        +TEXT welcome_msg
        +TEXT auto_translate
    }
    groups ..> groups_view : flattens
```
```sql
CREATE VIEW IF NOT EXISTS groups_view AS SELECT id, name, json_extract(json_data, '$.addedBy') as added_by, ... FROM groups;
```

### `custom_commands`
User-created commands.

```mermaid
classDiagram
    class custom_commands {
        +TEXT group_id
        +TEXT trigger
        +TEXT json_data
    }
    class custom_commands_view {
        +TEXT group_id
        +TEXT trigger
        +TEXT first_response
        +BOOLEAN admin_only
        +INTEGER usage_count
        +TEXT created_by
        +DATETIME created_at_utc
        +DATETIME last_used_utc
    }
    custom_commands ..> custom_commands_view : flattens
```
```sql
CREATE VIEW IF NOT EXISTS custom_commands_view AS SELECT group_id, trigger, json_extract(json_data, '$.responses[0]') as first_response, ... FROM custom_commands;
```

### `donations`
Donation tracking.

```mermaid
classDiagram
    class donations {
        +TEXT name
        +TEXT json_data
    }
    class donations_view {
        +TEXT name
        +REAL amount
        +TEXT phone
        +DATETIME last_donation_utc
    }
    donations ..> donations_view : flattens
```
```sql
CREATE VIEW IF NOT EXISTS donations_view AS SELECT name, json_extract(json_data, '$.valor') as amount, ... FROM donations;
```

### `pending_joins` & `soft_blocks`
Access control and requests.

```mermaid
classDiagram
    class pending_joins_view {
        +TEXT code
        +TEXT author_id
        +TEXT author_name
        +DATETIME requested_at_utc
    }
    class soft_blocks_view {
        +TEXT number
        +BOOLEAN block_invites
    }
```

## 🎣 Fishing Game
**File:** `data/sqlites/fishing.db`

### `fishing_users`

```mermaid
classDiagram
    class fishing_users {
        +TEXT user_id
        +TEXT name
        +TEXT biggest_fish_json
        +...
    }
    class fishing_users_view {
        +TEXT user_id
        +TEXT name
        +INTEGER baits
        +REAL total_weight
        +INTEGER total_catches
        +TEXT best_fish_name
        +REAL best_fish_weight
        +DATETIME best_fish_date
    }
    fishing_users ..> fishing_users_view : flattens
```
```sql
CREATE VIEW IF NOT EXISTS fishing_users_view AS SELECT user_id, name, baits, total_weight, total_catches, json_extract(biggest_fish_json, '$.name') as best_fish_name, ... FROM fishing_users;
```

## 📊 Standard Databases (No Views Needed)

*   **`cmd_usage.db`**: `cmd_usage_log` (Usage history)
*   **`msgranking.db`**: `ranking` (Message counts)
*   **`media_stats.db`**: `comfy_stats`, `speech_transcription_stats`
*   **`llm_stats.db`**: `usage_stats` (Token usage)

For full SQL definitions, see `DATABASE_VIEWS.md`.