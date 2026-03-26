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
  no_seeds: { cn: "// EMPTY — 暂无世界种子。创建自定义世界或将 YAML 放入 seeds/", en: "// EMPTY — No world seeds found. Create a custom world or drop YAML into seeds/" },
  failed_load: { cn: "// LINK_DOWN — 后端未响应，检查服务状态", en: "// LINK_DOWN — Backend unreachable. Check service status." },

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
  inject_placeholder: { cn: "注入事件（自动推进一步）...", en: "Inject event (auto-advances one tick)..." },
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
  no_seeds_yet: { cn: "// EMPTY — 暂无种子", en: "// EMPTY — No seeds" },
  no_seeds_desc: { cn: "运行模拟后，从角色、物品、地点和事件中提取可复用种子", en: "Run a simulation, then extract reusable seeds from agents, items, locations, and events." },
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
  hint_one_per_line: { cn: "每行一条，回车换行", en: "One per line, press Enter to add" },
  ph_agent_name: { cn: "角色名称", en: "Agent name" },
  ph_personality: { cn: "特征...", en: "Traits..." },
  ph_agent_desc: { cn: "这个角色是谁？", en: "Who is this agent?" },
  ph_goals: { cn: "每行一个目标，如：寻找丢失的宝剑", en: "One goal per line, e.g.: Find the lost sword" },
  ph_inventory: { cn: "逗号分隔，如：匕首, 火把", en: "Comma separated, e.g.: dagger, torch" },
  ph_location: { cn: "地点名称", en: "Location name" },

  // Settings error
  api_key_required: { cn: "// AUTH — 需要 API Key，在设置中配置", en: "// AUTH — API Key required. Configure in Settings." },
  run_failed: { cn: "// RUN_ERR — 启动失败，检查后端连接和 LLM 配置", en: "// RUN_ERR — Start failed. Check backend and LLM config." },
  pause_failed: { cn: "// PAUSE_ERR — 暂停指令失败，重试或刷新页面", en: "// PAUSE_ERR — Pause command failed. Retry or refresh." },
  step_failed: { cn: "// STEP_ERR — 单步失败，检查 LLM 配置", en: "// STEP_ERR — Step failed. Check LLM config." },

  // Agent detail modal
  agent_detail: { cn: "角色详情", en: "Agent Detail" },
  goals_label: { cn: "目标", en: "Goals" },
  memory: { cn: "记忆", en: "Memory" },
  inventory_label: { cn: "物品", en: "Inventory" },
  psyche_emotion: { cn: "情绪状态", en: "Emotional State" },
  psyche_chemicals: { cn: "神经化学", en: "Neurochemistry" },
  psyche_autonomic: { cn: "自主神经", en: "Autonomic" },
  psyche_drives: { cn: "内驱力", en: "Drives" },
  psyche_dopamine: { cn: "多巴胺", en: "Dopamine" },
  psyche_serotonin: { cn: "血清素", en: "Serotonin" },
  psyche_cortisol: { cn: "皮质醇", en: "Cortisol" },
  psyche_oxytocin: { cn: "催产素", en: "Oxytocin" },
  psyche_norepinephrine: { cn: "去甲肾上腺素", en: "Norepinephrine" },
  psyche_endorphins: { cn: "内啡肽", en: "Endorphins" },
  psyche_ventral_vagal: { cn: "腹侧迷走（安全）", en: "Ventral-Vagal (Safe)" },
  psyche_sympathetic: { cn: "交感神经（警觉）", en: "Sympathetic (Alert)" },
  psyche_dorsal_vagal: { cn: "背侧迷走（冻结）", en: "Dorsal-Vagal (Freeze)" },
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
  gen_agent_seed_failed: { cn: "// EXTRACT_ERR — 角色种子提取失败，检查 LLM 配置", en: "// EXTRACT_ERR — Agent seed extraction failed. Check LLM config." },
  gen_event_seed_failed: { cn: "// EXTRACT_ERR — 事件种子提取失败，检查 LLM 配置", en: "// EXTRACT_ERR — Event seed extraction failed. Check LLM config." },
  gen_world_seed_failed: { cn: "// EXTRACT_ERR — 世界种子提取失败，检查 LLM 配置", en: "// EXTRACT_ERR — World seed extraction failed. Check LLM config." },
  no_session: { cn: "// NULL_REF — 未找到模拟会话", en: "// NULL_REF — No simulation session found." },
  go_home: { cn: "返回首页", en: "Go home" },
  retry: { cn: "重试", en: "Retry" },
  // Status (translated)
  status_running: { cn: "运行中", en: "RUNNING" },
  status_paused: { cn: "已暂停", en: "PAUSED" },
  status_ended: { cn: "已结束", en: "ENDED" },

  // Control bar
  run: { cn: "运行", en: "Run" },
  pause: { cn: "暂停", en: "Pause" },
  step: { cn: "单步", en: "Step" },
  tick: { cn: "轮次", en: "Tick" },
  aria_run: { cn: "运行模拟", en: "Run simulation" },
  aria_pause: { cn: "暂停模拟", en: "Pause simulation" },
  aria_step: { cn: "推演一步", en: "Advance one tick" },
  aria_controls: { cn: "模拟控制", en: "Simulation controls" },
  already_running: { cn: "// 模拟运行中", en: "// RUNNING" },
  pause_first: { cn: "// 先暂停模拟", en: "// PAUSE FIRST" },
  sim_running_hint: { cn: "// SIM_RUNNING — 暂停后可注入", en: "// SIM_RUNNING — Pause to inject" },
  inject_empty_hint: { cn: "// 输入事件内容", en: "// Enter event text" },

  // Event feed
  system: { cn: "系统", en: "System" },
  seed: { cn: "种子", en: "Seed" },

  // Settings panel
  llm_config: { cn: "// LLM_CONFIG", en: "// LLM_CONFIG" },
  api_base_url: { cn: "API 地址", en: "API Base URL" },
  api_key: { cn: "API 密钥", en: "API Key" },
  tick_delay: { cn: "轮次延迟（秒）", en: "Tick Delay (sec)" },
  model: { cn: "模型", en: "Model" },
  fetch_models: { cn: "获取模型列表", en: "Fetch Models" },
  fetch_models_disabled_hint: { cn: "请先填写 API Key 和 API Base", en: "Enter API Key and Base URL first" },
  loading: { cn: "加载中...", en: "Loading..." },
  save: { cn: "保存", en: "Save" },
  settings_saved: { cn: "设置已保存", en: "Settings saved" },
  connected_models: { cn: "已连接", en: "Connected" },
  connection_failed: { cn: "// NO_SIGNAL", en: "// NO_SIGNAL" },

  // Agent chat
  chat_with: { cn: "与{0}对话", en: "Chat with {0}" },
  send: { cn: "发送", en: "Send" },
  you: { cn: "你", en: "You" },
  thinking: { cn: "思考中...", en: "Thinking..." },
  chat_empty: { cn: "发送消息，与{0}角色对话", en: "Send a message to talk with {0} in character" },
  chat_placeholder: { cn: "对{0}说...", en: "Say something to {0}..." },
  chat_failed: { cn: "// REPLY_ERR — 回复失败，重试", en: "// REPLY_ERR — No response. Retry." },

  // Error messages (additional)
  failed_load_state: { cn: "// LINK_DOWN — 无法加载世界状态，检查后端服务", en: "// LINK_DOWN — Cannot load world state. Check backend." },
  failed_create: { cn: "// CREATE_ERR — 世界创建失败，检查后端连接", en: "// CREATE_ERR — World creation failed. Check backend." },
  failed_load_detail: { cn: "// LOAD_ERR — 世界详情加载失败", en: "// LOAD_ERR — Failed to load world details." },
  lost_connection: { cn: "// CONN_LOST — 与服务器断开，点击重连", en: "// CONN_LOST — Server disconnected. Reconnect below." },
  engine_error: { cn: "// ENGINE_ERR — 引擎异常，检查后端日志", en: "// ENGINE_ERR — Engine exception. Check backend logs." },

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
  timeline_empty: { cn: "暂无时间线，开始第一次模拟", en: "No timelines yet. Start your first simulation." },
  no_branches: { cn: "暂无分支", en: "NO BRANCHES" },
  seed_origin: { cn: "种子", en: "SEED" },
  branch_active: { cn: "进行中", en: "Active" },
  branch_ended: { cn: "已结束", en: "Ended" },
  branch_enter: { cn: "进入", en: "Enter" },
  branch_delete: { cn: "删除分支", en: "Delete Branch" },
  branch_delete_confirm: { cn: "确定删除此分支？所有事件和存档将不可恢复。", en: "Delete this branch? All events and data will be permanently lost." },
  branch_created: { cn: "创建于", en: "Created" },
  branch_no_events: { cn: "暂无事件", en: "No events yet" },
  view_all_assets: { cn: "查看全部资产 →", en: "View All Assets →" },
  inject_failed: { cn: "// INJECT_ERR — 注入失败，检查后端连接", en: "// INJECT_ERR — Injection failed. Check backend." },
  reconnect: { cn: "重连", en: "Reconnect" },
  delete_failed: { cn: "// DEL_ERR — 删除失败，重试", en: "// DEL_ERR — Delete failed. Retry." },
  seed_deleted: { cn: "种子已删除", en: "Seed deleted" },
  undo: { cn: "撤销", en: "Undo" },
  request_timeout: { cn: "// TIMEOUT — 请求超时，重试", en: "// TIMEOUT — Request timed out. Retry." },
  gen_item_gen_failed: { cn: "// GEN_ERR — 生成失败，重试", en: "// GEN_ERR — Generation failed. Retry." },

  // Agent classification
  main_character: { cn: "主角", en: "MAIN" },
  supporting_character: { cn: "配角", en: "SUPPORTING" },
  auto_agent_created: { cn: "// NEW_AGENT — 检测到新角色", en: "// NEW_AGENT — New character detected" },

  // Enrichment
  enrich: { cn: "生成详情", en: "ENRICH" },
  enriching: { cn: "生成中...", en: "ENRICHING..." },
  backstory: { cn: "背景故事", en: "BACKSTORY" },
  traits: { cn: "特征", en: "TRAITS" },
  relationships: { cn: "关系", en: "RELATIONSHIPS" },
  atmosphere: { cn: "氛围", en: "ATMOSPHERE" },
  history: { cn: "历史", en: "HISTORY" },
  properties: { cn: "属性", en: "PROPERTIES" },
  significance: { cn: "意义", en: "SIGNIFICANCE" },
  origin: { cn: "起源", en: "ORIGIN" },
  notable_features: { cn: "特色", en: "FEATURES" },
  enrich_failed: { cn: "// ENRICH_ERR — 详情生成失败，重试", en: "// ENRICH_ERR — Detail enrichment failed. Retry." },
  enrich_no_session: { cn: "源世界已不存在，无法生成详情", en: "Source world no longer exists" },
  validation_need_agent: { cn: "至少需要一个有名字的角色", en: "At least one agent with a name is required" },
  validation_need_location: { cn: "至少需要一个地点", en: "At least one location is required" },

  // Goal system
  active_goal: { cn: "当前目标", en: "ACTIVE GOAL" },
  core_goals: { cn: "核心目标", en: "CORE GOALS" },
  goal_progress: { cn: "进度", en: "PROGRESS" },
  goal_status_active: { cn: "进行中", en: "ACTIVE" },
  goal_status_completed: { cn: "已完成", en: "DONE" },
  goal_status_stalled: { cn: "停滞", en: "STALLED" },
  goal_status_failed: { cn: "失败", en: "FAILED" },
  goal_stalled_ticks: { cn: "停滞 {0} 轮", en: "Stalled {0} ticks" },
  goal_completed: { cn: "目标完成", en: "GOAL_COMPLETE" },
  goal_replanned: { cn: "目标重规划", en: "GOAL_REPLAN" },

  // Beliefs
  beliefs: { cn: "信念", en: "BELIEFS" },

  // Relations
  relation_ally: { cn: "盟友", en: "ALLY" },
  relation_trust: { cn: "信任", en: "TRUST" },
  relation_neutral: { cn: "中立", en: "NEUTRAL" },
  relation_rival: { cn: "对手", en: "RIVAL" },
  relation_hostile: { cn: "敌对", en: "HOSTILE" },
  relations_dynamic: { cn: "动态关系", en: "RELATIONS" },
  relation_up: { cn: "关系改善", en: "Relation improved" },
  relation_down: { cn: "关系恶化", en: "Relation worsened" },

  // Human control ("Play as Agent")
  take_control: { cn: "接管", en: "CONTROL" },
  release_control: { cn: "释放", en: "RELEASE" },
  human_controlled: { cn: "人类控制中", en: "HUMAN" },
  waiting_for_action: { cn: "等待你的指令…", en: "Awaiting your command…" },
  action_speak: { cn: "对话", en: "SPEAK" },
  action_move: { cn: "移动", en: "MOVE" },
  action_trade: { cn: "交易", en: "TRADE" },
  action_observe: { cn: "观察", en: "OBSERVE" },
  action_wait: { cn: "等待", en: "WAIT" },
  action_use_item: { cn: "使用物品", en: "USE ITEM" },
  action_target: { cn: "目标", en: "TARGET" },
  action_content: { cn: "内容", en: "CONTENT" },
  action_submit: { cn: "执行", en: "EXECUTE" },
  action_cancel: { cn: "取消", en: "CANCEL" },
  human_action_failed: { cn: "// ACTION_ERR — 行动提交失败，重试", en: "// ACTION_ERR — Action submission failed. Retry." },
  control_failed: { cn: "// CTRL_ERR — 控制操作失败，重试", en: "// CTRL_ERR — Control operation failed. Retry." },
  you_are_here: { cn: "你在这里", en: "YOU ARE HERE" },
  your_inventory: { cn: "你的物品", en: "YOUR INVENTORY" },
  nearby_agents: { cn: "附近的角色", en: "NEARBY AGENTS" },
  reachable: { cn: "可到达", en: "REACHABLE" },

  // Oracle creative mode
  oracle_mode_narrate: { cn: "叙述", en: "NARRATE" },
  oracle_mode_create: { cn: "创世", en: "CREATE" },
  oracle_create_empty: { cn: "描述你想创造的世界。ORACLE 会帮你生成完整的世界种子。", en: "Describe the world you want to create. ORACLE will generate a complete world seed." },
  oracle_create_placeholder: { cn: "描述你的世界构想...", en: "Describe your world idea..." },
  oracle_seed_generated: { cn: "世界种子已生成", en: "World seed generated" },
  oracle_create_world: { cn: "创建世界", en: "CREATE WORLD" },
  oracle_creating: { cn: "创建中...", en: "CREATING..." },
  oracle_seed_agents: { cn: "角色", en: "AGENTS" },
  oracle_seed_locations: { cn: "地点", en: "LOCATIONS" },
  oracle_seed_rules: { cn: "规则", en: "RULES" },

  // Oracle (omniscient narrator)
  oracle: { cn: "ORACLE", en: "ORACLE" },
  oracle_label: { cn: "// ORACLE", en: "// ORACLE" },
  oracle_empty: { cn: "与世界的全知旁白对话。它看到一切，知道一切。", en: "Talk to the omniscient narrator. It sees all, knows all." },
  oracle_placeholder: { cn: "向 ORACLE 提问...", en: "Ask ORACLE..." },
  oracle_thinking: { cn: "正在观察...", en: "Observing..." },
  oracle_failed: { cn: "// ORACLE_ERR — 旁白无响应，重试", en: "// ORACLE_ERR — Narrator unreachable. Retry." },
  oracle_suggest_summary: { cn: "总结目前发生了什么", en: "Summarize what happened so far" },
  oracle_suggest_tension: { cn: "角色之间有什么矛盾？", en: "What tensions exist between agents?" },
  oracle_suggest_inject: { cn: "建议一个可以注入的世界事件", en: "Suggest a world event to inject" },
  oracle_suggest_predict: { cn: "接下来可能发生什么？", en: "What might happen next?" },
  oracle_at_tick: { cn: "轮次", en: "TICK" },
  oracle_send: { cn: "发送", en: "SEND" },
  oracle_greet_0: { cn: "所有模拟世界运转正常。", en: "All simulated worlds operating normally." },
  oracle_greet_1: { cn: "ORACLE 已就绪。选择一个世界开始观察。", en: "ORACLE standing by. Choose a world to observe." },
  oracle_greet_2: { cn: "你的世界在等你。", en: "Your worlds await." },
  oracle_greet_3: { cn: "种子已就位。现实即将萌发。", en: "Seeds in place. Reality ready to emerge." },

  // System voice — loading states
  scanning_archive: { cn: "// 正在扫描种子存档...", en: "// SCANNING SEED ARCHIVE..." },
  deep_scan: { cn: "// 深度扫描进行中...", en: "// DEEP SCAN IN PROGRESS..." },
  loading_world_state: { cn: "// 正在加载世界状态...", en: "// LOADING WORLD STATE..." },
  establishing_link: { cn: "// 正在建立链接...", en: "// ESTABLISHING LINK..." },
  decoding_signal: { cn: "// 正在解码信号...", en: "// DECODING SIGNAL..." },
  syncing_timeline: { cn: "// 正在同步时间线...", en: "// SYNCING TIMELINE..." },
  parsing_entities: { cn: "// 正在解析实体...", en: "// PARSING ENTITIES..." },
  calibrating_oracle: { cn: "// 正在校准 ORACLE...", en: "// CALIBRATING ORACLE..." },
  resolving_state: { cn: "// 正在解析状态...", en: "// RESOLVING STATE..." },
  compiling_history: { cn: "// 正在编译历史...", en: "// COMPILING HISTORY..." },

  // System voice — empty states
  sim_dormant: { cn: "// 模拟休眠中 — 等待点火", en: "// SIMULATION DORMANT — AWAITING IGNITION" },
  no_signals: { cn: "// 暂无信号", en: "// NO SIGNALS DETECTED" },
  awaiting_input: { cn: "// 等待输入...", en: "// AWAITING INPUT..." },
  void_quiet: { cn: "// 虚空沉默", en: "// THE VOID IS QUIET" },
  no_entities: { cn: "// 暂无实体", en: "// NO ENTITIES REGISTERED" },
  archive_empty: { cn: "// 存档为空", en: "// ARCHIVE EMPTY" },
  idle_frontier: { cn: "// 前线一切平静", en: "// ALL QUIET ON THE FRONTIER" },
  agents_await: { cn: "// 角色等待你的指令", en: "// AGENTS AWAIT YOUR COMMAND" },

  // System voice — button labels
  ignite_world: { cn: "点燃世界", en: "IGNITE WORLD" },
  forge_world: { cn: "+ 锻造新世界", en: "+ FORGE NEW WORLD" },
  query_endpoints: { cn: "查询端点", en: "QUERY ENDPOINTS" },
  world_forge: { cn: "// 世界锻造", en: "// WORLD_FORGE" },

  // System voice — idle messages (sim page)
  idle_0: { cn: "// 前线一切平静", en: "// ALL QUIET ON THE FRONTIER" },
  idle_1: { cn: "// 角色等待你的指令", en: "// AGENTS AWAIT YOUR COMMAND" },
  idle_2: { cn: "// 时间静止。世界等待。", en: "// TIME STANDS STILL. THE WORLD WAITS." },
  idle_3: { cn: "// 注入事件或推进一步以继续", en: "// INJECT AN EVENT OR STEP TO CONTINUE" },
  idle_4: { cn: "// ORACLE 在观察。永远在观察。", en: "// ORACLE IS WATCHING. ALWAYS WATCHING." },

  // Simulation overlays
  simulation_complete: { cn: "// 模拟完成", en: "// SIMULATION COMPLETE" },
} as const;

export type TransKey = keyof typeof translations;
export type Locale = "cn" | "en";

const LOCALE_KEY = "babel_locale";

export function detectLocale(): Locale {
  if (typeof window === "undefined") return "cn";
  try {
    const saved = localStorage.getItem(LOCALE_KEY);
    if (saved === "cn" || saved === "en") return saved;
  } catch { /* localStorage may be unavailable */ }
  try {
    const lang = navigator.language.toLowerCase();
    return lang.startsWith("zh") ? "cn" : "en";
  } catch { return "cn"; }
}

export function setLocale(locale: Locale): void {
  try { localStorage.setItem(LOCALE_KEY, locale); } catch { /* ignore */ }
}

export function t(key: TransKey, locale: Locale, ...args: string[]): string {
  const entry = translations[key];
  let str: string = entry?.[locale] ?? key;
  for (let i = 0; i < args.length; i++) {
    str = str.replace(`{${i}}`, args[i]);
  }
  return str;
}
