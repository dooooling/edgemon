export type Language = 'zh' | 'en';

export const translations = {
  zh: {
    // Nav & Header
    nav_brand_sub: '// 节点监控系统',
    nav_overview: '节点概览',
    nav_console: '管理控制台',
    nav_provision: '添加节点',
    nav_active_stream: '实时推流',
    nav_active_count: '节点在线',
    nav_offline_sync: '离线同步',

    // Hero & Stats
    hero_title: '全球节点分布与实时监控矩阵',
    hero_sub: '专为 Linux/VPS 设计的原生分布式服务器监控系统，由 Cloudflare Edge Workers 提供低延迟推流接入。',
    stat_total_nodes: '总节点数',
    stat_active_beacons: '在线节点',
    stat_offline: '离线节点',
    stat_rx_rate: '全网入站速率',
    stat_tx_rate: '全网出站速率',

    // Section Titles & Cards
    map_title: '全球边缘节点物理分布图',
    fleet_nodes_title: '分布式计算节点列表',
    node_online: '在线',
    node_offline: '离线',
    node_cores: '核心',
    cpu_usage: 'CPU 使用率',
    memory_allocation: '内存占用',
    root_storage: '根磁盘存储',
    cycle_traffic: '账期已用流量',
    inspect_node: '查看节点详情 ➔',
    container_na: 'N/A (容器环境)',

    // Node Detail
    back_to_fleet: '‹ 返回节点列表',
    live_stream_badge: '2秒高频实时流推流中',
    spec_title: '节点硬件规格与系统架构',
    env_type: '运行环境类型',
    resource_boundary: '资源约束边界',
    cpu_capacity: 'CPU 核心容量',
    memory_limit: '内存总量',
    disk_limit: '磁盘存储总量',
    system_kernel: '操作系统 / 内核',
    location_colo: '地理位置 // CF Colo',
    asn_info: '自治系统 (ASN)',

    // Probes Table
    probes_title: '网络连通性雷达探测',
    probe_target: '探测目标',
    probe_status: '链路状态',
    probe_rtt: '往返延迟 (RTT)',
    probe_loss: '丢包率',

    // Historical Charts
    charts_title: '历史与实时时序变化趋势',
    chart_live_badge: '2秒高频实时流',
    chart_cpu_title: 'CPU 核心使用率 (%)',
    chart_memory_title: '内存分配量 (BYTES)',
    chart_rx_title: '网络入站实时吞吐速率 (BPS)',
    chart_rtt_title: 'CLOUDFLARE 边缘平滑 RTT (MS)',
    chart_loading: '正在获取采样数据...',
    chart_no_data: '该时间段内暂无历史数据',

    // Admin & Provision
    admin_title: '使命控制台 // 管理员鉴权',
    admin_login_sub: '请输入管理员密钥 (ADMIN_KEY) 以访问节点管理与凭证签发面板。',
    admin_key_label: '管理员密钥 (ADMIN_KEY)',
    admin_login_btn: '鉴权并登录 ➔',
    admin_logout_btn: '退出登录',
    admin_nodes_title: '受控节点配置与 Token 管理',
    create_node_btn: '+ 创建新监控节点',
    create_node_title: '添加新监控节点',
    node_name_label: '节点名称',
    reset_day_label: '月度流量重置日 (1-31)',
    quota_gb_label: '月度流量配额 (GB)',
    save_node_btn: '保存节点配置',
    cancel_btn: '取消',
    token_modal_title: '节点 Token（仅展示一次）',
    token_notice: '请妥善保存以下节点 Token 与 Agent 启动命令。',

    // Table Headers & Actions
    th_node_identifier: '节点标识名称',
    th_node_uuid: '节点 UUID',
    th_billing_reset: '流量重置日',
    th_provision_date: '创建日期',
    th_actions: '管理操作',
    btn_rotate: '轮转 Token',
    btn_delete: '删除节点',
    day_prefix: '每月 ',
    day_suffix: ' 日',

    // Footer
    footer_copy: 'EDGEMON TELEMETRY © 2026 // CLOUDFLARE NATIVE',
    footer_accuracy: '真实准确',
    footer_zero_rce: '零 RCE 攻击面',
    footer_minimal: '极轻量低消耗',
  },
  en: {
    // Nav & Header
    nav_brand_sub: '// TELEMETRY',
    nav_overview: 'FLEET OVERVIEW',
    nav_console: 'MISSION CONSOLE',
    nav_provision: 'PROVISION NODE',
    nav_active_stream: 'ORBITAL STREAM',
    nav_active_count: 'ACTIVE',
    nav_offline_sync: 'OFFLINE SYNC',

    // Hero & Stats
    hero_title: 'GLOBAL TELEMETRY STREAM',
    hero_sub: 'Zero-RCE, low-overhead distributed Linux & Windows daemon architecture. Real-time telemetry routed across Cloudflare edge workers.',
    stat_total_nodes: 'TOTAL FLEET NODES',
    stat_active_beacons: 'ACTIVE ORBITAL BEACONS',
    stat_offline: 'OFFLINE / SILENT',
    stat_rx_rate: 'FLEET INBOUND RATE',
    stat_tx_rate: 'FLEET OUTBOUND RATE',

    // Section Titles & Cards
    map_title: 'GLOBAL EDGE COLO DISTRIBUTIONS',
    fleet_nodes_title: 'DISTRIBUTED COMPUTE NODES',
    node_online: 'ONLINE',
    node_offline: 'OFFLINE',
    node_cores: 'CORES',
    cpu_usage: 'CPU CORE USAGE',
    memory_allocation: 'MEMORY ALLOCATION',
    root_storage: 'ROOT STORAGE',
    cycle_traffic: 'CYCLE TRAFFIC',
    inspect_node: 'INSPECT NODE ➔',
    container_na: 'N/A (CONTAINER)',

    // Node Detail
    back_to_fleet: '‹ BACK TO FLEET',
    live_stream_badge: 'ORBITAL TELEMETRY STREAM (2-SEC LIVE)',
    spec_title: 'INSTANCE TELEMETRY SPECIFICATION',
    env_type: 'ENVIRONMENT TYPE',
    resource_boundary: 'RESOURCE BOUNDARY',
    cpu_capacity: 'CPU CAPACITY',
    memory_limit: 'MEMORY LIMIT',
    disk_limit: 'ROOT STORAGE LIMIT',
    system_kernel: 'SYSTEM / KERNEL',
    location_colo: 'LOCATION // COLO',
    asn_info: 'AUTONOMOUS SYSTEM (ASN)',

    // Probes Table
    probes_title: 'CONNECTIVITY RADAR PROBES',
    probe_target: 'PROBE TARGET',
    probe_status: 'LINK STATUS',
    probe_rtt: 'ROUND-TRIP LATENCY (RTT)',
    probe_loss: 'PACKET LOSS',

    // Historical Charts
    charts_title: 'HISTORICAL FLIGHT TELEMETRY TRENDS',
    chart_live_badge: '2-SEC LIVE STREAM',
    chart_cpu_title: 'CPU CORE USAGE (%)',
    chart_memory_title: 'MEMORY ALLOCATION (BYTES)',
    chart_rx_title: 'NETWORK INBOUND THROUGHPUT (BPS)',
    chart_rtt_title: 'CLOUDFLARE EDGE SMOOTHED RTT (MS)',
    chart_loading: 'ACQUIRING TELEMETRY BUFFER...',
    chart_no_data: 'NO TELEMETRY BUFFER IN TIMEFRAME',

    // Admin & Provision
    admin_title: 'MISSION CONSOLE // ADMIN AUTHENTICATION',
    admin_login_sub: 'Enter your master ADMIN_KEY to access node provisioning and credential management.',
    admin_key_label: 'ADMINISTRATOR KEY (ADMIN_KEY)',
    admin_login_btn: 'AUTHENTICATE & ENTER ➔',
    admin_logout_btn: 'TERMINATE SESSION',
    admin_nodes_title: 'FLEET PROVISIONING & TOKEN REGISTRY',
    create_node_btn: '+ PROVISION NEW NODE',
    create_node_title: 'PROVISION NEW COMPUTE NODE',
    node_name_label: 'NODE IDENTIFIER NAME',
    reset_day_label: 'MONTHLY TRAFFIC RESET DAY (1-31)',
    quota_gb_label: 'MONTHLY BANDWIDTH QUOTA (GB)',
    save_node_btn: 'SAVE NODE SPEC',
    cancel_btn: 'CANCEL',
    token_modal_title: 'NODE TOKEN (DISPLAYED ONCE)',
    token_notice: 'Save the following node token and agent execution command securely.',

    // Table Headers & Actions
    th_node_identifier: 'NODE IDENTIFIER',
    th_node_uuid: 'NODE UUID',
    th_billing_reset: 'BILLING RESET',
    th_provision_date: 'PROVISION DATE',
    th_actions: 'ACTIONS',
    btn_rotate: 'ROTATE',
    btn_delete: 'DELETE',
    day_prefix: 'DAY ',
    day_suffix: '',

    // Footer
    footer_copy: 'EDGEMON TELEMETRY © 2026 // CLOUDFLARE NATIVE',
    footer_accuracy: 'ACCURACY FIRST',
    footer_zero_rce: 'ZERO RCE',
    footer_minimal: 'LOW OVERHEAD',
  },
};

export type TranslationKey = keyof typeof translations.zh;
