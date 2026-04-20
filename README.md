# Roblox AI Bridge

Roblox AI Bridge is a local bridge that connects Roblox Studio to an AI through a plugin and a Node.js server. It turns natural language instructions into real actions directly inside your Roblox project.

## Overview

Imagine typing *"create a spawn platform"*… and watching Studio do it instantly.
This project acts as a translator between your intent and the Roblox API.

## How it works

* The plugin captures a simplified snapshot of your project
* It sends it to a local Node.js server
* The server queries an AI via the OpenAI API
* The AI returns structured actions (JSON)
* The plugin streams and applies these actions in real time (SSE)

## Features

* Create / delete instances
* Modify properties
* Rename and move objects
* Edit script `Source`
* Near real-time execution

## Limitations

* No direct persistent connection to an AI (API-based only)
* Requires an OpenAI API key
* Prototype: mainly supports basic operations
* Actions are auto-applied → use a copy of your project or rely on `Ctrl+Z`

## Project structure

```
bridge/server.js           # Local server (HTTP + SSE)
plugin/RobloxAIBridge.lua # Roblox Studio plugin
.env.example              # Environment config
```

## Installation

### Local server

```powershell
cd <project-path>
$env:OPENAI_API_KEY="your_api_key"
$env:OPENAI_MODEL="gpt-5.4-mini"
node bridge/server.js
```

Server runs on:
`http://127.0.0.1:8123`

### Roblox Studio plugin

1. Open Roblox Studio
2. Enable local plugins if needed
3. Create a Plugin Script
4. Right-click → `Save as Local Plugin`
5. Paste `RobloxAIBridge.lua`
6. Run the plugin and click **Connect**

## Usage

1. (Optional) Select an object in Studio
2. Click **Sync**
3. Enter a prompt
4. Click **Ask AI**
5. Watch Studio execute your request 👀

### Example prompts

```
create a blue anchored Part in Workspace, size 8x1x8, name it SpawnPlate
create a ScreenGui with a centered TextLabel saying Welcome
replace the selected script with print("Hello from AI bridge")
```

## Local API

### `GET /health`

Returns server status

### `POST /sync`

Sends a Studio snapshot

### `POST /prompt`

Requests AI-generated actions

### `POST /enqueue`

Manually injects actions (no AI required)

## Security notes

* Keep your API key server-side only
* Do not expose the bridge to the internet
* Test on a copy of your project
* Always review applied changes

## Vision

This is just the beginning.
The goal isn’t only automation… but turning Roblox Studio into an AI-assisted environment where building becomes a conversation.
