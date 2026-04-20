local HttpService = game:GetService("HttpService")
local Selection = game:GetService("Selection")
local ChangeHistoryService = game:GetService("ChangeHistoryService")

local DEFAULT_URL = "http://127.0.0.1:8123"
local DEFAULT_SESSION_ID = plugin:GetSetting("SessionId") or HttpService:GenerateGUID(false)

local streamClient = nil
local streamConnections = {}
local isApplyingActions = false
local pluginLogs = {}

local widgetInfo = DockWidgetPluginGuiInfo.new(
	Enum.InitialDockState.Right,
	true,
	false,
	520,
	760,
	360,
	420
)

local toolbar = plugin:CreateToolbar("AI Bridge")
local openButton = toolbar:CreateButton(
	"RobloxAIBridge",
	"Open the Roblox AI Bridge",
	"rbxassetid://4458901886"
)

local widget = plugin:CreateDockWidgetPluginGuiAsync("RobloxAIBridgeWidget", widgetInfo)
widget.Title = "Roblox AI Bridge"

local function applyCorner(instance, radius)
	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0, radius or 10)
	corner.Parent = instance
	return corner
end

local function applyStroke(instance, color, thickness, transparency)
	local stroke = Instance.new("UIStroke")
	stroke.Color = color or Color3.fromRGB(65, 70, 82)
	stroke.Thickness = thickness or 1
	stroke.Transparency = transparency or 0
	stroke.Parent = instance
	return stroke
end

local function createLabel(text, size, color, bold)
	local label = Instance.new("TextLabel")
	label.AutomaticSize = Enum.AutomaticSize.Y
	label.BackgroundTransparency = 1
	label.Font = bold and Enum.Font.GothamBold or Enum.Font.Gotham
	label.Size = UDim2.new(1, 0, 0, size or 18)
	label.Text = text or ""
	label.TextColor3 = color or Color3.fromRGB(236, 240, 246)
	label.TextSize = size or 14
	label.TextWrapped = true
	label.TextXAlignment = Enum.TextXAlignment.Left
	label.TextYAlignment = Enum.TextYAlignment.Top
	return label
end

local function createInputBox(height, placeholder, editable, wrapped)
	local box = Instance.new("TextBox")
	box.BackgroundColor3 = Color3.fromRGB(18, 22, 31)
	box.BorderSizePixel = 0
	box.ClearTextOnFocus = false
	box.Font = Enum.Font.Code
	box.MultiLine = true
	box.PlaceholderColor3 = Color3.fromRGB(121, 132, 151)
	box.PlaceholderText = placeholder or ""
	box.RichText = false
	box.Size = UDim2.new(1, 0, 0, height)
	box.Text = ""
	box.TextColor3 = Color3.fromRGB(233, 239, 247)
	box.TextEditable = editable
	box.TextSize = 13
	box.TextWrapped = wrapped == true
	box.TextXAlignment = Enum.TextXAlignment.Left
	box.TextYAlignment = Enum.TextYAlignment.Top
	applyCorner(box, 10)
	applyStroke(box, Color3.fromRGB(57, 64, 79), 1, 0)
	return box
end

local function createButton(text, color)
	local button = Instance.new("TextButton")
	button.AutoButtonColor = true
	button.BackgroundColor3 = color
	button.BorderSizePixel = 0
	button.Font = Enum.Font.GothamSemibold
	button.Size = UDim2.new(1, 0, 0, 36)
	button.Text = text
	button.TextColor3 = Color3.fromRGB(255, 255, 255)
	button.TextSize = 13
	applyCorner(button, 10)
	return button
end

local root = Instance.new("ScrollingFrame")
root.Name = "Root"
root.Active = true
root.AutomaticCanvasSize = Enum.AutomaticSize.Y
root.BackgroundColor3 = Color3.fromRGB(10, 13, 20)
root.BorderSizePixel = 0
root.CanvasSize = UDim2.fromOffset(0, 0)
root.ScrollBarImageColor3 = Color3.fromRGB(88, 106, 138)
root.ScrollBarThickness = 6
root.Size = UDim2.fromScale(1, 1)
root.Parent = widget

local content = Instance.new("Frame")
content.AutomaticSize = Enum.AutomaticSize.Y
content.BackgroundTransparency = 1
content.Size = UDim2.new(1, -24, 0, 0)
content.Position = UDim2.new(0, 12, 0, 12)
content.Parent = root

local contentLayout = Instance.new("UIListLayout")
contentLayout.Padding = UDim.new(0, 12)
contentLayout.SortOrder = Enum.SortOrder.LayoutOrder
contentLayout.Parent = content

local function createCard(layoutOrder)
	local card = Instance.new("Frame")
	card.AutomaticSize = Enum.AutomaticSize.Y
	card.BackgroundColor3 = Color3.fromRGB(14, 18, 27)
	card.BorderSizePixel = 0
	card.LayoutOrder = layoutOrder
	card.Size = UDim2.new(1, 0, 0, 0)
	applyCorner(card, 14)
	applyStroke(card, Color3.fromRGB(36, 44, 59), 1, 0)

	local padding = Instance.new("UIPadding")
	padding.PaddingTop = UDim.new(0, 12)
	padding.PaddingBottom = UDim.new(0, 12)
	padding.PaddingLeft = UDim.new(0, 12)
	padding.PaddingRight = UDim.new(0, 12)
	padding.Parent = card

	local layout = Instance.new("UIListLayout")
	layout.Padding = UDim.new(0, 8)
	layout.SortOrder = Enum.SortOrder.LayoutOrder
	layout.Parent = card

	card.Parent = content
	return card
end

local headerCard = createCard(1)

local headerTitle = createLabel("Roblox AI Bridge", 18, Color3.fromRGB(247, 249, 252), true)
headerTitle.Parent = headerCard

local headerSubtitle = createLabel(
	"Sync Studio, generate AI actions, and keep a copyable debug output directly in the plugin.",
	13,
	Color3.fromRGB(168, 180, 201),
	false
)
headerSubtitle.Parent = headerCard

local statusRow = Instance.new("Frame")
statusRow.BackgroundTransparency = 1
statusRow.Size = UDim2.new(1, 0, 0, 24)
statusRow.Parent = headerCard

local statusLayout = Instance.new("UIListLayout")
statusLayout.FillDirection = Enum.FillDirection.Horizontal
statusLayout.Padding = UDim.new(0, 10)
statusLayout.SortOrder = Enum.SortOrder.LayoutOrder
statusLayout.VerticalAlignment = Enum.VerticalAlignment.Center
statusLayout.Parent = statusRow

local statusBadge = Instance.new("TextLabel")
statusBadge.BackgroundColor3 = Color3.fromRGB(57, 113, 230)
statusBadge.BorderSizePixel = 0
statusBadge.Font = Enum.Font.GothamBold
statusBadge.Size = UDim2.new(0, 110, 1, 0)
statusBadge.Text = "READY"
statusBadge.TextColor3 = Color3.fromRGB(255, 255, 255)
statusBadge.TextSize = 12
applyCorner(statusBadge, 999)
statusBadge.Parent = statusRow

local statusDetails = createLabel("Select an object, sync, then send a prompt.", 12, Color3.fromRGB(176, 186, 204), false)
statusDetails.Size = UDim2.new(1, -120, 0, 20)
statusDetails.AutomaticSize = Enum.AutomaticSize.None
statusDetails.Parent = statusRow

local connectionCard = createCard(2)
createLabel("Connection", 15, Color3.fromRGB(240, 245, 250), true).Parent = connectionCard
createLabel("Leave the bridge running in CMD or PowerShell. The plugin can also read server logs.", 12, Color3.fromRGB(157, 171, 194), false).Parent = connectionCard

createLabel("Bridge URL", 12, Color3.fromRGB(204, 214, 230), true).Parent = connectionCard
local urlBox = createInputBox(38, "http://127.0.0.1:8123", true, false)
urlBox.MultiLine = false
urlBox.Text = plugin:GetSetting("BridgeUrl") or DEFAULT_URL
urlBox.Parent = connectionCard

createLabel("Session", 12, Color3.fromRGB(204, 214, 230), true).Parent = connectionCard
local sessionBox = createInputBox(38, "Session ID", true, false)
sessionBox.MultiLine = false
sessionBox.Text = DEFAULT_SESSION_ID
sessionBox.Parent = connectionCard

local connectionButtonsRow = Instance.new("Frame")
connectionButtonsRow.BackgroundTransparency = 1
connectionButtonsRow.Size = UDim2.new(1, 0, 0, 36)
connectionButtonsRow.Parent = connectionCard

local connectionButtonsLayout = Instance.new("UIListLayout")
connectionButtonsLayout.FillDirection = Enum.FillDirection.Horizontal
connectionButtonsLayout.Padding = UDim.new(0, 8)
connectionButtonsLayout.SortOrder = Enum.SortOrder.LayoutOrder
connectionButtonsLayout.Parent = connectionButtonsRow

local connectButton = createButton("Connect", Color3.fromRGB(46, 115, 224))
connectButton.Size = UDim2.new(0.26, 0, 1, 0)
connectButton.Parent = connectionButtonsRow

local disconnectButton = createButton("Disconnect", Color3.fromRGB(90, 98, 116))
disconnectButton.Size = UDim2.new(0.26, 0, 1, 0)
disconnectButton.Parent = connectionButtonsRow

local syncButton = createButton("Sync", Color3.fromRGB(30, 158, 103))
syncButton.Size = UDim2.new(0.18, 0, 1, 0)
syncButton.Parent = connectionButtonsRow

local fetchLogsButton = createButton("Read server logs", Color3.fromRGB(176, 110, 42))
fetchLogsButton.Size = UDim2.new(0.30, 0, 1, 0)
fetchLogsButton.Parent = connectionButtonsRow

local promptCard = createCard(3)
createLabel("Prompt", 15, Color3.fromRGB(240, 245, 250), true).Parent = promptCard
createLabel("You can copy the 'Actions JSON' and 'Generated Source' areas to apply manually.", 12, Color3.fromRGB(157, 171, 194), false).Parent = promptCard

local promptBox = createInputBox(
	150,
	"Example: in the selected script, replace the content with a script that creates a TextLabel and displays 'Hello'.",
	true,
	true
)
promptBox.Parent = promptCard

local promptButtonsRow = Instance.new("Frame")
promptButtonsRow.BackgroundTransparency = 1
promptButtonsRow.Size = UDim2.new(1, 0, 0, 36)
promptButtonsRow.Parent = promptCard

local promptButtonsLayout = Instance.new("UIListLayout")
promptButtonsLayout.FillDirection = Enum.FillDirection.Horizontal
promptButtonsLayout.Padding = UDim.new(0, 8)
promptButtonsLayout.SortOrder = Enum.SortOrder.LayoutOrder
promptButtonsLayout.Parent = promptButtonsRow

local askButton = createButton("Send to AI", Color3.fromRGB(222, 103, 48))
askButton.Size = UDim2.new(0.42, 0, 1, 0)
askButton.Parent = promptButtonsRow

local clearDebugButton = createButton("Clear debug", Color3.fromRGB(74, 82, 101))
clearDebugButton.Size = UDim2.new(0.26, 0, 1, 0)
clearDebugButton.Parent = promptButtonsRow

local refreshSessionButton = createButton("Reload session", Color3.fromRGB(78, 88, 165))
refreshSessionButton.Size = UDim2.new(0.26, 0, 1, 0)
refreshSessionButton.Parent = promptButtonsRow

local debugCard = createCard(4)
createLabel("Copyable Debug", 15, Color3.fromRGB(240, 245, 250), true).Parent = debugCard
createLabel("Click in a gray area then press Ctrl+A / Ctrl+C.", 12, Color3.fromRGB(157, 171, 194), false).Parent = debugCard

createLabel("Last Error", 12, Color3.fromRGB(224, 188, 188), true).Parent = debugCard
local lastErrorBox = createInputBox(96, "Plugin/server errors appear here.", true, true)
lastErrorBox.Parent = debugCard

createLabel("Last Actions JSON", 12, Color3.fromRGB(198, 214, 243), true).Parent = debugCard
local lastActionsBox = createInputBox(160, "The raw action batch will appear here.", true, false)
lastActionsBox.Parent = debugCard

createLabel("Generated Source", 12, Color3.fromRGB(198, 214, 243), true).Parent = debugCard
local generatedSourceBox = createInputBox(170, "The generated Lua code appears here when the AI returns Source.", true, false)
generatedSourceBox.Parent = debugCard

createLabel("Server Console", 12, Color3.fromRGB(198, 214, 243), true).Parent = debugCard
local serverLogsBox = createInputBox(170, "Node server output appears here after 'Read server logs'.", true, false)
serverLogsBox.Parent = debugCard

createLabel("Plugin Logs", 12, Color3.fromRGB(198, 214, 243), true).Parent = debugCard
local pluginLogsBox = createInputBox(150, "Plugin events will appear here.", true, false)
pluginLogsBox.Parent = debugCard

local function jsonEncodeSafe(value)
	local ok, encoded = pcall(function()
		return HttpService:JSONEncode(value)
	end)
	if ok then
		return encoded
	end
	return tostring(value)
end

local function trim(text)
	return (string.gsub(text or "", "^%s*(.-)%s*$", "%1"))
end

local function saveSettings()
	plugin:SetSetting("BridgeUrl", trim(urlBox.Text))
	plugin:SetSetting("SessionId", trim(sessionBox.Text))
end

local function setStatus(labelText, detailsText, color)
	statusBadge.Text = labelText
	statusBadge.BackgroundColor3 = color or Color3.fromRGB(57, 113, 230)
	statusDetails.Text = detailsText or ""
end

local function setLastError(message)
	lastErrorBox.Text = message or ""
end

local function setLastActions(payload)
	lastActionsBox.Text = payload or ""
end

local function setGeneratedSource(payload)
	generatedSourceBox.Text = payload or ""
end

local function setServerLogs(payload)
	serverLogsBox.Text = payload or ""
end

local function rebuildPluginLogsBox()
	pluginLogsBox.Text = table.concat(pluginLogs, "\n")
end

local function appendPluginLog(message)
	local timestamp = os.date("%H:%M:%S")
	table.insert(pluginLogs, string.format("[%s] %s", timestamp, tostring(message)))
	if #pluginLogs > 80 then
		table.remove(pluginLogs, 1)
	end
	rebuildPluginLogsBox()
end

local function handleError(context, message)
	local composed = string.format("[%s] %s", context, tostring(message))
	setLastError(composed)
	appendPluginLog(composed)
	setStatus("ERROR", context, Color3.fromRGB(200, 71, 71))
end

local function buildPath(instance)
	if instance == game then
		return "game"
	end

	local segments = {}
	local current = instance
	while current and current ~= game do
		table.insert(segments, 1, current.Name)
		current = current.Parent
	end

	table.insert(segments, 1, "game")
	return table.concat(segments, "/")
end

local function findByPath(path)
	if path == "game" then
		return game
	end

	local current = game
	for _, segment in ipairs(string.split(path, "/")) do
		if segment ~= "game" then
			current = current and current:FindFirstChild(segment) or nil
			if not current then
				return nil
			end
		end
	end

	return current
end

local function safeGet(instance, propertyName)
	local ok, value = pcall(function()
		return instance[propertyName]
	end)
	if ok then
		return value
	end
	return nil
end

local function serializeForSnapshot(value)
	local valueType = typeof(value)
	if valueType == "Vector3" then
		return {
			x = math.round(value.X * 1000) / 1000,
			y = math.round(value.Y * 1000) / 1000,
			z = math.round(value.Z * 1000) / 1000,
		}
	elseif valueType == "Color3" then
		return {
			r = math.floor(value.R * 255 + 0.5),
			g = math.floor(value.G * 255 + 0.5),
			b = math.floor(value.B * 255 + 0.5),
		}
	elseif valueType == "UDim2" then
		return {
			xScale = value.X.Scale,
			xOffset = value.X.Offset,
			yScale = value.Y.Scale,
			yOffset = value.Y.Offset,
		}
	elseif valueType == "EnumItem" then
		return tostring(value)
	elseif valueType == "string" or valueType == "number" or valueType == "boolean" then
		return value
	end

	return nil
end

local function serializeProperties(instance)
	local properties = {
		Name = serializeForSnapshot(safeGet(instance, "Name")),
	}

	if instance:IsA("BasePart") then
		properties.Anchored = safeGet(instance, "Anchored")
		properties.CanCollide = safeGet(instance, "CanCollide")
		properties.Size = serializeForSnapshot(safeGet(instance, "Size"))
		properties.Position = serializeForSnapshot(safeGet(instance, "Position"))
		properties.Color = serializeForSnapshot(safeGet(instance, "Color"))
		properties.Material = tostring(safeGet(instance, "Material"))
	elseif instance:IsA("Model") then
		local primaryPart = safeGet(instance, "PrimaryPart")
		properties.PrimaryPart = primaryPart and buildPath(primaryPart) or nil
	elseif instance:IsA("GuiObject") then
		properties.Size = serializeForSnapshot(safeGet(instance, "Size"))
		properties.Position = serializeForSnapshot(safeGet(instance, "Position"))
		properties.Visible = safeGet(instance, "Visible")
		if instance:IsA("TextLabel") or instance:IsA("TextButton") or instance:IsA("TextBox") then
			properties.Text = safeGet(instance, "Text")
		end
	elseif instance:IsA("LuaSourceContainer") then
		properties.Disabled = safeGet(instance, "Disabled")
		properties.RunContext = tostring(safeGet(instance, "RunContext"))
	end

	return properties
end

local function serializeInstance(instance, depth, maxDepth, nodeBudget, includeSource)
	if nodeBudget.count >= nodeBudget.limit then
		return nil
	end

	nodeBudget.count = nodeBudget.count + 1

	local node = {
		name = instance.Name,
		className = instance.ClassName,
		path = buildPath(instance),
		properties = serializeProperties(instance),
	}

	if includeSource and instance:IsA("LuaSourceContainer") then
		local source = safeGet(instance, "Source")
		if typeof(source) == "string" then
			if #source > 12000 then
				node.source = string.sub(source, 1, 12000) .. "\n-- [truncated by plugin]"
				node.sourceTruncated = true
			else
				node.source = source
			end
		end
	end

	if depth < maxDepth then
		node.children = {}
		for _, child in ipairs(instance:GetChildren()) do
			if nodeBudget.count >= nodeBudget.limit then
				break
			end
			local childNode = serializeInstance(child, depth + 1, maxDepth, nodeBudget, includeSource)
			if childNode then
				table.insert(node.children, childNode)
			end
		end
	end

	return node
end

local function buildSnapshot()
	local selectionItems = Selection:Get()
	local selectionBudget = {
		count = 0,
		limit = 160,
	}
	local servicesBudget = {
		count = 0,
		limit = 180,
	}

	local snapshot = {
		placeName = game.Name,
		selectedPaths = {},
		selection = {},
		services = {},
		limitations = {
			pathFormat = "game/Service/Child",
			supportedValueKinds = {
				"string",
				"number",
				"boolean",
				"Vector3",
				"Color3",
				"UDim2",
				"Enum",
			},
			note = "Script source is mainly included for selected scripts and the captured snapshot is intentionally truncated.",
		},
	}

	for _, instance in ipairs(selectionItems) do
		table.insert(snapshot.selectedPaths, buildPath(instance))
		local includeSource = instance:IsA("LuaSourceContainer")
		local serialized = serializeInstance(instance, 0, 4, selectionBudget, includeSource)
		if serialized then
			table.insert(snapshot.selection, serialized)
		end
	end

	local serviceNames = {
		"Workspace",
		"ReplicatedStorage",
		"ServerScriptService",
		"StarterGui",
		"StarterPlayer",
		"Lighting",
		"SoundService",
	}

	for _, serviceName in ipairs(serviceNames) do
		local service = game:GetService(serviceName)
		local serialized = serializeInstance(service, 0, 2, servicesBudget, false)
		if serialized then
			table.insert(snapshot.services, serialized)
		end
	end

	return snapshot
end

local function requestJson(method, path, payload)
	local body = nil
	if payload ~= nil then
		body = HttpService:JSONEncode(payload)
	end

	local ok, response = pcall(function()
		return HttpService:RequestAsync({
			Url = string.format("%s%s", trim(urlBox.Text), path),
			Method = method,
			Headers = {
				["Content-Type"] = "application/json",
				["Accept"] = "application/json",
			},
			Body = body,
		})
	end)

	if not ok then
		error(response)
	end

	if not response.Success then
		error(string.format("HTTP %d\n%s", response.StatusCode, response.Body))
	end

	if response.Body and response.Body ~= "" then
		return HttpService:JSONDecode(response.Body)
	end

	return nil
end

local function refreshServerLogs()
	local result = requestJson("GET", "/logs?lines=160", nil)
	setServerLogs(result and result.text or "")
	appendPluginLog("Server console reloaded.")
end

local function refreshSessionDetails()
	local sessionId = trim(sessionBox.Text)
	local result = requestJson("GET", "/session?sessionId=" .. HttpService:UrlEncode(sessionId), nil)
	if result then
		if result.lastResult then
			setLastActions(jsonEncodeSafe(result.lastResult))
		end
		if result.lastError then
			setLastError((result.lastError.details or result.lastError.message or ""))
		end
		appendPluginLog("Session reloaded.")
	end
end

local function syncSnapshot(reason)
	local snapshot = buildSnapshot()
	local result = requestJson("POST", "/sync", {
		sessionId = trim(sessionBox.Text),
		reason = reason or "manual",
		snapshot = snapshot,
	})
	appendPluginLog("Snapshot synchronized.")
	return result
end

local function decodeValue(serializedValue)
	assert(type(serializedValue) == "table", "Invalid serialized value")
	local kind = serializedValue.kind

	if kind == "string" then
		return serializedValue.string or ""
	elseif kind == "number" then
		return tonumber(serializedValue.number) or 0
	elseif kind == "boolean" then
		return serializedValue.boolean == true
	elseif kind == "Vector3" then
		return Vector3.new(
			tonumber(serializedValue.x) or 0,
			tonumber(serializedValue.y) or 0,
			tonumber(serializedValue.z) or 0
		)
	elseif kind == "Color3" then
		local r = math.clamp(math.floor(tonumber(serializedValue.r) or 0), 0, 255)
		local g = math.clamp(math.floor(tonumber(serializedValue.g) or 0), 0, 255)
		local b = math.clamp(math.floor(tonumber(serializedValue.b) or 0), 0, 255)
		return Color3.fromRGB(r, g, b)
	elseif kind == "UDim2" then
		return UDim2.new(
			tonumber(serializedValue.xScale) or 0,
			tonumber(serializedValue.xOffset) or 0,
			tonumber(serializedValue.yScale) or 0,
			tonumber(serializedValue.yOffset) or 0
		)
	elseif kind == "Enum" then
		local enumTable = Enum[serializedValue.enumType]
		assert(enumTable, "Unknown enum type: " .. tostring(serializedValue.enumType))
		local enumItem = enumTable[serializedValue.enumName]
		assert(enumItem, "Unknown enum item: " .. tostring(serializedValue.enumName))
		return enumItem
	end

	error("Unsupported value kind: " .. tostring(kind))
end

local function setProperty(target, propertyName, serializedValue)
	if propertyName == "Source" then
		assert(target:IsA("LuaSourceContainer"), "Target does not support Source")
		target.Source = serializedValue.string or ""
		return
	end

	target[propertyName] = decodeValue(serializedValue)
end

local function applyAction(action)
	assert(type(action) == "table", "Action must be a table")
	local actionType = action.type

	if actionType == "create_instance" then
		local parent = findByPath(action.parentPath)
		assert(parent, "Parent path not found: " .. tostring(action.parentPath))
		local instance = Instance.new(action.className)
		instance.Name = action.name ~= "" and action.name or action.className

		if type(action.properties) == "table" then
			for _, propertyPatch in ipairs(action.properties) do
				setProperty(instance, propertyPatch.property, propertyPatch.value)
			end
		end

		if type(action.source) == "string" and action.source ~= "" then
			assert(instance:IsA("LuaSourceContainer"), "Created class does not support Source")
			instance.Source = action.source
		end

		instance.Parent = parent
		appendPluginLog("Created: " .. buildPath(instance))
	elseif actionType == "set_property" then
		local target = findByPath(action.targetPath)
		assert(target, "Target path not found: " .. tostring(action.targetPath))
		setProperty(target, action.property, action.value)
		appendPluginLog("Property modified: " .. tostring(action.property) .. " on " .. tostring(action.targetPath))
	elseif actionType == "set_source" then
		local target = findByPath(action.targetPath)
		assert(target, "Target path not found: " .. tostring(action.targetPath))
		assert(target:IsA("LuaSourceContainer"), "Target does not support Source")
		target.Source = action.source or ""
		appendPluginLog("Source updated: " .. tostring(action.targetPath))
	elseif actionType == "rename_instance" then
		local target = findByPath(action.targetPath)
		assert(target, "Target path not found: " .. tostring(action.targetPath))
		target.Name = action.newName
		appendPluginLog("Renamed: " .. tostring(action.targetPath) .. " -> " .. tostring(action.newName))
	elseif actionType == "destroy_instance" then
		local target = findByPath(action.targetPath)
		assert(target, "Target path not found: " .. tostring(action.targetPath))
		target:Destroy()
		appendPluginLog("Deleted: " .. tostring(action.targetPath))
	elseif actionType == "reparent_instance" then
		local target = findByPath(action.targetPath)
		local newParent = findByPath(action.parentPath)
		assert(target, "Target path not found: " .. tostring(action.targetPath))
		assert(newParent, "Parent path not found: " .. tostring(action.parentPath))
		target.Parent = newParent
		appendPluginLog("Moved: " .. tostring(action.targetPath) .. " -> " .. tostring(action.parentPath))
	else
		error("Unsupported action type: " .. tostring(actionType))
	end
end

local function extractGeneratedSource(actions)
	local chunks = {}
	for _, action in ipairs(actions or {}) do
		if action.type == "set_source" and type(action.source) == "string" and action.source ~= "" then
			table.insert(chunks, "-- " .. tostring(action.targetPath or "unknown") .. "\n" .. action.source)
		elseif action.type == "create_instance" and type(action.source) == "string" and action.source ~= "" then
			local targetPath = tostring(action.parentPath or "unknown") .. "/" .. tostring(action.name or action.className or "Script")
			table.insert(chunks, "-- " .. targetPath .. "\n" .. action.source)
		end
	end

	if #chunks == 0 then
		return "-- No Source code in this batch."
	end

	return table.concat(chunks, "\n\n------------------------------\n\n")
end

local function applyActions(actions, summary, warnings)
	if isApplyingActions then
		appendPluginLog("Plugin is already applying actions, new batch ignored.")
		return
	end

	isApplyingActions = true
	setStatus("APPLYING", "Applying actions...", Color3.fromRGB(33, 157, 104))

	ChangeHistoryService:SetWaypoint("AI Bridge - before")

	for index, action in ipairs(actions) do
		local ok, errorMessage = pcall(function()
			applyAction(action)
		end)
		if not ok then
			handleError("Action " .. tostring(index), errorMessage)
		end
	end

	ChangeHistoryService:SetWaypoint("AI Bridge - after")

	if summary and summary ~= "" then
		appendPluginLog("AI Summary: " .. summary)
	end

	if type(warnings) == "table" then
		for _, warning in ipairs(warnings) do
			appendPluginLog("Warning: " .. tostring(warning))
		end
	end

	local ok, syncError = pcall(function()
		syncSnapshot("post-apply")
	end)
	if not ok then
		handleError("Resync after apply", syncError)
	end

	isApplyingActions = false
	setStatus("READY", "Changes applied. You can undo with Ctrl+Z.", Color3.fromRGB(57, 113, 230))
end

local function disconnectStream()
	for _, connection in ipairs(streamConnections) do
		connection:Disconnect()
	end
	streamConnections = {}

	if streamClient then
		pcall(function()
			streamClient:Close()
		end)
		streamClient = nil
	end
end

local function parseStreamMessage(rawMessage)
	local eventName = nil
	local dataLines = {}

	for line in string.gmatch(rawMessage, "[^\r\n]+") do
		if string.sub(line, 1, 7) == "event: " then
			eventName = string.sub(line, 8)
		elseif string.sub(line, 1, 6) == "data: " then
			table.insert(dataLines, string.sub(line, 7))
		elseif line == "data:" then
			table.insert(dataLines, "")
		end
	end

	local payloadText = #dataLines > 0 and table.concat(dataLines, "\n") or rawMessage
	local ok, decoded = pcall(function()
		return HttpService:JSONDecode(payloadText)
	end)

	if ok then
		return eventName, decoded
	end

	return eventName, {
		type = "raw",
		message = rawMessage,
	}
end

local function connectStream()
	saveSettings()
	disconnectStream()
	setStatus("CONNECTING", "Opening Studio -> bridge stream...", Color3.fromRGB(162, 110, 42))

	local streamUrl = string.format(
		"%s/stream?sessionId=%s",
		trim(urlBox.Text),
		HttpService:UrlEncode(trim(sessionBox.Text))
	)

	local ok, clientOrError = pcall(function()
		return HttpService:CreateWebStreamClient(Enum.WebStreamClientType.SSE, {
			Url = streamUrl,
			Method = "GET",
			Headers = {
				["Accept"] = "text/event-stream",
			},
		})
	end)

	if not ok then
		error(clientOrError)
	end

	streamClient = clientOrError

	table.insert(streamConnections, streamClient.Opened:Connect(function(statusCode, headers)
		setStatus("CONNECTED", "Live stream connected to local server.", Color3.fromRGB(33, 157, 104))
		appendPluginLog("Stream opened (" .. tostring(statusCode) .. ")")
		appendPluginLog("If Roblox Studio displays a plugin HTTP permission, accept localhost.")
		local _ = headers
		local success, errorMessage = pcall(refreshServerLogs)
		if not success then
			handleError("Server logs read", errorMessage)
		end
	end))

	table.insert(streamConnections, streamClient.Closed:Connect(function()
		appendPluginLog("Stream closed.")
		setStatus("OFFLINE", "No active stream.", Color3.fromRGB(90, 98, 116))
	end))

	table.insert(streamConnections, streamClient.Error:Connect(function(statusCode, errorMessage)
		handleError("Stream error " .. tostring(statusCode), errorMessage)
		local success = pcall(refreshServerLogs)
		if not success then
			appendPluginLog("Could not reload server console after stream error.")
		end
	end))

	table.insert(streamConnections, streamClient.MessageReceived:Connect(function(message)
		local eventName, payload = parseStreamMessage(message)
		local messageType = payload.type or eventName or "message"

		if messageType == "hello" then
			appendPluginLog(payload.message or "Bridge connected.")
		elseif messageType == "snapshot_synced" then
			appendPluginLog("Snapshot received by the bridge.")
		elseif messageType == "info" then
			appendPluginLog(payload.message or "Bridge info.")
		elseif messageType == "error" then
			setLastError(tostring(payload.details or payload.message or "Unknown server error."))
			appendPluginLog("Bridge error: " .. tostring(payload.message))
			setStatus("ERROR", "The bridge returned an error.", Color3.fromRGB(200, 71, 71))
			local success, errorMessage = pcall(refreshServerLogs)
			if not success then
				appendPluginLog("Server logs read error: " .. tostring(errorMessage))
			end
		elseif messageType == "actions_ready" then
			local actionsPayload = {
				summary = payload.summary,
				warnings = payload.warnings,
				actions = payload.actions,
			}
			setLastActions(jsonEncodeSafe(actionsPayload))
			setGeneratedSource(extractGeneratedSource(payload.actions or {}))
			appendPluginLog(string.format("Action batch received (%d action(s)).", #(payload.actions or {})))
			applyActions(payload.actions or {}, payload.summary, payload.warnings)
		else
			appendPluginLog("Stream message: " .. jsonEncodeSafe(payload))
		end
	end))
end

openButton.Click:Connect(function()
	widget.Enabled = not widget.Enabled
end)

connectButton.MouseButton1Click:Connect(function()
	local ok, errorMessage = pcall(connectStream)
	if not ok then
		handleError("Connection", errorMessage)
	end
end)

disconnectButton.MouseButton1Click:Connect(function()
	disconnectStream()
	setStatus("OFFLINE", "Stream closed manually.", Color3.fromRGB(90, 98, 116))
	appendPluginLog("Manual disconnection.")
end)

syncButton.MouseButton1Click:Connect(function()
	saveSettings()
	local ok, errorMessage = pcall(function()
		syncSnapshot("manual")
	end)
	if ok then
		setStatus("SYNC", "Snapshot sent to bridge.", Color3.fromRGB(30, 158, 103))
	else
		handleError("Sync", errorMessage)
	end
end)

fetchLogsButton.MouseButton1Click:Connect(function()
	local ok, errorMessage = pcall(refreshServerLogs)
	if not ok then
		handleError("Server logs read", errorMessage)
	end
end)

refreshSessionButton.MouseButton1Click:Connect(function()
	local ok, errorMessage = pcall(refreshSessionDetails)
	if not ok then
		handleError("Session reload", errorMessage)
	end
end)

clearDebugButton.MouseButton1Click:Connect(function()
	pluginLogs = {}
	rebuildPluginLogsBox()
	setLastError("")
	setLastActions("")
	setGeneratedSource("")
	appendPluginLog("Debug areas cleared.")
end)

askButton.MouseButton1Click:Connect(function()
	saveSettings()

	if not streamClient then
		local ok, errorMessage = pcall(connectStream)
		if not ok then
			handleError("Connection before prompt", errorMessage)
			return
		end
	end

	local prompt = trim(promptBox.Text)
	if prompt == "" then
		handleError("Prompt", "Prompt is empty.")
		return
	end

	local ok, errorMessage = pcall(function()
		syncSnapshot("pre-prompt")
		requestJson("POST", "/prompt", {
			sessionId = trim(sessionBox.Text),
			prompt = prompt,
		})
	end)

	if ok then
		setStatus("AI", "Generating actions...", Color3.fromRGB(222, 103, 48))
		appendPluginLog("Prompt sent to bridge.")
	else
		handleError("Prompt", errorMessage)
		local success, logsError = pcall(refreshServerLogs)
		if not success then
			appendPluginLog("Could not reload server console: " .. tostring(logsError))
		end
	end
end)

Selection.SelectionChanged:Connect(function()
	local selected = Selection:Get()
	if #selected == 0 then
		appendPluginLog("Selection empty.")
	else
		appendPluginLog("Selection changed: " .. buildPath(selected[1]))
	end
end)

plugin.Unloading:Connect(function()
	disconnectStream()
end)

widget:BindToClose(function()
	disconnectStream()
	widget.Enabled = false
end)

appendPluginLog("Plugin loaded. Run start-bridge.cmd or start-bridge.ps1, then click Connect.")
appendPluginLog("Debug areas are copyable to retrieve errors, action JSONs, and Source code.")
setStatus("READY", "Local bridge not connected yet.", Color3.fromRGB(57, 113, 230))