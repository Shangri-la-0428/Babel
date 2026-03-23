const translations = {
  // Nav & global
  home: { cn: "首页", en: "Home" },
  create: { cn: "创建", en: "Create" },
  assets: { cn: "资产", en: "Assets" },
  settings: { cn: "设置", en: "Settings" },
  simulate: { cn: "模拟", en: "Simulate" },
  dismiss: { cn: "忽略", en: "Dismiss" },
  close: { cn: "关闭", en: "Close" },
  cancel: { cn: "取消", en: "Cancel" },
  delete: { cn: "删除", en: "Delete" },
  resume: { cn: "继续模拟", en: "Continue" },
  saved: { cn: "已保存", en: "Saved" },

  // Home
  back: { cn: "← 返回", en: "← Back" },
  available_worlds: { cn: "可用世界", en: "Available Worlds" },
  previous_sessions: { cn: "历史会话", en: "Previous Sessions" },
  create_custom: { cn: "+ 创建自定义世界", en: "+ Create Custom World" },
  no_seeds: { cn: "尚无世界。创建你的第一个世界，或将种子 YAML 放入 seeds/ 目录。", en: "No worlds yet. Create your first world, or drop seed YAML files into seeds/." },
  failed_load: { cn: "加载失败，后端是否运行？", en: "Failed to load. Is the backend running?" },

  // World detail
  world_start_new: { cn: "开始新模拟", en: "Start New" },
  edit_world: { cn: "编辑", en: "Edit" },
  save_launch: { cn: "保存并启动", en: "Save & Launch" },
  add_location: { cn: "+ 添加地点", en: "+ Add Location" },
  add_rule: { cn: "+ 添加规则", en: "+ Add Rule" },
  add_event: { cn: "+ 添加事件", en: "+ Add Event" },
  one_per_line: { cn: "每行一条，回车添加新行", en: "One per line, press Enter to add" },
  save_agent_seed: { cn: "保存种子", en: "Save Seed" },
  save_location_seed: { cn: "保存种子", en: "Save Seed" },
  save_world_seed: { cn: "保存世界种子", en: "Save World Seed" },
  saved_ok: { cn: "已保存", en: "Saved" },
  generate_details: { cn: "生成详情", en: "Generate Details" },
  generating: { cn: "生成中...", en: "Generating..." },
  gen_item_failed: { cn: "生成物品详情失败", en: "Failed to generate item details" },
  item_detail: { cn: "物品详情", en: "Item Detail" },
  world_saves: { cn: "存档", en: "Saves" },
  world_saves_count: { cn: "个存档", en: "Saves" },
  world_no_saves: { cn: "暂无存档，开始新模拟", en: "No saves yet. Start a new simulation." },
  world_active: { cn: "进行中", en: "Active" },
  world_ended: { cn: "已结束", en: "Ended" },
  world_review: { cn: "查看", en: "Review" },

  // Sim
  event_feed: { cn: "事件流", en: "Event Feed" },
  agents: { cn: "角色", en: "Agents" },
  world_state: { cn: "世界状态", en: "World State" },
  no_events: { cn: "暂无事件，点击运行或单步开始", en: "No events yet. Press Run or Step to begin." },
  inject_placeholder: { cn: "注入事件后自动推演一轮...", en: "Inject event (auto-advances one tick)..." },
  inject: { cn: "注入", en: "Inject" },
  events_count: { cn: "条事件", en: "Events" },
  total: { cn: "个", en: "Total" },
  extract_world: { cn: "提取世界", en: "Extract World" },
  disconnected: { cn: "已断开", en: "Disconnected" },
  connecting: { cn: "连接中", en: "Connecting" },

  // Agent card
  location: { cn: "位置", en: "Location" },
  goal: { cn: "目标", en: "Goal" },
  chat: { cn: "对话", en: "Chat" },
  extract: { cn: "提取", en: "Extract" },

  // Assets
  assets_title: { cn: "资产库", en: "Assets" },
  assets_desc: { cn: "从模拟中提取的可复用种子", en: "Reusable seeds extracted from simulations" },
  no_seeds_yet: { cn: "暂无种子", en: "No seeds yet" },
  no_seeds_desc: { cn: "从运行中的模拟提取角色、物品、地点和事件作为可复用种子", en: "Extract agents, items, locations, and events from running simulations as reusable seeds." },
  all: { cn: "全部", en: "All" },
  world: { cn: "世界", en: "World" },
  agent: { cn: "角色", en: "Agent" },
  item: { cn: "物品", en: "Item" },
  event: { cn: "事件", en: "Event" },

  // Create
  create_world: { cn: "创建世界", en: "Create World" },
  world_name: { cn: "世界名称", en: "World Name" },
  description: { cn: "描述", en: "Description" },
  rules: { cn: "规则", en: "Rules" },
  locations: { cn: "地点", en: "Locations" },
  initial_events: { cn: "初始事件", en: "Initial Events" },
  add_agent: { cn: "+ 添加角色", en: "+ Add Agent" },
  remove: { cn: "移除", en: "Remove" },
  personality: { cn: "性格", en: "Personality" },
  goals: { cn: "目标", en: "Goals" },
  inventory: { cn: "物品", en: "Inventory" },
  starting_location: { cn: "初始位置", en: "Starting Location" },
  create_launch: { cn: "创建并启动", en: "Create & Launch" },
  creating: { cn: "创建中...", en: "Creating..." },
  import_from_assets: { cn: "+ 从资产库导入", en: "+ Import from Assets" },
  hide_assets: { cn: "- 收起资产", en: "- Hide Assets" },
  agent_seeds: { cn: "角色种子", en: "Agent Seeds" },
  event_seeds: { cn: "事件种子", en: "Event Seeds" },
  name: { cn: "名称", en: "Name" },
  agent_n: { cn: "角色 {0}", en: "Agent {0}" },
  ph_world_name: { cn: "输入世界名称", en: "Enter world name" },
  ph_description: { cn: "描述世界设定...", en: "Describe the world setting..." },
  ph_rules: { cn: "每行一条规则，如：角色不能飞行", en: "One rule per line, e.g.: Agents cannot fly" },
  ph_locations: { cn: "名称: 描述，每行一个。如：吧台: 酒馆的主要区域", en: "Name: description, one per line. e.g.: Bar: The main area" },
  ph_events: { cn: "每行一个事件，如：一声巨响从远处传来", en: "One event per line, e.g.: A loud crash echoes from afar" },
  ph_agent_name: { cn: "角色名称", en: "Agent name" },
  ph_personality: { cn: "特征...", en: "Traits..." },
  ph_agent_desc: { cn: "这个角色是谁？", en: "Who is this agent?" },
  ph_goals: { cn: "每行一个目标，如：寻找丢失的宝剑", en: "One goal per line, e.g.: Find the lost sword" },
  ph_inventory: { cn: "逗号分隔，如：匕首, 火把", en: "Comma separated, e.g.: dagger, torch" },
  ph_location: { cn: "地点名称", en: "Location name" },

  // Settings error
  api_key_required: { cn: "请先在 Settings 中配置 API Key", en: "Configure your API Key in Settings first" },
  run_failed: { cn: "启动失败，请检查后端和 LLM 设置", en: "Failed to start. Check backend and LLM settings." },
  pause_failed: { cn: "暂停失败", en: "Failed to pause" },
  step_failed: { cn: "单步执行失败，请检查 LLM 设置", en: "Step failed. Check LLM settings." },

  // Agent detail modal
  agent_detail: { cn: "角色详情", en: "Agent Detail" },
  goals_label: { cn: "目标", en: "Goals" },
  memory: { cn: "记忆", en: "Memory" },
  inventory_label: { cn: "物品", en: "Inventory" },
  status_label: { cn: "状态", en: "Status" },
  extract_seed: { cn: "生成种子", en: "Generate Seed" },

  // Seed preview modal
  seed_preview: { cn: "种子预览", en: "Seed Preview" },
  save_to_assets: { cn: "保存到资产库", en: "Save to Assets" },
  seed_name: { cn: "名称", en: "Name" },
  seed_desc: { cn: "描述", en: "Description" },
  seed_tags: { cn: "标签", en: "Tags" },
  saving: { cn: "保存中...", en: "Saving..." },
  source: { cn: "来源", en: "Source" },

  // Error messages
  gen_agent_seed_failed: { cn: "生成角色种子失败", en: "Failed to generate agent seed" },
  gen_event_seed_failed: { cn: "生成事件种子失败", en: "Failed to generate event seed" },
  gen_world_seed_failed: { cn: "生成世界种子失败", en: "Failed to generate world seed" },
  no_session: { cn: "未找到模拟会话", en: "No simulation session found." },
  go_home: { cn: "返回首页", en: "Go home" },
  retry: { cn: "重试", en: "Retry" },
  manual: { cn: "手动", en: "manual" },

  // Control bar
  run: { cn: "运行", en: "Run" },
  pause: { cn: "暂停", en: "Pause" },
  step: { cn: "单步", en: "Step" },
  tick: { cn: "回合", en: "Tick" },
  aria_run: { cn: "运行模拟", en: "Run simulation" },
  aria_pause: { cn: "暂停模拟", en: "Pause simulation" },
  aria_step: { cn: "推演一步", en: "Advance one tick" },
  aria_controls: { cn: "模拟控制", en: "Simulation controls" },

  // Event feed
  system: { cn: "系统", en: "System" },
  seed: { cn: "种子", en: "Seed" },

  // Settings panel
  llm_config: { cn: "LLM 配置", en: "LLM Configuration" },
  api_base_url: { cn: "API 地址", en: "API Base URL" },
  api_key: { cn: "API 密钥", en: "API Key" },
  tick_delay: { cn: "回合延迟（秒）", en: "Tick Delay (sec)" },
  model: { cn: "模型", en: "Model" },
  fetch_models: { cn: "获取模型列表", en: "Fetch Models" },
  loading: { cn: "加载中...", en: "Loading..." },
  save: { cn: "保存", en: "Save" },
  settings_saved: { cn: "设置已保存", en: "Settings saved" },
  connected_models: { cn: "已连接", en: "Connected" },
  connection_failed: { cn: "连接失败", en: "Connection failed" },

  // Agent chat
  chat_with: { cn: "与{0}对话", en: "Chat with {0}" },
  send: { cn: "发送", en: "Send" },
  you: { cn: "你", en: "You" },
  thinking: { cn: "思考中...", en: "Thinking..." },
  chat_empty: { cn: "发送消息，与{0}角色对话", en: "Send a message to talk with {0} in character" },
  chat_placeholder: { cn: "对{0}说...", en: "Say something to {0}..." },
  chat_failed: { cn: "获取回复失败", en: "Failed to get response" },

  // Error messages (additional)
  failed_load_state: { cn: "加载世界状态失败，后端是否运行？", en: "Failed to load world state. Is the backend running?" },
  failed_create: { cn: "创建失败，请检查后端连接", en: "Failed to create world. Check backend connection." },
  failed_load_detail: { cn: "加载世界详情失败", en: "Failed to load world details." },
  lost_connection: { cn: "与服务器断开连接，请刷新页面", en: "Lost connection. Please refresh." },
  engine_error: { cn: "引擎错误", en: "Engine error" },

  // Asset panel (sim sidebar)
  panel_holders: { cn: "持有者", en: "Holder(s)" },
  panel_held_by: { cn: "持有者", en: "Held By" },
  panel_no_agents: { cn: "运行模拟后角色会出现在此处", en: "Agents will appear here once the simulation runs" },
  panel_no_items: { cn: "角色获取物品后显示在此处", en: "Items appear as agents acquire inventory" },
  panel_no_locations: { cn: "运行模拟后地点会出现在此处", en: "Locations will appear once the simulation runs" },
  panel_no_world: { cn: "世界未加载", en: "No world loaded" },
  panel_no_rules: { cn: "此世界暂无规则定义", en: "No rules defined in this world" },
  sending: { cn: "发送中", en: "Sending" },

  // Seed data labels (used in SeedDataView)
  tags_label: { cn: "标签", en: "Tags" },
  content_label: { cn: "内容", en: "Content" },
  action_type: { cn: "动作类型", en: "Action Type" },
  rules_label: { cn: "规则", en: "Rules" },
  locations_label: { cn: "地点", en: "Locations" },
  initial_events_label: { cn: "初始事件", en: "Initial Events" },

  lang_switch: { cn: "切换语言", en: "Switch language" },

  // Home page
  tagline: { cn: "种子 + AI 运行时 = 世界状态机", en: "Seed + AI Runtime = World State Machine" },
  world_count: { cn: "{0} 个世界就绪", en: "{0} worlds ready" },
  select_world: { cn: "选择世界进入", en: "Select a world to enter" },

  // Timeline
  timeline: { cn: "时间线", en: "Timeline" },
  new_branch: { cn: "新分支", en: "New Branch" },
  timeline_empty: { cn: "尚无时间线，开始第一次模拟", en: "No timelines yet. Start your first simulation." },
  branch_active: { cn: "进行中", en: "Active" },
  branch_ended: { cn: "已结束", en: "Ended" },
  branch_enter: { cn: "进入", en: "Enter" },
  branch_delete: { cn: "删除分支", en: "Delete Branch" },
  branch_delete_confirm: { cn: "确定删除此分支？所有事件和存档将不可恢复。", en: "Delete this branch? All events and data will be permanently lost." },
  branch_created: { cn: "创建于", en: "Created" },
  branch_no_events: { cn: "暂无事件", en: "No events yet" },
  view_all_assets: { cn: "查看全部资产 →", en: "View All Assets →" },
  inject_failed: { cn: "注入失败", en: "Inject failed" },
} as const;

export type TransKey = keyof typeof translations;
export type Locale = "cn" | "en";

const LOCALE_KEY = "babel_locale";

export function detectLocale(): Locale {
  if (typeof window === "undefined") return "cn";
  const saved = localStorage.getItem(LOCALE_KEY);
  if (saved === "cn" || saved === "en") return saved;
  const lang = navigator.language.toLowerCase();
  return lang.startsWith("zh") ? "cn" : "en";
}

export function setLocale(locale: Locale): void {
  localStorage.setItem(LOCALE_KEY, locale);
}

export function t(key: TransKey, locale: Locale, ...args: string[]): string {
  const entry = translations[key];
  let str: string = entry?.[locale] ?? key;
  for (let i = 0; i < args.length; i++) {
    str = str.replace(`{${i}}`, args[i]);
  }
  return str;
}
