The project in this folder is a whatsapp bot, developed using 3rd party APIs

# Main
bots.json - defines the bots
index.js - initialize the bots
src/WhatsAppBotEvoGo.js - currently used API wrapper
src/EventHandler - Handle received events from the multiple APIs
src/CommandHandler - processes commands and prepares responses

# Commands
## SuperAdmin
Only for the bot owner, useful commands like join group

## Management
Only for group admins, defined in src/commands/Management.js
CRUD commands, set group parameters and more


## FixedComands
Loads implemented commands from src/function folders (autoload), all of them export their commands:
module.exports = { commands };

They receive messages from the CommandHandler and reply by returning a single or array of ReturnMessages (defined in src/models). They can also directly send messages or reactions using bot client object

## CustomCommands
Create by group admins using management commands

# More
Will be specified in the prompts

For database schema and structure, see: DATABASES.md