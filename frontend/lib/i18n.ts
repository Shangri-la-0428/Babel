const translations = {
  // Nav & global
  home: { cn: "首页", en: "Home" },
  create: { cn: "创建", en: "Create" },
  assets: { cn: "资产", en: "Assets" },
  settings: { cn: "设置", en: "Settings" },
  simulate: { cn: "模拟", en: "Simulate" },
  dismiss: { cn: "关闭", en: "Dismiss" },
  close: { cn: "关闭", en: "Close" },
  cancel: { cn: "取消", en: "Cancel" },
  delete: { cn: "删除", en: "Delete" },
  resume: { cn: "恢复", en: "Resume" },
  saved: { cn: "已保存", en: "Saved" },

  // Home
  available_worlds: { cn: "可用世界", en: "Available Worlds" },
  previous_sessions: { cn: "历史会话", en: "Previous Sessions" },
  create_custom: { cn: "+ 创建自定义世界", en: "+ Create Custom World" },
  no_seeds: { cn: "未找到种子文件", en: "No seed files found" },
  failed_load: { cn: "加载失败，后端是否运行？", en: "Failed to load. Is the backend running?" },

  // Sim
  event_feed: { cn: "事件流", en: "Event Feed" },
  agents: { cn: "角色", en: "Agents" },
  world_state: { cn: "世界状态", en: "World State" },
  no_events: { cn: "暂无事件，点击 Run 或 Step 开始", en: "No events yet. Press Run or Step to start." },
  inject_placeholder: { cn: "注入事件后自动推演一轮...", en: "Inject event (auto-advances one tick)..." },
  inject: { cn: "注入", en: "Inject" },
  events_count: { cn: "条事件", en: "Events" },
  total: { cn: "个", en: "Total" },
  extract_world: { cn: "提取世界", en: "Extract World" },
  disconnected: { cn: "已断开", en: "Disconnected" },

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
  rules: { cn: "规则（每行一条）", en: "Rules (one per line)" },
  locations: { cn: "地点（名称: 描述，每行一个）", en: "Locations (name: desc, one per line)" },
  initial_events: { cn: "初始事件（每行一个）", en: "Initial Events (one per line)" },
  add_agent: { cn: "+ 添加角色", en: "+ Add Agent" },
  remove: { cn: "移除", en: "Remove" },
  personality: { cn: "性格", en: "Personality" },
  goals: { cn: "目标（每行一个）", en: "Goals (one per line)" },
  inventory: { cn: "物品（逗号分隔）", en: "Inventory (comma separated)" },
  starting_location: { cn: "初始位置", en: "Starting Location" },
  create_launch: { cn: "创建并启动", en: "Create & Launch" },
  creating: { cn: "创建中...", en: "Creating..." },
  import_from_assets: { cn: "+ 从资产库导入", en: "+ Import from Assets" },
  hide_assets: { cn: "- 收起资产", en: "- Hide Assets" },
  agent_seeds: { cn: "角色种子", en: "Agent Seeds" },
  event_seeds: { cn: "事件种子", en: "Event Seeds" },

  // Settings error
  api_key_required: { cn: "请先在右上角 Settings 中配置 API Key", en: "Please configure API Key in Settings first" },
  run_failed: { cn: "启动失败，请检查后端和 LLM 设置", en: "Failed to start. Check backend and LLM settings." },
  pause_failed: { cn: "暂停失败", en: "Failed to pause" },
  step_failed: { cn: "单步执行失败，请检查 LLM 设置", en: "Step failed. Check LLM settings." },
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

export function t(key: TransKey, locale: Locale): string {
  const entry = translations[key];
  return entry?.[locale] ?? key;
}
